import * as React from "react";
import { Dialog as DialogPrimitive, DropdownMenu as DM, AlertDialog as AD } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "./button";

// ── Sheet (drawer lateral para Nuevo / Editar / Detalle) ──

export const Sheet = DialogPrimitive.Root;

export function SheetContent({
  className,
  children,
  size = "md",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { size?: "md" | "lg" | "xl" }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in" />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-background shadow-lg outline-none data-[state=open]:animate-slide-in-right",
          size === "md" && "sm:max-w-lg",
          size === "lg" && "sm:max-w-2xl",
          size === "xl" && "sm:max-w-4xl",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ title, description }: { title: React.ReactNode; description?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
      <div className="grid gap-1">
        <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Description className={cn("text-13 text-muted-foreground", !description && "sr-only")}>
          {description ?? title}
        </DialogPrimitive.Description>
      </div>
      <DialogPrimitive.Close className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "-mr-2")} aria-label="Cerrar">
        <X />
      </DialogPrimitive.Close>
    </div>
  );
}

export function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex-1 overflow-y-auto px-6 py-5", className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-center justify-end gap-2 border-t bg-surface/60 px-6 py-3", className)} {...props} />;
}

// ── Dialog (detalle simple / formularios cortos) ──

export const Dialog = DialogPrimitive.Root;

export function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in" />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-background p-6 shadow-lg outline-none data-[state=open]:animate-in",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ title, description }: { title: React.ReactNode; description?: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
      <DialogPrimitive.Description className={cn("text-13 text-muted-foreground", !description && "sr-only")}>
        {description ?? title}
      </DialogPrimitive.Description>
    </div>
  );
}

export const DialogClose = DialogPrimitive.Close;

// ── Dropdown (kebab menu, menú de usuario) ──

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;

export function DropdownMenuContent({ className, align = "end", sideOffset = 6, ...props }: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-44 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in",
          className,
        )}
        {...props}
      />
    </DM.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: React.ComponentProps<typeof DM.Item> & { destructive?: boolean }) {
  return (
    <DM.Item
      className={cn(
        "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-13 outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground",
        destructive && "text-destructive data-[highlighted]:bg-destructive/10 [&_svg]:text-destructive",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)} {...props} />;
}

export function DropdownMenuSeparator() {
  return <DM.Separator className="-mx-1 my-1 h-px bg-border" />;
}

// ── Confirmación ──

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmText?: string;
  destructive?: boolean;
};

const ConfirmContext = React.createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = React.useCallback(
    (o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...o, resolve })),
    [],
  );
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AD.Root open={!!state} onOpenChange={(o) => !o && close(false)}>
        <AD.Portal>
          <AD.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in" />
          <AD.Content className="fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-32px)] max-w-sm -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-background p-6 shadow-lg data-[state=open]:animate-in">
            <div className="grid gap-1.5">
              <AD.Title className="text-base font-semibold">{state?.title}</AD.Title>
              <AD.Description className="text-13 text-muted-foreground">
                {state?.description ?? "Esta acción no se puede deshacer."}
              </AD.Description>
            </div>
            <div className="flex justify-end gap-2">
              <AD.Cancel asChild>
                <Button variant="outline">Cancelar</Button>
              </AD.Cancel>
              <AD.Action asChild>
                <Button variant={state?.destructive ? "destructive" : "default"} onClick={() => close(true)}>
                  {state?.confirmText ?? "Confirmar"}
                </Button>
              </AD.Action>
            </div>
          </AD.Content>
        </AD.Portal>
      </AD.Root>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => React.useContext(ConfirmContext);
