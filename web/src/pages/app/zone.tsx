import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { Award, BarChart3, CalendarDays, HeartHandshake, ImagePlus, MessageCircle, Pin, Plus, Search, Send, Sparkles, Trash2, EyeOff, Eye, Pencil } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { useAction } from "@/lib/hooks";
import { cn, toLocalInput } from "@/lib/utils";
import type { PostKind, ReactionKind, ZoneComment, ZoneMeta, ZonePerson, ZonePost, ZoneStats } from "@/lib/types";
import { EmptyState } from "@/components/page";
import { Avatar, Badge, Card, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Switch, Textarea } from "@/components/ui/form";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, useConfirm } from "@/components/ui/overlay";
import { KIND_META } from "./zone-meta";

/** Solo reacciones positivas: DreamZone es un espacio de convivencia sana */
const REACTIONS: { key: ReactionKind; emoji: string; label: string }[] = [
  { key: "LIKE", emoji: "❤️", label: "Me gusta" },
  { key: "CLAP", emoji: "👏", label: "Aplausos" },
  { key: "PARTY", emoji: "🎉", label: "¡A celebrar!" },
  { key: "STRONG", emoji: "💪", label: "¡Fuerza!" },
  { key: "LAUGH", emoji: "😂", label: "Me divierte" },
];

const fmt = (d: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", ...opts }).format(new Date(d));
const ago = (d: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  if (m < 1440) return `hace ${Math.round(m / 60)} h`;
  return fmt(d, { day: "numeric", month: "short" });
};

const KEYS = [["zone"]];

function Poll({ post }: { post: ZonePost }) {
  const { run } = useAction();
  const qc = useQueryClient();
  const { canModule } = useAuth();
  const canVote = canModule("zona", "comment");
  const total = post.totalVotes;
  const showResults = post.closed || !!post.myVote;
  const vote = (optionId: string) =>
    run(async () => {
      const updated = await api.post<ZonePost>(`/zone/posts/${post.id}/vote`, { optionId });
      qc.setQueryData<ZonePost[]>(["zone", "posts"], (prev) => prev?.map((p) => (p.id === post.id ? updated : p)));
    }, { success: "Voto registrado" });
  return (
    <div className="grid gap-2">
      {post.options.map((o) => {
        const pct = total ? Math.round((o.votes / total) * 100) : 0;
        const mine = post.myVote === o.id;
        return (
          <button
            key={o.id}
            type="button"
            disabled={post.closed || !canVote}
            onClick={() => vote(o.id)}
            className={cn(
              "relative overflow-hidden rounded-lg border px-3 py-2 text-left text-sm transition-colors enabled:hover:border-brand",
              mine ? "border-brand" : "border-border",
            )}
          >
            {showResults && <span className="absolute inset-y-0 left-0 bg-brand/12 transition-[width] duration-500" style={{ width: `${pct}%` }} />}
            <span className="relative flex items-center justify-between gap-3">
              <span className={cn(mine && "font-semibold")}>{o.label}</span>
              {showResults && <span className="text-sm font-semibold tabular-nums">{pct}%</span>}
            </span>
          </button>
        );
      })}
      <p className="text-xs text-muted-foreground">
        {total} {total === 1 ? "voto" : "votos"}
        {post.closesAt && (post.closed ? " · votación cerrada" : ` · cierra ${fmt(post.closesAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`)}
        {!post.closed && post.myVote && " · puedes cambiar tu voto"}
      </p>
    </div>
  );
}

function Comments({ post, moderate }: { post: ZonePost; moderate: boolean }) {
  const { run, pending } = useAction();
  const confirm = useConfirm();
  const { canModule } = useAuth();
  const canComment = canModule("zona", "comment");
  const [text, setText] = React.useState("");
  const key = ["zone", "comments", post.id];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => api.get<ZoneComment[]>(`/zone/posts/${post.id}/comments`) });
  const send = async () => {
    if (!text.trim()) return;
    const ok = await run(() => api.post(`/zone/posts/${post.id}/comments`, { body: text }), { invalidate: [key, ["zone", "posts"]] });
    if (ok) setText("");
  };
  return (
    <div className="grid gap-3 border-t pt-3">
      {isLoading ? (
        <Skeleton className="h-10" />
      ) : (
        data?.map((c) => (
          <div key={c.id} className={cn("flex gap-2.5", c.hidden && "opacity-50")}>
            <Avatar name={c.user.name} className="size-7 text-[10px]" />
            <div className="min-w-0 flex-1">
              <p className="text-13">
                <span className="font-semibold">{c.user.name}</span> <span className="text-xs text-muted-foreground">{c.user.role.name} · {ago(c.createdAt)}</span>
                {c.hidden && <span className="ml-2 text-xs text-brand">oculto</span>}
              </p>
              <p className="text-sm break-words whitespace-pre-wrap">{c.body}</p>
            </div>
            {(c.mine || moderate) && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={c.mine ? "Borrar comentario" : c.hidden ? "Mostrar comentario" : "Ocultar comentario"}
                onClick={async () => {
                  if (c.mine && !(await confirm({ title: "¿Borrar tu comentario?", confirmText: "Borrar", destructive: true }))) return;
                  await run(() => api.del(`/zone/comments/${c.id}`), { invalidate: [key, ["zone", "posts"]] });
                }}
              >
                {c.mine ? <Trash2 /> : c.hidden ? <Eye /> : <EyeOff />}
              </Button>
            )}
          </div>
        ))
      )}
      {!isLoading && !data?.length && <p className="text-sm text-muted-foreground">Sé el primero en comentar.</p>}
      {!post.commentsOpen ? (
        <p className="text-xs text-muted-foreground">Los comentarios están cerrados.</p>
      ) : canComment ? (
        <div className="flex gap-2">
          <Input value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()} placeholder="Escribe un comentario…" />
          <Button onClick={send} disabled={pending || !text.trim()} aria-label="Enviar">
            <Send />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PostCard({ post, canEdit, moderate, onEdit }: { post: ZonePost; canEdit: boolean; moderate: boolean; onEdit: (p: ZonePost) => void }) {
  const { run } = useAction();
  const confirm = useConfirm();
  const { canModule } = useAuth();
  const [open, setOpen] = React.useState(false);
  const qc = useQueryClient();
  const meta = KIND_META[post.kind];
  const Icon = meta.icon;
  const canReact = canModule("zona", "comment");
  const react = (kind: ReactionKind) =>
    run(async () => {
      const updated = await api.post<ZonePost>(`/zone/posts/${post.id}/react`, { kind });
      qc.setQueryData<ZonePost[]>(["zone", "posts"], (prev) => prev?.map((p) => (p.id === post.id ? updated : p)));
    });
  return (
    <Card id={`post-${post.id}`} className={cn("flex scroll-mt-20 flex-col overflow-hidden", post.kind === "KUDOS" && "border-brand/40")}>
      <header className="flex items-start gap-3 px-5 pt-4">
        <Avatar name={post.author ?? "DT"} className="size-9" />
        <div className="min-w-0 flex-1">
          <p className="text-13 leading-tight">
            <span className="font-semibold">{post.author ?? "DreamTeam"}</span>
            <span className="text-muted-foreground"> · {post.authorRole?.name ?? "Equipo"} · {ago(post.publishedAt)}</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant={meta.accent === "text-brand" ? "brand" : "default"}>
              <Icon /> {meta.label}
            </Badge>
            {post.pinned && <Pin className="size-3.5 text-brand" aria-label="Fijado" />}
            {post.isNew && <Badge variant="brand">Nuevo</Badge>}
            {!post.active && <Badge>Oculto</Badge>}
            {post.roleKeys.length > 0 && <span className="text-xs text-muted-foreground">Para: {post.roleKeys.join(", ")}</span>}
          </div>
        </div>
        {canEdit && (
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="size-8" aria-label="Editar" onClick={() => onEdit(post)}>
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Eliminar"
              onClick={async () => {
                if (await confirm({ title: "¿Eliminar publicación?", description: "Se borran también sus comentarios y votos.", confirmText: "Eliminar", destructive: true }))
                  await run(() => api.del(`/zone/posts/${post.id}`), { success: "Publicación eliminada", invalidate: KEYS });
              }}
            >
              <Trash2 />
            </Button>
          </div>
        )}
      </header>
      {/* Reconocimiento: el compañero felicitado, destacado */}
      {post.kind === "KUDOS" && post.mention && (
        <div className="mx-5 mt-3 flex items-center gap-3 rounded-xl bg-brand/8 px-4 py-3">
          <div className="relative">
            <Avatar name={post.mention.name} className="size-12 ring-2 ring-brand ring-offset-2 ring-offset-background" />
            <span className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full bg-brand text-white">
              <Award className="size-3" />
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-brand">Reconocimiento para</p>
            <p className="truncate text-base font-semibold">{post.mention.name}</p>
            <p className="truncate text-xs text-muted-foreground">{[post.mention.position, post.mention.area].filter(Boolean).join(" · ")}</p>
          </div>
          <span className="ml-auto text-3xl" aria-hidden>
            🏆
          </span>
        </div>
      )}
      {/* Foto a todo el ancho de la tarjeta, como en Instagram; doble clic = ❤️ */}
      {post.imageUrl && (
        <img
          src={post.imageUrl}
          alt={post.title}
          loading="lazy"
          onDoubleClick={() => !post.myReaction && canReact && react("LIKE")}
          className="mt-3 max-h-[30rem] w-full bg-muted object-cover"
        />
      )}
      <div className="grid gap-3 px-5 pt-3">
        <h3 className="text-base leading-snug font-semibold">{post.title}</h3>
        {post.kind === "EVENT" && post.eventAt && (
          <p className="inline-flex w-fit items-center gap-2 rounded-md bg-foreground px-3 py-1 text-13 font-medium text-background">
            <CalendarDays className="size-4" />
            {fmt(post.eventAt, { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" })}
          </p>
        )}
        {post.body && <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground/90">{post.body}</p>}
        {post.kind === "POLL" && <Poll post={post} />}
        {post.kind === "CHALLENGE" && post.closesAt && (
          <p className="text-xs text-muted-foreground">{post.closed ? "Dinámica cerrada" : `Participa hasta el ${fmt(post.closesAt, { day: "numeric", month: "long" })}`} · comenta para participar</p>
        )}
      </div>
      <footer className="mt-3 flex flex-wrap items-center gap-1 border-t px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Reacciones">
          {REACTIONS.map((r) => {
            const n = post.reactions?.[r.key] ?? 0;
            const mine = post.myReaction === r.key;
            return (
              <button
                key={r.key}
                type="button"
                disabled={!canReact}
                onClick={() => react(r.key)}
                title={r.label}
                aria-pressed={mine}
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-13 tabular-nums transition-all enabled:hover:-translate-y-0.5 enabled:hover:border-brand/50 disabled:opacity-60",
                  mine ? "border-brand bg-brand/10 font-semibold text-brand" : "border-transparent text-muted-foreground",
                )}
              >
                <span className={cn("text-base leading-none transition-transform", mine && "scale-125")}>{r.emoji}</span>
                {n > 0 && n}
              </button>
            );
          })}
        </div>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setOpen((v) => !v)}>
          <MessageCircle /> {post.comments} {post.comments === 1 ? "comentario" : "comentarios"}
        </Button>
      </footer>
      {open && (
        <div className="px-5 pb-4">
          <Comments post={post} moderate={moderate} />
        </div>
      )}
    </Card>
  );
}

type Draft = {
  id?: string;
  kind: PostKind;
  title: string;
  body: string;
  imageUrl: string;
  eventAt: string;
  closesAt: string;
  pinned: boolean;
  commentsOpen: boolean;
  notify: boolean;
  roleKeys: string[];
  options: string[];
  /** Reconocimiento */
  mention: ZonePerson | null;
};
const emptyDraft = (kind: PostKind): Draft => ({ kind, title: "", body: "", imageUrl: "", eventAt: "", closesAt: "", pinned: false, commentsOpen: true, notify: true, roleKeys: ["asesor", "supervisor"], options: ["", ""], mention: null });

function Composer({ draft, onClose, meta }: { draft: Draft | null; onClose: () => void; meta?: ZoneMeta }) {
  const { run, pending } = useAction();
  const [d, setD] = React.useState<Draft>(draft ?? emptyDraft("NEWS"));
  const [uploading, setUploading] = React.useState(false);
  React.useEffect(() => {
    if (draft) setD(draft);
  }, [draft]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const editing = !!d.id;
  const upload = async (file: File) => {
    setUploading(true);
    await run(async () => {
      const fd = new FormData();
      fd.append("image", file);
      const r = await api.post<{ url: string }>("/zone/images", fd);
      set("imageUrl", r.url);
    });
    setUploading(false);
  };
  const save = async () => {
    const payload = {
      ...d,
      imageUrl: d.imageUrl || null,
      eventAt: d.kind === "EVENT" && d.eventAt ? new Date(d.eventAt).toISOString() : null,
      closesAt: (d.kind === "POLL" || d.kind === "CHALLENGE") && d.closesAt ? new Date(d.closesAt).toISOString() : null,
      options: d.options.filter((o) => o.trim()),
      mentionUserId: d.kind === "KUDOS" ? (d.mention?.id ?? null) : null,
    };
    const ok = await run(() => (editing ? api.put(`/zone/posts/${d.id}`, payload) : api.post("/zone/posts", payload)), {
      success: editing ? "Publicación actualizada" : "Publicado. Tu equipo ya recibe el aviso",
      invalidate: KEYS,
    });
    if (ok) onClose();
  };
  return (
    <Sheet open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader title={editing ? "Editar publicación" : "Nueva publicación"} description="Lo que publiques les aparece primero a los asesores y supervisores elegidos." />
        <SheetBody className="grid content-start gap-4">
          {!editing && (
            <div className="flex flex-wrap gap-2">
              {(Object.keys(KIND_META) as PostKind[]).map((k) => {
                const I = KIND_META[k].icon;
                return (
                  <Button key={k} type="button" size="sm" variant={d.kind === k ? "default" : "outline"} onClick={() => set("kind", k)}>
                    <I /> {KIND_META[k].label}
                  </Button>
                );
              })}
            </div>
          )}
          {d.kind === "KUDOS" && (
            <Field label="¿A quién reconoces?" hint="Felicita a un compañero por su esfuerzo, una meta lograda o su buena actitud.">
              <MentionPicker value={d.mention} onChange={(p) => set("mention", p)} />
            </Field>
          )}
          <Field label={d.kind === "KUDOS" ? "Motivo" : "Título"}>
            <Input value={d.title} maxLength={120} placeholder={d.kind === "KUDOS" ? "¡Superó su meta del mes!" : undefined} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label="Descripción">
            <Textarea value={d.body} maxLength={4000} onChange={(e) => set("body", e.target.value)} />
          </Field>
          {d.kind === "EVENT" && (
            <Field label="Fecha y hora del evento">
              <Input type="datetime-local" value={d.eventAt} onChange={(e) => set("eventAt", e.target.value)} />
            </Field>
          )}
          {(d.kind === "POLL" || d.kind === "CHALLENGE") && (
            <Field label="Cierra el (opcional)">
              <Input type="datetime-local" value={d.closesAt} onChange={(e) => set("closesAt", e.target.value)} />
            </Field>
          )}
          {d.kind === "POLL" && (
            <Field label="Opciones" hint={editing ? "Si ya hay votos, las opciones no se pueden cambiar." : "Mínimo 2, máximo 8."}>
              <div className="grid gap-2">
                {d.options.map((o, i) => (
                  <Input key={i} value={o} placeholder={`Opción ${i + 1}`} maxLength={80} onChange={(e) => set("options", d.options.map((x, j) => (j === i ? e.target.value : x)))} />
                ))}
                {d.options.length < 8 && (
                  <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => set("options", [...d.options, ""])}>
                    <Plus /> Agregar opción
                  </Button>
                )}
              </div>
            </Field>
          )}
          <Field label={d.kind === "PHOTO" ? "Foto" : "Foto (opcional)"} hint="JPG, PNG o WebP de hasta 6 MB">
            <div className="grid gap-2">
              {d.imageUrl && <img src={d.imageUrl} alt="" className="max-h-48 rounded-lg object-cover" />}
              <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-1.5 text-sm hover:border-brand">
                <ImagePlus className="size-4" /> {uploading ? "Subiendo…" : d.imageUrl ? "Cambiar foto" : "Elegir foto"}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              </label>
            </div>
          </Field>
          <Field label="¿Quién lo ve?" hint="Sin marcar, lo ven todos los que tienen DreamZone.">
            <div className="flex flex-wrap gap-3">
              {meta?.roles.map((r) => (
                <label key={r.key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={d.roleKeys.includes(r.key)} onChange={(e) => set("roleKeys", e.target.checked ? [...d.roleKeys, r.key] : d.roleKeys.filter((k) => k !== r.key))} />
                  {r.name}
                </label>
              ))}
            </div>
          </Field>
          <div className="grid gap-3">
            {!editing && (
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Avisar primero (campanita y aviso al entrar)</span>
                <Switch checked={d.notify} onCheckedChange={(v) => set("notify", v)} />
              </label>
            )}
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Fijar arriba</span>
              <Switch checked={d.pinned} onCheckedChange={(v) => set("pinned", v)} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Permitir comentarios</span>
              <Switch checked={d.commentsOpen} onCheckedChange={(v) => set("commentsOpen", v)} />
            </label>
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={pending || uploading}>
            {editing ? "Guardar cambios" : "Publicar"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const FILTERS: { key: PostKind | ""; label: string }[] = [
  { key: "", label: "Todo" },
  { key: "KUDOS", label: "Reconocimientos" },
  { key: "EVENT", label: "Eventos" },
  { key: "POLL", label: "Votaciones y encuestas" },
  { key: "CHALLENGE", label: "Dinámicas" },
  { key: "PHOTO", label: "Fotos" },
  { key: "NEWS", label: "Publicaciones" },
];

/** Buscador de compañeros para un reconocimiento */
function MentionPicker({ value, onChange }: { value: ZonePerson | null; onChange: (p: ZonePerson | null) => void }) {
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data } = useQuery({ queryKey: ["zone", "people", debounced], queryFn: () => api.get<ZonePerson[]>(`/zone/people?q=${encodeURIComponent(debounced)}`), enabled: !value });
  if (value)
    return (
      <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
        <Avatar name={value.name} />
        <span className="grid min-w-0 flex-1">
          <span className="truncate text-sm font-medium">{value.name}</span>
          <span className="truncate text-xs text-muted-foreground">{[value.position, value.area].filter(Boolean).join(" · ")}</span>
        </span>
        <button type="button" className="text-13 text-brand hover:underline" onClick={() => onChange(null)}>
          Cambiar
        </button>
      </div>
    );
  return (
    <div className="grid gap-1">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca por nombre o campaña…" className="pl-9" />
      </div>
      <ul className="grid max-h-48 overflow-y-auto rounded-md border">
        {(data ?? []).map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onChange(p)} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-accent">
              <Avatar name={p.name} className="size-7 text-[10px]" />
              <span className="grid min-w-0">
                <span className="truncate text-13 font-medium">{p.name}</span>
                <span className="truncate text-xs text-muted-foreground">{[p.position, p.area].filter(Boolean).join(" · ")}</span>
              </span>
            </button>
          </li>
        ))}
        {data?.length === 0 && <li className="px-3 py-3 text-center text-13 text-muted-foreground">Sin resultados</li>}
      </ul>
    </div>
  );
}

/** Portada de la comunidad: bienvenida y lo que se movió esta semana */
function ZoneHero({ stats, name, canPublish, onPublish, onKudos }: { stats?: ZoneStats; name?: string; canPublish: boolean; onPublish: () => void; onKudos: () => void }) {
  const items = [
    { label: "publicaciones", value: stats?.posts },
    { label: "reacciones", value: stats?.reactions },
    { label: "comentarios", value: stats?.comments },
    { label: "votos", value: stats?.votes },
  ];
  return (
    <Card className="relative mb-6 overflow-hidden border-0 bg-neutral-950 text-white">
      <img src="/modules/celebracion.jpg" alt="" className="absolute inset-0 size-full object-cover opacity-45" />
      <div className="absolute inset-0 bg-gradient-to-r from-neutral-950 via-neutral-950/80 to-neutral-950/20" />
      <div className="relative grid gap-5 p-6 sm:p-8">
        <div className="grid max-w-xl gap-2">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-brand px-2.5 py-0.5 text-xs font-semibold">
            <HeartHandshake className="size-3.5" /> Comunidad DreamTeam
          </span>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{name ? `¡Hola, ${name.split(" ")[0]}! Te damos la bienvenida a DreamZone` : "Te damos la bienvenida a DreamZone"}</h1>
          <p className="text-sm text-white/80">
            El espacio donde asesores y supervisores nos enteramos de lo que pasa, celebramos los logros y nos apoyamos. Aquí todos sumamos: con respeto, buena onda y trabajo en equipo.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          {items.map((i) => (
            <div key={i.label} className="grid">
              <span className="text-2xl font-semibold tabular-nums">{i.value ?? "–"}</span>
              <span className="text-xs text-white/70">{i.label} esta semana</span>
            </div>
          ))}
          {canPublish && (
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={onKudos}>
                <Award /> Reconocer a alguien
              </Button>
              <Button onClick={onPublish}>
                <Plus /> Publicar
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Columna lateral: lo que pide acción o merece verse */
function ZoneSidebar({ posts }: { posts: ZonePost[] }) {
  const go = (id: string) => document.getElementById(`post-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const nowMs = Date.now();
  const events = posts.filter((p) => p.kind === "EVENT" && p.eventAt && new Date(p.eventAt).getTime() >= nowMs).sort((a, b) => a.eventAt!.localeCompare(b.eventAt!)).slice(0, 4);
  const polls = posts.filter((p) => (p.kind === "POLL" || p.kind === "CHALLENGE") && !p.closed).slice(0, 4);
  const kudos = posts.filter((p) => p.kind === "KUDOS" && p.mention).slice(0, 4);
  const Section = ({ icon: I, title, children, empty }: { icon: React.ElementType; title: string; children: React.ReactNode; empty: boolean }) => (
    <Card className="p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <I className="size-4 text-brand" /> {title}
      </h3>
      {empty ? <p className="text-13 text-muted-foreground">Nada por ahora.</p> : <div className="grid gap-1">{children}</div>}
    </Card>
  );
  const Row = ({ id, left, title, sub }: { id: string; left: React.ReactNode; title: string; sub: React.ReactNode }) => (
    <button type="button" onClick={() => go(id)} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent">
      {left}
      <span className="grid min-w-0">
        <span className="truncate text-13 font-medium">{title}</span>
        <span className="truncate text-xs text-muted-foreground">{sub}</span>
      </span>
    </button>
  );
  return (
    <aside className="grid content-start gap-4 lg:sticky lg:top-20">
      <Section icon={CalendarDays} title="Próximos eventos" empty={!events.length}>
        {events.map((e) => (
          <Row
            key={e.id}
            id={e.id}
            title={e.title}
            sub={fmt(e.eventAt!, { weekday: "long", hour: "numeric", minute: "2-digit" })}
            left={
              <span className="grid w-10 shrink-0 place-items-center rounded-lg bg-brand/10 py-1 text-brand">
                <span className="text-[10px] leading-none font-medium uppercase">{fmt(e.eventAt!, { month: "short" })}</span>
                <span className="text-base leading-tight font-semibold">{fmt(e.eventAt!, { day: "numeric" })}</span>
              </span>
            }
          />
        ))}
      </Section>
      <Section icon={BarChart3} title="Participa" empty={!polls.length}>
        {polls.map((p) => (
          <Row
            key={p.id}
            id={p.id}
            title={p.title}
            sub={p.kind === "POLL" ? (p.myVote ? "✓ Ya votaste" : `${p.totalVotes} votos · ¡vota!`) : "Dinámica abierta · comenta para participar"}
            left={<span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-lg">{p.kind === "POLL" ? "🗳️" : "🎯"}</span>}
          />
        ))}
      </Section>
      <Section icon={Award} title="Reconocimientos recientes" empty={!kudos.length}>
        {kudos.map((k) => (
          <Row key={k.id} id={k.id} title={k.mention!.name} sub={k.title} left={<Avatar name={k.mention!.name} className="size-10 ring-2 ring-brand/40" />} />
        ))}
      </Section>
    </aside>
  );
}

export function ZoneScreen() {
  const { user, canModule } = useAuth();
  const { hash, key: navKey } = useLocation();
  const [filter, setFilter] = React.useState<PostKind | "">("");
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const canPublish = canModule("zona", "publish");
  const moderate = canModule("zona", "moderate");
  const { data, isLoading } = useQuery({ queryKey: ["zone", "posts"], queryFn: () => api.get<ZonePost[]>("/zone/posts"), refetchInterval: 30000 });
  const { data: meta } = useQuery({ queryKey: ["zone", "meta"], queryFn: () => api.get<ZoneMeta>("/zone/meta"), enabled: canPublish });
  const { data: stats } = useQuery({ queryKey: ["zone", "stats"], queryFn: () => api.get<ZoneStats>("/zone/stats"), refetchInterval: 60000 });

  // Al abrir el muro, lo que estaba sin ver se marca como visto (la etiqueta "Nuevo" se queda en esta visita)
  const marked = React.useRef(false);
  React.useEffect(() => {
    if (!data || marked.current) return;
    const ids = data.filter((p) => p.isNew).map((p) => p.id);
    marked.current = true;
    if (ids.length) api.post("/zone/seen", { ids }).catch(() => {});
  }, [data]);

  // Al llegar desde una notificación, baja hasta esa publicación
  const loaded = !!data;
  React.useEffect(() => {
    if (!loaded || !hash.startsWith("#post-")) return;
    setFilter("");
    const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    return () => clearTimeout(t);
  }, [loaded, hash, navKey]);

  const list = (data ?? []).filter((p) => !filter || p.kind === filter);
  const toDraft = (p: ZonePost): Draft => ({
    id: p.id, kind: p.kind, title: p.title, body: p.body, imageUrl: p.imageUrl ?? "", eventAt: toLocalInput(p.eventAt), closesAt: toLocalInput(p.closesAt),
    pinned: p.pinned, commentsOpen: p.commentsOpen, notify: p.notify, roleKeys: p.roleKeys, options: p.options.map((o) => o.label), mention: p.mention,
  });

  return (
    <div className="mx-auto w-full max-w-6xl">
      <ZoneHero stats={stats} name={user?.name} canPublish={canPublish} onPublish={() => setDraft(emptyDraft("NEWS"))} onKudos={() => setDraft(emptyDraft("KUDOS"))} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <Button key={f.key} size="sm" variant={filter === f.key ? "default" : "outline"} onClick={() => setFilter(f.key)}>
                {f.label}
              </Button>
            ))}
          </div>
          {isLoading ? (
            <div className="grid gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-44" />
              ))}
            </div>
          ) : list.length ? (
            <div className="grid gap-4">
              {list.map((p) => (
                <PostCard key={p.id} post={p} canEdit={canPublish && (moderate || p.author === user?.name)} moderate={moderate} onEdit={(x) => setDraft(toDraft(x))} />
              ))}
            </div>
          ) : (
            <EmptyState icon={Sparkles} title="Aún no hay publicaciones" description="Cuando haya un evento, una votación o un reconocimiento, aparecerá aquí." />
          )}
        </div>
        <ZoneSidebar posts={data ?? []} />
      </div>
      <Composer draft={draft} onClose={() => setDraft(null)} meta={meta} />
    </div>
  );
}