"use client";

import { ChevronDown, Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { activeItemId, type NavGroup } from "@/lib/nav";
import { ICONS } from "./icons";
import { Topbar, type TopbarProps } from "./topbar";

const COLLAPSE_KEY = "erp:sidebar-collapsed";
const OPEN_KEY = "erp:nav-open";

interface Props extends Omit<TopbarProps, "onMenu" | "menuIcon"> {
  groups: NavGroup[];
  children: ReactNode;
}

export function AppShell({ groups, children, ...topbar }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const activeId = activeItemId(groups, pathname);
  const activeGroup = groups.find((g) => g.items.some((i) => i.id === activeId))?.id;

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {}
  }, []);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]") as string[];
      setOpen(new Set(saved));
    } catch {}
  }, []);
  useEffect(() => setDrawer(false), [pathname]);
  // La sección de la pantalla actual siempre se ve abierta.
  useEffect(() => { if (activeGroup) setOpen((o) => (o.has(activeGroup) ? o : new Set(o).add(activeGroup))); }, [activeGroup]);

  const toggleGroup = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id); else n.add(id);
      try { localStorage.setItem(OPEN_KEY, JSON.stringify([...n])); } catch {}
      return n;
    });
  /** Con la barra reducida, tocar una sección la despliega. */
  const expandGroup = (id: string) => {
    setCollapsed(false);
    try { localStorage.setItem(COLLAPSE_KEY, "0"); } catch {}
    setOpen((o) => new Set(o).add(id));
  };

  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {}
      return !c;
    });

  return (
    <div className="min-h-screen">
      {drawer && <div className="fixed inset-0 z-30 bg-ink/40 lg:hidden" onClick={() => setDrawer(false)} aria-hidden />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-line bg-surface transition-[width,transform] duration-200
          ${drawer ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0
          w-[248px] ${collapsed ? "lg:w-[72px]" : "lg:w-[248px]"}`}
        aria-label="Navegación principal"
      >
        <div className={`flex h-[76px] shrink-0 items-center gap-3 border-b border-line px-5 ${collapsed ? "lg:justify-center lg:px-0" : ""}`}>
          <span aria-hidden className="size-9 shrink-0 rounded-lg" style={{ backgroundImage: "url(/login/01_brand_logo_nexus_erp.png)", backgroundSize: "156px auto", backgroundPosition: "-7px -3px", backgroundRepeat: "no-repeat" }} />
          <div className={collapsed ? "lg:hidden" : ""}>
            <p className="font-semibold leading-tight text-ink">NEXUS ERP</p>
            <p className="text-xs text-ink-2">Gestión empresarial</p>
          </div>
          <button className="ml-auto rounded-md p-1.5 text-ink-2 hover:bg-neutral-soft lg:hidden" onClick={() => setDrawer(false)} aria-label="Cerrar menú">
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4" data-testid="sidebar-nav">
          <ul className="space-y-0.5">
            {groups.map((g) => {
              const Icon = ICONS[g.icon]!;
              const isOpen = open.has(g.id);
              const hasActive = g.id === activeGroup;
              const row = `flex h-10 w-full items-center gap-3 rounded-lg px-3 text-[13px] ${collapsed ? "lg:justify-center lg:px-0" : ""}`;
              if (g.direct) {
                const item = g.items[0]!;
                const active = item.id === activeId;
                return (
                  <li key={g.id}>
                    <Link href={item.route} title={collapsed ? g.label : undefined} aria-current={active ? "page" : undefined}
                      className={`${row} ${active ? "bg-brand-soft font-semibold text-brand-hover" : "text-body hover:bg-surface-muted"}`}>
                      <Icon className={`size-[18px] shrink-0 ${active ? "text-brand" : ""}`} aria-hidden />
                      <span className={`truncate ${collapsed ? "lg:hidden" : ""}`}>{g.label}</span>
                    </Link>
                  </li>
                );
              }
              return (
                <li key={g.id}>
                  <button type="button" data-testid={`nav-group-${g.id}`} aria-expanded={isOpen && !collapsed}
                    title={collapsed ? g.label : undefined}
                    onClick={() => (collapsed ? expandGroup(g.id) : toggleGroup(g.id))}
                    className={`${row} ${hasActive ? "font-semibold text-ink" : "text-body"} hover:bg-surface-muted`}>
                    <Icon className={`size-[18px] shrink-0 ${hasActive ? "text-brand" : ""}`} aria-hidden />
                    <span className={`truncate ${collapsed ? "lg:hidden" : ""}`}>{g.label}</span>
                    <ChevronDown className={`ml-auto size-4 shrink-0 text-ink-3 transition-transform ${isOpen ? "" : "-rotate-90"} ${collapsed ? "lg:hidden" : ""}`} aria-hidden />
                  </button>
                  {isOpen && !collapsed && (
                    <ul className="mb-1 ml-[17px] mt-0.5 space-y-0.5 border-l border-line pl-2">
                      {g.items.map((item) => {
                        const ItemIcon = ICONS[item.icon]!;
                        const active = item.id === activeId;
                        const cls = "flex h-9 items-center gap-2.5 rounded-lg px-3 text-[13px]";
                        const inner = (
                          <>
                            <ItemIcon className={`size-4 shrink-0 ${active ? "text-brand" : "text-ink-3"}`} aria-hidden />
                            <span className="truncate">{item.label}</span>
                            {!item.ready && <span className="ml-auto rounded-full bg-neutral-soft px-2 py-0.5 text-[10px] font-medium text-ink-3">Pronto</span>}
                          </>
                        );
                        return (
                          <li key={item.id}>
                            {item.ready ? (
                              <Link href={item.route} aria-current={active ? "page" : undefined}
                                className={`${cls} ${active ? "bg-brand-soft font-semibold text-brand-hover" : "text-body hover:bg-surface-muted"}`}>{inner}</Link>
                            ) : (
                              <span aria-disabled="true" title={`${item.label}: módulo en construcción`} className={`${cls} cursor-not-allowed text-ink-3`}>{inner}</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="hidden border-t border-line p-3 lg:block">
          <button
            onClick={toggle}
            className="flex h-9 w-full items-center gap-3 rounded-lg px-3 text-[13px] text-ink-2 hover:bg-surface-muted"
            aria-label={collapsed ? "Expandir barra lateral" : "Contraer barra lateral"}
          >
            {collapsed ? <PanelLeftOpen className="mx-auto size-[18px]" /> : <><PanelLeftClose className="size-[18px]" /> Contraer</>}
          </button>
        </div>
      </aside>

      <div className={`transition-[padding] duration-200 ${collapsed ? "lg:pl-[72px]" : "lg:pl-[248px]"}`}>
        <Topbar {...topbar} onMenu={() => setDrawer(true)} menuIcon={<Menu className="size-5" />} />
        <main className="mx-auto max-w-[1600px] p-4 sm:p-7">{children}</main>
      </div>
    </div>
  );
}
