"use client";

import { Building2, Check, ChevronDown, LogOut, Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChangePasswordButton } from "@/components/change-password";
import { NotificationBell } from "@/components/notification-bell";
import { BREADCRUMBS } from "@/lib/nav";
// Debe coincidir con BRANCH_COOKIE de lib/session (no se importa para no arrastrar API_URL al cliente).
const BRANCH_COOKIE = "erp_branch";

export interface TopbarProps {
  tenantName: string;
  /** Sucursal elegida (UUID o "ALL"); undefined = alcance por defecto. */
  currentBranch?: string;
  /** Sucursales accesibles para el usuario. */
  branches: { id: string; code: string; name: string }[];
  /** true si puede consultar "Todas las sucursales" y tiene más de una. */
  canViewAll: boolean;
  user: { name: string; email: string };
  onMenu: () => void;
  menuIcon: ReactNode;
}

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", click);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", click);
      document.removeEventListener("keydown", key);
    };
  }, [open, close]);
  return ref;
}

export function Topbar({ tenantName, currentBranch, branches, canViewAll, user, onMenu, menuIcon }: TopbarProps) {
  const pathname = usePathname();
  const crumb = BREADCRUMBS[pathname] ?? "";

  return (
    <header className="sticky top-0 z-20 flex h-[68px] items-center gap-3 border-b border-line bg-surface px-4 sm:px-7">
      <button className="rounded-md p-2 text-ink-2 hover:bg-neutral-soft lg:hidden" onClick={onMenu} aria-label="Abrir menú">
        {menuIcon}
      </button>
      <nav aria-label="Ruta de navegación" className="hidden text-[13px] text-ink-2 md:block">
        <span>Inicio</span>
        {crumb && <span aria-hidden> / </span>}
        <span className="font-medium text-ink">{crumb}</span>
      </nav>
      <BranchSelector tenantName={tenantName} current={currentBranch} branches={branches} canViewAll={canViewAll} />

      <div className="ml-auto flex items-center gap-3">
        <div
          className="hidden h-10 w-[280px] items-center gap-2 rounded-lg border border-line-strong bg-surface-muted px-3 text-ink-3 xl:flex"
          title="Búsqueda global: próximamente"
        >
          <Search className="size-4" aria-hidden />
          <span className="text-[13px]">Buscar en el sistema…</span>
          <kbd className="ml-auto rounded border border-line-strong bg-surface px-1.5 text-[11px]">Ctrl K</kbd>
        </div>
        <NotificationBell />
        <UserMenu user={user} />
      </div>
    </header>
  );
}

function BranchSelector({
  tenantName, current, branches, canViewAll,
}: { tenantName: string; current?: string; branches: TopbarProps["branches"]; canViewAll: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));

  const effective = current && (current === "ALL" ? canViewAll : branches.some((b) => b.id === current))
    ? current
    : canViewAll ? "ALL" : branches[0]?.id;
  const label =
    effective === "ALL" ? "Todas las sucursales" : (branches.find((b) => b.id === effective)?.name ?? "Sucursal");

  const choose = (value: string) => {
    document.cookie = `${BRANCH_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
    setOpen(false);
    router.refresh();
  };

  const options = [...(canViewAll ? [{ id: "ALL", name: "Todas las sucursales", code: "" }] : []), ...branches];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-[13px] hover:bg-surface-muted"
      >
        <Building2 className="size-4 text-ink-2" aria-hidden />
        <span className="hidden max-w-[160px] truncate text-ink-2 sm:inline">{tenantName}</span>
        <span className="hidden text-ink-3 sm:inline">/</span>
        <span className="max-w-[160px] truncate font-medium text-ink">{label}</span>
        <ChevronDown className="size-4 text-ink-3" aria-hidden />
      </button>
      {open && (
        <ul role="listbox" aria-label="Sucursal de trabajo" className="absolute left-0 top-12 z-40 min-w-[260px] rounded-lg border border-line bg-surface p-1.5 shadow-popover">
          {options.map((o) => (
            <li key={o.id} role="option" aria-selected={o.id === effective}>
              <button
                onClick={() => choose(o.id)}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] hover:bg-surface-muted"
              >
                <span className="flex-1">
                  {o.name}
                  {o.code && <span className="ml-2 text-xs text-ink-3">{o.code}</span>}
                </span>
                {o.id === effective && <Check className="size-4 text-brand" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UserMenu({ user }: { user: { name: string; email: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const initials = user.name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");

  const logout = async () => {
    setBusy(true);
    await fetch("/bff/auth/logout", { method: "POST" }).catch(() => null);
    router.replace("/login");
    router.refresh();
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menú de usuario"
        className="grid size-10 place-items-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand-hover"
      >
        {initials || "U"}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 z-40 w-64 rounded-lg border border-line bg-surface p-1.5 shadow-popover">
          <div className="border-b border-line px-3 pb-2.5 pt-2">
            <p className="truncate font-medium text-ink">{user.name}</p>
            <p className="truncate text-xs text-ink-2">{user.email}</p>
          </div>
          <div role="menuitem" className="mt-1.5"><ChangePasswordButton className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[13px] text-body hover:bg-surface-muted" label="Cambiar mi contraseña" /></div>
          <button
            role="menuitem"
            onClick={logout}
            disabled={busy}
            className="mt-1.5 flex w-full items-center gap-2 rounded-md px-3 py-2 text-[13px] text-danger hover:bg-danger-soft disabled:opacity-60"
          >
            <LogOut className="size-4" aria-hidden /> Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}
