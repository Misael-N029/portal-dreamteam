import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col items-center gap-3 px-6 py-14 text-center", className)}>
      <div className="flex size-11 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <div className="grid max-w-sm gap-1">
        <p className="text-sm font-semibold">{title}</p>
        {description && <p className="text-13 text-muted-foreground">{description}</p>}
      </div>
      {action}
    </Card>
  );
}

export function NoAccess({ message = "Tu rol no tiene acceso a esta sección en la campaña seleccionada." }: { message?: string }) {
  return <EmptyState icon={ShieldAlert} title="Sin permisos" description={message} />;
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  accent?: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-13 text-muted-foreground">{label}</p>
        {Icon && <Icon className={cn("size-4", accent ? "text-brand" : "text-muted-foreground")} />}
      </div>
      <p className="mt-2 text-[28px] leading-none font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}
