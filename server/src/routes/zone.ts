import { parseStringArray } from "../lib/json.js";
import { Router, type Request } from "express";
import multer from "multer";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { z } from "zod";
import { prisma, textSearch } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { currentUser } from "../lib/auth.js";
import { badRequest, forbidden, notFound } from "../lib/http.js";
import { hasAction, moduleAccess, requireAction, requireModule } from "../lib/module-access.js";
import { audit } from "../lib/audit.js";
import { notify, usersForRoles } from "../lib/notifications.js";

/**
 * DreamZone: muro de la comunidad (publicaciones, eventos, votaciones y encuestas, dinámicas y fotos) con comentarios.
 * Quien tiene el módulo ve las publicaciones dirigidas a su rol. Las que tienen `notify` avisan en la campanita.
 */
export const KINDS = ["NEWS", "EVENT", "POLL", "CHALLENGE", "PHOTO", "KUDOS"] as const;
/** Solo reacciones positivas: es un espacio de convivencia sana */
export const REACTIONS = ["LIKE", "CLAP", "PARTY", "STRONG", "LAUGH"] as const;

export const ZONE_IMAGES_DIR = () => path.resolve(env.storageDir, "zone-images");
const IMAGE_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);
const upload = multer({
  dest: path.join(ZONE_IMAGES_DIR(), "tmp"),
  limits: { fileSize: 6 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => (IMAGE_TYPES.has(file.mimetype) ? cb(null, true) : cb(badRequest("La foto debe ser JPG, PNG o WebP"))),
});

export const zoneRouter = Router();

const POST_LABEL: Record<(typeof KINDS)[number], string> = { NEWS: "Publicación", EVENT: "Evento", POLL: "Votación / encuesta", CHALLENGE: "Dinámica", PHOTO: "Foto", KUDOS: "Reconocimiento" };
const postLink = (id: string) => `zona#post-${id}`;

const now = () => new Date();

type Viewer = { id: string; roleKey: string };
const audienceOk = (roleKeys: string, user: Viewer, canPublish: boolean) => {
  const keys = parseStringArray(roleKeys);
  return canPublish || keys.length === 0 || keys.includes(user.roleKey);
};

/** Marca publicaciones como vistas: solo escribe las que faltan (upsert por si llegan dos pedidos a la vez) */
const markSeen = async (postIds: string[], userId: string) => {
  const already = await prisma.postSeen.findMany({ where: { userId, postId: { in: postIds } }, select: { postId: true } });
  const seen = new Set(already.map((s) => s.postId));
  const missing = postIds.filter((id) => !seen.has(id));
  if (!missing.length) return;
  await prisma.$transaction(
    missing.map((postId) => prisma.postSeen.upsert({ where: { postId_userId: { postId, userId } }, update: {}, create: { postId, userId } })),
  );
};

const baseWhere = () => ({ active: true, publishedAt: { lte: now() } });

zoneRouter.use(requireModule("zona"));

const postInclude = (userId: string) =>
  ({
    author: { select: { name: true, role: { select: { name: true, color: true } } } },
    mention: { select: { id: true, name: true, area: true, position: true } },
    options: { orderBy: { position: "asc" }, include: { _count: { select: { votes: true } } } },
    votes: { where: { userId }, select: { optionId: true } },
    likes: { where: { userId }, select: { kind: true } },
    seen: { where: { userId }, select: { userId: true } },
    _count: { select: { comments: { where: { hidden: false } }, likes: true, votes: true } },
  }) as const;

type PostRow = Awaited<ReturnType<typeof loadPosts>>[number];
const loadPosts = async (where: object, userId: string, take = 60) => {
  const rows = await prisma.post.findMany({ where, include: postInclude(userId), orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }], take });
  // Las reacciones se cuentan en la base: el muro se refresca solo y traer cada una por persona pesa mucho
  const counts = await prisma.postLike.groupBy({ by: ["postId", "kind"], where: { postId: { in: rows.map((p) => p.id) } }, _count: true });
  return rows.map((p) => ({ ...p, reactionCounts: counts.filter((c) => c.postId === p.id) }));
};

const present = (p: PostRow) => {
  const closed = !!p.closesAt && p.closesAt <= now();
  const reactions = Object.fromEntries(REACTIONS.map((k) => [k, 0])) as Record<(typeof REACTIONS)[number], number>;
  for (const c of p.reactionCounts) if (c.kind in reactions) reactions[c.kind as keyof typeof reactions] += c._count;
  const mine = p.likes[0];
  return {
    id: p.id,
    kind: p.kind,
    title: p.title,
    body: p.body,
    imageUrl: p.imageUrl,
    eventAt: p.eventAt,
    closesAt: p.closesAt,
    closed,
    pinned: p.pinned,
    active: p.active,
    commentsOpen: p.commentsOpen,
    notify: p.notify,
    roleKeys: parseStringArray(p.roleKeys),
    publishedAt: p.publishedAt,
    author: p.author?.name ?? null,
    authorRole: p.author?.role ?? null,
    options: p.options.map((o) => ({ id: o.id, label: o.label, votes: o._count.votes })),
    totalVotes: p._count.votes,
    myVote: p.votes[0]?.optionId ?? null,
    liked: !!mine,
    likes: p._count.likes,
    reactions,
    myReaction: mine?.kind ?? null,
    mention: p.mention,
    comments: p._count.comments,
    isNew: p.seen.length === 0,
  };
};

/** Muro: publicaciones vigentes para el rol de la persona */
zoneRouter.get("/posts", async (req, res) => {
  const user = currentUser(req);
  const q = z.object({ kind: z.enum(KINDS).optional() }).parse(req.query);
  const canManage = hasAction(req, "moderate");
  const rows = await loadPosts({ ...(canManage ? { publishedAt: { lte: new Date(Date.now() + 365 * 24 * 3600 * 1000) } } : baseWhere()), ...(canManage ? {} : { active: true }), ...(q.kind ? { kind: q.kind } : {}) }, user.id);
  res.json(rows.filter((r) => audienceOk(r.roleKeys, user, canManage)).map(present));
});

/** Marcar como vistas (al abrir el muro o cerrar el aviso) */
zoneRouter.post("/seen", async (req, res) => {
  const user = currentUser(req);
  const { ids } = z.object({ ids: z.array(z.string()).max(100) }).parse(req.body);
  if (ids.length) {
    const existing = await prisma.post.findMany({ where: { id: { in: ids } }, select: { id: true } });
    await markSeen(existing.map((r) => r.id), user.id);
  }
  res.json({ ok: true });
});

const postInput = z.object({
  kind: z.enum(KINDS),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().max(4000).default(""),
  imageUrl: z.string().max(300).nullish(),
  eventAt: z.coerce.date().nullish(),
  closesAt: z.coerce.date().nullish(),
  pinned: z.boolean().default(false),
  commentsOpen: z.boolean().default(true),
  notify: z.boolean().default(true),
  roleKeys: z.array(z.string()).default([]),
  options: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  /** Reconocimiento: compañero al que se felicita */
  mentionUserId: z.string().nullish(),
});

const validate = (d: z.infer<typeof postInput>) => {
  if (d.kind === "KUDOS" && !d.mentionUserId) throw badRequest("Elige al compañero que quieres reconocer");
  if (d.kind === "POLL" && d.options.length < 2) throw badRequest("Una votación necesita al menos 2 opciones");
  if (d.kind === "EVENT" && !d.eventAt) throw badRequest("Indica la fecha del evento");
  if (d.kind === "PHOTO" && !d.imageUrl) throw badRequest("Sube una foto");
};

/** Compañero activo (para reconocimientos) */
async function activeUser(id: string | null | undefined) {
  if (!id) return null;
  const u = await prisma.user.findFirst({ where: { id, active: true }, select: { id: true } });
  if (!u) throw badRequest("El compañero elegido no existe o está inactivo");
  return u.id;
}

/** Buscar compañeros para un reconocimiento */
zoneRouter.get("/people", requireAction("publish"), async (req, res) => {
  const { q } = z.object({ q: z.string().trim().max(60).default("") }).parse(req.query);
  res.json(
    await prisma.user.findMany({
      where: { active: true, role: { key: { not: "admin" } }, ...(q ? { OR: [{ name: textSearch(q) }, { area: textSearch(q) }] } : {}) },
      select: { id: true, name: true, area: true, position: true },
      orderBy: { name: "asc" },
      take: 20,
    }),
  );
});

/** Cifras de la portada: lo que se movió en la comunidad esta semana */
zoneRouter.get("/stats", async (_req, res) => {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [posts, votes, comments, reactions, kudos] = await Promise.all([
    prisma.post.count({ where: { ...baseWhere(), publishedAt: { gte: since, lte: now() } } }),
    prisma.postVote.count({ where: { createdAt: { gte: since } } }),
    prisma.postComment.count({ where: { createdAt: { gte: since }, hidden: false } }),
    prisma.postLike.count({ where: { post: { publishedAt: { gte: since } } } }),
    prisma.post.count({ where: { ...baseWhere(), kind: "KUDOS", publishedAt: { gte: since, lte: now() } } }),
  ]);
  res.json({ posts, votes, comments, reactions, kudos });
});

zoneRouter.post("/images", requireAction("publish"), upload.single("image"), async (req, res) => {
  if (!req.file) throw badRequest("Elige una foto");
  const name = `${randomUUID()}${IMAGE_TYPES.get(req.file.mimetype)}`;
  try {
    await mkdir(ZONE_IMAGES_DIR(), { recursive: true });
    await rename(req.file.path, path.join(ZONE_IMAGES_DIR(), name));
  } catch (err) {
    await rm(req.file.path, { force: true });
    throw err;
  }
  res.status(201).json({ url: `/api/files/zone-images/${name}` });
});

zoneRouter.post("/posts", requireAction("publish"), async (req, res) => {
  const user = currentUser(req);
  const d = postInput.parse(req.body);
  validate(d);
  const created = await prisma.post.create({
    data: {
      kind: d.kind,
      title: d.title,
      body: d.body,
      imageUrl: d.imageUrl || null,
      eventAt: d.kind === "EVENT" ? d.eventAt : null,
      closesAt: d.kind === "POLL" || d.kind === "CHALLENGE" ? d.closesAt ?? null : null,
      pinned: d.pinned,
      commentsOpen: d.commentsOpen,
      notify: d.notify,
      roleKeys: JSON.stringify(d.roleKeys),
      authorId: user.id,
      mentionUserId: d.kind === "KUDOS" ? await activeUser(d.mentionUserId) : null,
      options: d.kind === "POLL" ? { create: d.options.map((label, position) => ({ label, position })) } : undefined,
      // Quien publica no necesita el aviso de su propia publicación
      seen: { create: { userId: user.id } },
    },
  });
  await audit(req, "zone.post.created", "post", { entityId: created.id, detail: `${d.kind}: ${d.title}` });
  const link = postLink(created.id);
  if (d.notify) {
    const audience = (await usersForRoles("zona", d.roleKeys)).filter((id) => id !== created.mentionUserId);
    await notify(audience, { kind: `post.${d.kind}`, title: d.title, body: `${POST_LABEL[d.kind]} · ${user.name}`, link }, { except: user.id });
  }
  // A la persona reconocida se le avisa siempre, con un mensaje propio
  if (created.mentionUserId) await notify([created.mentionUserId], { kind: "zone.kudos", title: `¡${user.name} te dio un reconocimiento!`, body: d.title, link }, { except: user.id });
  const [row] = await loadPosts({ id: created.id }, user.id, 1);
  res.status(201).json(present(row));
});

/** Publicación vigente que la persona puede ver según su rol; si no, 404 */
async function visiblePost(id: string, user: Viewer, seesAll = false) {
  const post = await prisma.post.findFirst({ where: { id, ...baseWhere() } });
  if (!post || !audienceOk(post.roleKeys, user, seesAll)) throw notFound("Publicación no encontrada");
  return post;
}

/** Autor o moderador: el resto solo puede comentar */
async function ownPost(req: Request, id: string) {
  const user = currentUser(req);
  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) throw notFound("Publicación no encontrada");
  if (post.authorId !== user.id && !hasAction(req, "moderate")) throw forbidden("Solo el autor o un moderador puede cambiar esta publicación");
  return post;
}

zoneRouter.put("/posts/:id", requireAction("publish"), async (req, res) => {
  const user = currentUser(req);
  const post = await ownPost(req, req.params.id);
  const d = postInput.parse(req.body);
  validate(d);
  const votes = await prisma.postVote.count({ where: { postId: post.id } });
  await prisma.post.update({
    where: { id: post.id },
    data: {
      title: d.title,
      body: d.body,
      imageUrl: d.imageUrl || null,
      eventAt: post.kind === "EVENT" ? d.eventAt : null,
      closesAt: post.kind === "POLL" || post.kind === "CHALLENGE" ? d.closesAt ?? null : null,
      pinned: d.pinned,
      commentsOpen: d.commentsOpen,
      roleKeys: JSON.stringify(d.roleKeys),
      ...(post.kind === "KUDOS" ? { mentionUserId: await activeUser(d.mentionUserId) } : {}),
    },
  });
  // Las opciones solo se reescriben si aún nadie votó (si no, se perderían los votos)
  if (post.kind === "POLL" && votes === 0) {
    await prisma.postOption.deleteMany({ where: { postId: post.id } });
    await prisma.postOption.createMany({ data: d.options.map((label, position) => ({ label, position, postId: post.id })) });
  }
  await audit(req, "zone.post.updated", "post", { entityId: post.id, detail: d.title });
  const [row] = await loadPosts({ id: post.id }, user.id, 1);
  res.json(present(row));
});

zoneRouter.delete("/posts/:id", requireAction("publish"), async (req, res) => {
  const post = await ownPost(req, req.params.id);
  await prisma.post.delete({ where: { id: post.id } });
  await prisma.notification.deleteMany({ where: { link: postLink(post.id) } });
  await audit(req, "zone.post.deleted", "post", { entityId: post.id, detail: post.title });
  res.json({ ok: true });
});

/** Votar (o cambiar el voto mientras la votación siga abierta) */
zoneRouter.post("/posts/:id/vote", requireAction("comment"), async (req, res) => {
  const user = currentUser(req);
  const { optionId } = z.object({ optionId: z.string() }).parse(req.body);
  const post = await prisma.post.findFirst({ where: { id: req.params.id, ...baseWhere(), kind: "POLL" }, include: { options: true } });
  if (!post || !audienceOk(post.roleKeys, user, false)) throw notFound("Votación no encontrada");
  if (post.closesAt && post.closesAt <= now()) throw badRequest("Esta votación ya cerró");
  if (!post.options.some((o) => o.id === optionId)) throw badRequest("Opción no válida");
  await prisma.postVote.upsert({
    where: { postId_userId: { postId: post.id, userId: user.id } },
    update: { optionId },
    create: { postId: post.id, userId: user.id, optionId },
  });
  await markSeen([post.id], user.id);
  const [row] = await loadPosts({ id: post.id }, user.id, 1);
  res.json(present(row));
});

/** Reaccionar (una por persona): la misma reacción otra vez la quita; otra distinta la cambia */
zoneRouter.post("/posts/:id/react", requireAction("comment"), async (req, res) => {
  const user = currentUser(req);
  const { kind } = z.object({ kind: z.enum(REACTIONS) }).parse(req.body);
  const key = { postId_userId: { postId: req.params.id, userId: user.id } };
  const post = await visiblePost(req.params.id, user);
  const had = await prisma.postLike.findUnique({ where: key });
  if (had?.kind === kind) await prisma.postLike.delete({ where: key });
  else await prisma.postLike.upsert({ where: key, update: { kind }, create: { postId: post.id, userId: user.id, kind } });
  await markSeen([post.id], user.id);
  const [row] = await loadPosts({ id: post.id }, user.id, 1);
  res.json(present(row));
});

const commentSelect = { id: true, body: true, hidden: true, createdAt: true, user: { select: { id: true, name: true, role: { select: { name: true, color: true } } } } } as const;

zoneRouter.get("/posts/:id/comments", async (req, res) => {
  const user = currentUser(req);
  const canModerate = hasAction(req, "moderate");
  const post = await visiblePost(req.params.id, user, canModerate);
  const rows = await prisma.postComment.findMany({
    where: { postId: post.id, ...(canModerate ? {} : { hidden: false }) },
    select: commentSelect,
    orderBy: { createdAt: "asc" },
    take: 300,
  });
  res.json(rows.map((c) => ({ ...c, mine: c.user.id === user.id })));
});

zoneRouter.post("/posts/:id/comments", requireAction("comment"), async (req, res) => {
  const user = currentUser(req);
  const { body } = z.object({ body: z.string().trim().min(1).max(1000) }).parse(req.body);
  const post = await visiblePost(req.params.id, user);
  if (!post.commentsOpen) throw badRequest("Los comentarios de esta publicación están cerrados");
  const c = await prisma.postComment.create({ data: { postId: post.id, userId: user.id, body }, select: commentSelect });
  await markSeen([post.id], user.id);
  await notify([post.authorId], { kind: "zone.comment", title: `${user.name} comentó tu publicación`, body: post.title, link: postLink(post.id) }, { except: user.id });
  res.status(201).json({ ...c, mine: true });
});

/** Borra su propio comentario; un moderador oculta o muestra el de cualquiera */
zoneRouter.delete("/comments/:id", async (req, res) => {
  const user = currentUser(req);
  const c = await prisma.postComment.findUnique({ where: { id: req.params.id } });
  if (!c) throw notFound("Comentario no encontrado");
  if (c.userId === user.id) {
    await prisma.postComment.delete({ where: { id: c.id } });
    return res.json({ ok: true });
  }
  if (!hasAction(req, "moderate")) throw forbidden("Solo puedes borrar tus comentarios");
  const updated = await prisma.postComment.update({ where: { id: c.id }, data: { hidden: !c.hidden } });
  await audit(req, updated.hidden ? "zone.comment.hidden" : "zone.comment.shown", "post", { entityId: c.postId, detail: c.id });
  res.json({ ok: true, hidden: updated.hidden });
});

/** Acciones y roles disponibles para armar el público de una publicación */
zoneRouter.get("/meta", async (req, res) => {
  const access = await moduleAccess(currentUser(req), "zona");
  const roles = await prisma.role.findMany({ where: { key: { not: "admin" } }, select: { key: true, name: true }, orderBy: { name: "asc" } });
  res.json({ roles, actions: access?.actions ?? [] });
});
