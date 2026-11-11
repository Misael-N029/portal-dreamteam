import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, BellRing, ClipboardList, HandHelping, Minus, PackagePlus, Pencil, Plus, Search, TriangleAlert } from "lucide-react";
import { api, qs } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import type { PersonRef, Supply, SupplyDelivery, SupplyMovement, SupplyStock } from "@/lib/types";
import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, SwitchRow, Textarea } from "@/components/ui/form";
import { Badge, Card, Skeleton } from "@/components/ui/misc";
import { Dialog, DialogClose, DialogContent, DialogHeader, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader } from "@/components/ui/overlay";
import { cn, formatDateTime, timeAgo } from "@/lib/utils";
import { CategoryIcon, MOVEMENT_LABEL, PersonPicker, StockBar, invalidate, stockTone, useInvAccess, useInventoryMeta } from "./shared";

type MoveKind = "IN" | "OUT" | "ADJUST";
const MOVE_REASONS: Record<MoveKind, string[]> = {
  IN: ["Compra", "Donación / reposición", "Devolución", "Otro"],
  OUT: ["Consumo de la sede", "Merma / daño", "Préstamo", "Otro"],
  ADJUST: ["Conteo físico", "Corrección", "Otro"],
};

export function WarehouseTab({ siteId }: { siteId: string }) {
  const { can } = useInvAccess();
  const meta = useInventoryMeta();
  const [q, setQ] = React.useState("");
  const [cat, setCat] = React.useState("");
  const [alertsOnly, setAlertsOnly] = React.useState(false);
  const [move, setMove] = React.useState<{ supply: Supply; kind: MoveKind } | null>(null);
  const [deliver, setDeliver] = React.useState<Supply | "pick" | null>(null);
  const [detail, setDetail] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<Supply | "new" | null>(null);

  const supplies = useQuery({ queryKey: ["inventory", "supplies", siteId], queryFn: () => api.get<Supply[]>(`/inventory/supplies${qs({ siteId })}`) });
  const pending = useQuery({
    queryKey: ["inventory", "deliveries", siteId, "PENDING"],
    queryFn: () => api.get<SupplyDelivery[]>(`/inventory/supplies/deliveries/list${qs({ siteId, status: "PENDING" })}`),
  });

  const all = supplies.data ?? [];
  const term = q.trim().toLowerCase();
  const list = all.filter((s) => (!cat || s.categoryId === cat) && (!alertsOnly || s.low) && (!term || s.name.toLowerCase().includes(term) || s.sku.toLowerCase().includes(term)));
  const low = all.filter((s) => s.low);
  const shelves = new Map<string, Supply[]>();
  for (const s of list) shelves.set(s.categoryId ?? "", [...(shelves.get(s.categoryId ?? "") ?? []), s]);
  const shelfOrder = [...shelves.keys()].sort((a, b) => (meta.category(a)?.order ?? 999) - (meta.category(b)?.order ?? 999));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-60">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca insumo o SKU…" className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1">
          {[{ id: "", name: "Todo", icon: "Package", color: "" }, ...meta.supplyCats.filter((c) => c.active)].map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCat(c.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-13 font-medium transition-colors [&_svg]:size-3.5",
                cat === c.id ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              <CategoryIcon name={c.icon} /> {c.name}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-13">
          <input type="checkbox" checked={alertsOnly} onChange={(e) => setAlertsOnly(e.target.checked)} className="accent-[var(--brand)]" /> Solo bajo mínimo
        </label>
        <div className="ml-auto flex gap-2">
          {can("deliver") && (
            <Button variant="outline" onClick={() => setDeliver("pick")}>
              <HandHelping /> Entregar
            </Button>
          )}
          {can("create") && (
            <Button onClick={() => setForm("new")}>
              <PackagePlus /> Nuevo insumo
            </Button>
          )}
        </div>
      </div>

      {low.length > 0 && (
        <Card className="flex flex-wrap items-center gap-3 border-l-4 border-brand bg-brand/5 p-4">
          <TriangleAlert className="size-5 shrink-0 animate-pulse text-brand" />
          <p className="text-sm font-semibold">
            {low.length} {low.length === 1 ? "insumo está" : "insumos están"} por debajo del mínimo
          </p>
          <div className="flex flex-wrap gap-1.5">
            {low.map((s) => (
              <button key={s.id} type="button" onClick={() => setDetail(s.id)}>
                <Badge variant="danger">
                  {s.name} · {s.quantity}/{s.minStock}
                </Badge>
              </button>
            ))}
          </div>
        </Card>
      )}

      {supplies.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={PackagePlus} title={all.length ? "Nada coincide con el filtro" : "El almacén está vacío"} description={all.length ? undefined : "Registra los insumos que maneja la sede o impórtalos desde Excel."} />
      ) : (
        shelfOrder.map((catId) => {
          const c = meta.category(catId);
          const items = shelves.get(catId)!;
          return (
            <section key={catId} className="grid gap-3">
              <div className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-md bg-foreground text-background">
                  <CategoryIcon name={c?.icon} className="size-4" />
                </span>
                <h3 className="text-sm font-semibold">{c?.name ?? "Sin categoría"}</h3>
                <span className="text-13 text-muted-foreground">{items.length} artículos</span>
                <span className="ml-2 h-px flex-1 bg-border" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {items.map((s) => (
                  <SupplyCard
                    key={s.id}
                    supply={s}
                    onOpen={() => setDetail(s.id)}
                    onIn={can("stock") ? () => setMove({ supply: s, kind: "IN" }) : undefined}
                    onOut={can("stock") ? () => setMove({ supply: s, kind: "OUT" }) : undefined}
                    onDeliver={can("deliver") ? () => setDeliver(s) : undefined}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}

      {(pending.data?.length ?? 0) > 0 && (
        <Card>
          <div className="flex items-center gap-2 border-b px-5 py-3">
            <BellRing className="size-4 text-brand" />
            <h3 className="text-sm font-semibold">Entregas por confirmar</h3>
            <span className="ml-auto font-semibold text-sm text-muted-foreground tabular-nums">{pending.data!.length}</span>
          </div>
          <ul className="divide-y">
            {pending.data!.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-5 py-2.5 text-13">
                <span className="font-semibold text-lg tabular-nums">{d.quantity}</span>
                <span className="min-w-0 flex-1 truncate">
                  {d.supply.unit} de <b>{d.supply.name}</b> para {d.user?.name}
                </span>
                <span className="text-xs text-muted-foreground">{timeAgo(d.createdAt)}</span>
                <Badge variant="warning">Esperando al colaborador</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <MovementDialog target={move} siteId={siteId} onClose={() => setMove(null)} />
      <DeliveryDialog target={deliver} supplies={all} siteId={siteId} onClose={() => setDeliver(null)} />
      <SupplyDetailSheet supplyId={detail} siteId={siteId} onClose={() => setDetail(null)} onEdit={(s) => setForm(s)} onMove={(supply, kind) => setMove({ supply, kind })} />
      <SupplyFormSheet target={form} siteId={siteId} onClose={() => setForm(null)} />
    </div>
  );
}

function SupplyCard({ supply: s, onOpen, onIn, onOut, onDeliver }: { supply: Supply; onOpen: () => void; onIn?: () => void; onOut?: () => void; onDeliver?: () => void }) {
  const tone = stockTone(s.quantity, s.minStock);
  return (
    <Card className={cn("group grid gap-3 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md", tone === "low" && "bg-brand/5 shadow-[inset_0_0_0_1px_var(--brand)]")}>
      <button type="button" onClick={onOpen} className="grid gap-3 text-left">
        <div className="flex items-start gap-2 pl-2">
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="truncate text-sm font-semibold" title={s.name}>
              {s.name}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">{s.sku}</span>
          </div>
          {tone === "low" && <Badge variant="danger">Bajo mínimo</Badge>}
          {tone === "warn" && <Badge variant="warning">Por agotarse</Badge>}
        </div>
        <div className="flex items-end gap-2 pl-2">
          <span className={cn("font-semibold text-[44px] leading-none tabular-nums", tone === "low" && "text-brand")}>
            {s.quantity}
          </span>
          <span className="pb-1 text-13 text-muted-foreground">{s.unit}</span>
          <span className="ml-auto pb-1 text-xs text-muted-foreground">mín. {s.minStock}</span>
        </div>
        <StockBar quantity={s.quantity} min={s.minStock} />
      </button>
      {(onIn || onOut || onDeliver) && (
        <div className="flex gap-1.5">
          {onIn && (
            <Button size="sm" variant="secondary" className="flex-1" onClick={onIn} aria-label="Entrada">
              <Plus /> Entrada
            </Button>
          )}
          {onOut && (
            <Button size="icon-sm" variant="ghost" onClick={onOut} aria-label="Salida" title="Salida / consumo">
              <Minus />
            </Button>
          )}
          {onDeliver && (
            <Button size="icon-sm" variant="ghost" onClick={onDeliver} aria-label="Entregar a un colaborador" title="Entregar a un colaborador" disabled={s.quantity === 0}>
              <HandHelping />
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function MovementDialog({ target, siteId, onClose }: { target: { supply: Supply; kind: MoveKind } | null; siteId: string; onClose: () => void }) {
  const { run, pending } = useAction();
  const [kind, setKind] = React.useState<MoveKind>("IN");
  const [quantity, setQuantity] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  React.useEffect(() => {
    if (!target) return;
    setKind(target.kind);
    setQuantity(target.kind === "ADJUST" ? String(target.supply.quantity) : "");
    setReason(MOVE_REASONS[target.kind][0]!);
    setNote("");
  }, [target]);
  if (!target) return <Dialog open={false} />;
  const s = target.supply;
  const n = Number(quantity) || 0;
  const after = kind === "IN" ? s.quantity + n : kind === "OUT" ? s.quantity - n : n;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() => api.post(`/inventory/supplies/${s.id}/movements`, { siteId, kind, quantity: n, reason, note: note || null }), { success: `${MOVEMENT_LABEL[kind]} registrada`, invalidate });
    if (ok) onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader title={s.name} description={`Stock actual: ${s.quantity} ${s.unit}`} />
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid grid-cols-3 gap-1">
            {(["IN", "OUT", "ADJUST"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => (setKind(k), setReason(MOVE_REASONS[k][0]!), k === "ADJUST" && setQuantity(String(s.quantity)))}
                className={cn("rounded-md py-2 text-13 font-medium", kind === k ? "bg-brand text-white" : "bg-muted text-muted-foreground")}
              >
                {MOVEMENT_LABEL[k]}
              </button>
            ))}
          </div>
          <Field label={kind === "ADJUST" ? "Cantidad contada" : "Cantidad"}>
            <Input type="number" min={0} value={quantity} onChange={(e) => setQuantity(e.target.value)} required autoFocus />
          </Field>
          <div className={cn("flex items-center justify-between border px-3 py-2 text-13", after < 0 && "border-destructive text-destructive")}>
            <span>Quedará</span>
            <span className="font-semibold text-xl tabular-nums">
              {after} {s.unit}
            </span>
          </div>
          <Field label="Motivo">
            <NativeSelect value={reason} onChange={(e) => setReason(e.target.value)}>
              {MOVE_REASONS[kind].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Nota (opcional)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="N.° de factura, guía, observación…" />
          </Field>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" loading={pending} disabled={after < 0 || (kind !== "ADJUST" && n <= 0)}>
              Registrar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeliveryDialog({ target, supplies, siteId, onClose }: { target: Supply | "pick" | null; supplies: Supply[]; siteId: string; onClose: () => void }) {
  const { run, pending } = useAction();
  const [supplyId, setSupplyId] = React.useState("");
  const [person, setPerson] = React.useState<PersonRef | null>(null);
  const [quantity, setQuantity] = React.useState("1");
  const [note, setNote] = React.useState("");
  React.useEffect(() => {
    if (!target) return;
    setSupplyId(target === "pick" ? "" : target.id);
    setPerson(null);
    setQuantity("1");
    setNote("");
  }, [target]);
  const s = supplies.find((x) => x.id === supplyId);
  const n = Number(quantity) || 0;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!person || !s) return;
    const ok = await run(() => api.post("/inventory/supplies/deliveries", { supplyId: s.id, siteId, userId: person.id, quantity: n, note: note || null }), {
      success: `Entrega registrada: ${person.name} debe confirmarla en "Mi equipo"`,
      invalidate,
    });
    if (ok) onClose();
  };
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader title="Entregar a un colaborador" description="Sale del stock ahora; el colaborador confirma desde su panel que lo recibió." />
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Insumo">
            <NativeSelect value={supplyId} onChange={(e) => setSupplyId(e.target.value)} required>
              <option value="">Elige un insumo…</option>
              {supplies
                .filter((x) => x.quantity > 0)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.quantity} {x.unit})
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <Field label="Colaborador">
            <PersonPicker value={person} onChange={setPerson} siteId={siteId} />
          </Field>
          <div className="grid grid-cols-[120px_1fr] gap-3">
            <Field label="Cantidad">
              <Input type="number" min={1} max={s?.quantity} value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
            </Field>
            <Field label="Nota (opcional)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" loading={pending} disabled={!person || !s || n < 1 || n > (s?.quantity ?? 0)}>
              <HandHelping /> Entregar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SupplyDetailSheet({ supplyId, siteId, onClose, onEdit, onMove }: { supplyId: string | null; siteId: string; onClose: () => void; onEdit: (s: Supply) => void; onMove: (s: Supply, k: MoveKind) => void }) {
  const { can, global } = useInvAccess();
  const meta = useInventoryMeta();
  const { run } = useAction();
  const [transfer, setTransfer] = React.useState(false);
  const { data } = useQuery({
    queryKey: ["inventory", "kardex", supplyId],
    queryFn: () => api.get<{ supply: Supply & { stock: SupplyStock[] }; movements: SupplyMovement[] }>(`/inventory/supplies/${supplyId}/kardex`),
    enabled: !!supplyId,
  });
  const here = data?.supply.stock.find((x) => x.siteId === siteId);
  const asSupply: Supply | undefined = data ? { ...data.supply, quantity: here?.quantity ?? 0, minStock: here?.minStock ?? 0, low: !!here && here.minStock > 0 && here.quantity < here.minStock } : undefined;
  const setMin = (st: SupplyStock, v: number) => run(() => api.put(`/inventory/supplies/${st.supplyId}/stock/${st.siteId}`, { minStock: v }), { success: `Mínimo de ${st.site.name}: ${v}`, invalidate });

  return (
    <Sheet open={!!supplyId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="lg">
        <SheetHeader title={data?.supply.name ?? "Insumo"} description={data ? `${data.supply.sku} · ${meta.category(data.supply.categoryId)?.name ?? "Sin categoría"} · ${data.supply.unit}` : undefined} />
        <SheetBody className="grid content-start gap-6">
          {!data ? (
            <Skeleton className="h-40" />
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {can("stock") && asSupply && (
                  <>
                    <Button size="sm" onClick={() => onMove(asSupply, "IN")}>
                      <Plus /> Entrada
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => onMove(asSupply, "OUT")}>
                      <Minus /> Salida
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onMove(asSupply, "ADJUST")}>
                      <ClipboardList /> Ajuste por conteo
                    </Button>
                  </>
                )}
                {can("transfer") && (
                  <Button size="sm" variant="outline" onClick={() => setTransfer(true)}>
                    <ArrowRightLeft /> Trasladar a otra sede
                  </Button>
                )}
                {can("edit") && asSupply && (
                  <Button size="sm" variant="ghost" onClick={() => onEdit(asSupply)}>
                    <Pencil /> Editar
                  </Button>
                )}
              </div>

              <section className="grid gap-2">
                <h3 className="text-sm font-semibold">Stock por sede</h3>
                {data.supply.stock.length === 0 && <p className="text-13 text-muted-foreground">Sin stock registrado.</p>}
                {data.supply.stock.map((st) => (
                  <div key={st.siteId} className={cn("grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 border px-3 py-2.5", st.siteId === siteId && "border-foreground/40")}>
                    <span className="text-13 font-medium">{st.site.name}</span>
                    <span className="font-semibold text-xl tabular-nums">
                      {st.quantity} <span className="text-13 text-muted-foreground">{data.supply.unit}</span>
                    </span>
                    <StockBar quantity={st.quantity} min={st.minStock} />
                    {can("stock") ? (
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        mín.
                        <input
                          type="number"
                          min={0}
                          defaultValue={st.minStock}
                          onBlur={(e) => Number(e.target.value) !== st.minStock && setMin(st, Math.max(0, Number(e.target.value) || 0))}
                          className="h-7 w-16 border bg-background px-1.5 text-right text-13"
                        />
                      </label>
                    ) : (
                      <span className="text-xs text-muted-foreground">mín. {st.minStock}</span>
                    )}
                  </div>
                ))}
              </section>

              <section className="grid gap-2">
                <h3 className="text-sm font-semibold">Kardex</h3>
                <div className="overflow-x-auto border">
                  <table className="w-full min-w-[560px] text-left text-13">
                    <thead>
                      <tr className="border-b text-xs font-medium text-muted-foreground">
                        <th className="px-3 py-2">Fecha</th>
                        <th className="px-3 py-2">Movimiento</th>
                        {global && <th className="px-3 py-2">Sede</th>}
                        <th className="px-3 py-2 text-right">Cant.</th>
                        <th className="px-3 py-2 text-right">Saldo</th>
                        <th className="px-3 py-2">Por</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.movements.map((m) => (
                        <tr key={m.id}>
                          <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatDateTime(m.at)}</td>
                          <td className="px-3 py-2">
                            <span className="font-medium">{MOVEMENT_LABEL[m.kind] ?? m.kind}</span>
                            {(m.reason || m.note) && <span className="block text-xs text-muted-foreground">{[m.reason, m.note].filter(Boolean).join(" · ")}</span>}
                          </td>
                          {global && <td className="px-3 py-2">{m.site.code}</td>}
                          <td className={cn("px-3 py-2 text-right font-semibold tabular-nums", m.quantity > 0 ? "text-success" : "text-brand")}>
                            {m.quantity > 0 ? "+" : ""}
                            {m.quantity}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{m.balance}</td>
                          <td className="px-3 py-2 text-muted-foreground">{m.actorName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {data.movements.length === 0 && <p className="py-6 text-center text-13 text-muted-foreground">Sin movimientos.</p>}
                </div>
              </section>
            </>
          )}
        </SheetBody>
        {data && <StockTransferDialog open={transfer} supply={data.supply} fromSiteId={siteId} onClose={() => setTransfer(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function StockTransferDialog({ open, supply, fromSiteId, onClose }: { open: boolean; supply: Supply & { stock: SupplyStock[] }; fromSiteId: string; onClose: () => void }) {
  const meta = useInventoryMeta();
  const { run, pending } = useAction();
  const [toSiteId, setTo] = React.useState("");
  const [quantity, setQuantity] = React.useState("");
  const [note, setNote] = React.useState("");
  const available = supply.stock.find((s) => s.siteId === fromSiteId)?.quantity ?? 0;
  React.useEffect(() => {
    if (open) (setTo(""), setQuantity(""), setNote(""));
  }, [open]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() => api.post(`/inventory/supplies/${supply.id}/transfer`, { fromSiteId, toSiteId, quantity: Number(quantity), note: note || null }), { success: "Stock trasladado", invalidate });
    if (ok) onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader title="Trasladar stock" description={`${supply.name}: hay ${available} ${supply.unit} en esta sede.`} />
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Sede destino">
            <NativeSelect value={toSiteId} onChange={(e) => setTo(e.target.value)} required>
              <option value="">Elige una sede…</option>
              {meta.sites
                .filter((s) => s.active && s.id !== fromSiteId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <Field label="Cantidad">
            <Input type="number" min={1} max={available} value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          </Field>
          <Field label="Nota (opcional)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </Field>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" loading={pending} disabled={!toSiteId || Number(quantity) < 1 || Number(quantity) > available}>
              Trasladar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SupplyFormSheet({ target, siteId, onClose }: { target: Supply | "new" | null; siteId: string; onClose: () => void }) {
  const meta = useInventoryMeta();
  const { run, pending } = useAction();
  const isNew = target === "new";
  const blank = { sku: "", name: "", unit: "unid.", description: "", categoryId: "", defaultMin: "0", initial: "0", active: true };
  const [f, setF] = React.useState(blank);
  React.useEffect(() => {
    if (!target) return;
    setF(
      target === "new"
        ? { ...blank, categoryId: meta.supplyCats[0]?.id ?? "" }
        : { sku: target.sku, name: target.name, unit: target.unit, description: target.description ?? "", categoryId: target.categoryId ?? "", defaultMin: String(target.defaultMin), initial: "0", active: target.active },
    );
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      sku: f.sku,
      name: f.name,
      unit: f.unit,
      description: f.description || null,
      categoryId: f.categoryId || null,
      defaultMin: Number(f.defaultMin) || 0,
      active: f.active,
      ...(isNew ? { initial: [{ siteId, quantity: Number(f.initial) || 0, minStock: Number(f.defaultMin) || 0 }] } : {}),
    };
    const ok = await run(() => (isNew ? api.post("/inventory/supplies", body) : api.put(`/inventory/supplies/${(target as Supply).id}`, body)), { success: isNew ? "Insumo registrado" : "Insumo actualizado", invalidate });
    if (ok) onClose();
  };
  return (
    <Sheet open={!!target} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader title={isNew ? "Nuevo insumo" : "Editar insumo"} description="Artículo consumible con stock por sede." />
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetBody className="grid content-start gap-4">
            <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
              <Field label="SKU">
                <Input value={f.sku} onChange={(e) => set("sku", e.target.value.toUpperCase())} required maxLength={30} autoFocus={isNew} />
              </Field>
              <Field label="Nombre">
                <Input value={f.name} onChange={(e) => set("name", e.target.value)} required maxLength={80} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Categoría">
                <NativeSelect value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
                  <option value="">Sin categoría</option>
                  {meta.supplyCats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Unidad" hint="unid., caja, paquete, par…">
                <Input value={f.unit} onChange={(e) => set("unit", e.target.value)} required maxLength={16} />
              </Field>
              <Field label="Mínimo" hint="Debajo de este número salta la alerta">
                <Input type="number" min={0} value={f.defaultMin} onChange={(e) => set("defaultMin", e.target.value)} />
              </Field>
              {isNew && (
                <Field label="Stock inicial en esta sede">
                  <Input type="number" min={0} value={f.initial} onChange={(e) => set("initial", e.target.value)} />
                </Field>
              )}
            </div>
            <Field label="Descripción">
              <Textarea value={f.description} onChange={(e) => set("description", e.target.value)} className="min-h-16" maxLength={300} />
            </Field>
            {!isNew && <SwitchRow title="Insumo activo" description="Un insumo inactivo deja de mostrarse en el almacén." checked={f.active} onCheckedChange={(v) => set("active", v)} />}
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              {isNew ? "Registrar" : "Guardar cambios"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
