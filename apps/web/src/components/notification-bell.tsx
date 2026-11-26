"use client";

import type { NotificationView } from "@erp/contracts";
import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { bff } from "@/lib/client-api";

type Feed = { items: NotificationView[]; unread: number };

/** Campana de avisos del usuario: se actualiza cada minuto y al abrirla; marcar leído es explícito. */
export function NotificationBell() {
  const router = useRouter();
  const [feed, setFeed] = useState<Feed>({ items: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await bff<Feed>("/bff/api/notifications", "GET");
    if (r.ok) setFeed(r.data);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", click);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", click); document.removeEventListener("keydown", key); };
  }, [open]);

  const openItem = async (n: NotificationView) => {
    if (!n.read) await bff(`/bff/api/notifications/${n.id}/read`, "POST");
    setOpen(false);
    await load();
    if (n.link) router.push(n.link);
  };
  const readAll = async () => { await bff("/bff/api/notifications/read", "POST"); await load(); };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => { setOpen((o) => !o); void load(); }} aria-label={feed.unread ? `Avisos (${feed.unread} sin leer)` : "Avisos"} aria-expanded={open} data-testid="bell"
        className="relative rounded-md p-2 text-ink-2 hover:bg-neutral-soft">
        <Bell className="size-5" aria-hidden />
        {feed.unread > 0 && <span data-testid="bell-count" className="absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[11px] font-semibold text-white">{feed.unread > 99 ? "99+" : feed.unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Avisos" className="absolute right-0 top-11 z-30 w-[340px] max-w-[92vw] rounded-lg border border-line bg-surface shadow-popover">
          <div className="flex items-center justify-between border-b border-line px-4 py-3"><span className="text-[13px] font-semibold text-ink">Avisos</span>{feed.unread > 0 && <button className="text-xs font-medium text-brand" onClick={readAll}>Marcar todo como leído</button>}</div>
          <ul className="max-h-[360px] overflow-y-auto" data-testid="bell-list">
            {feed.items.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-ink-3">No tienes avisos.</li>}
            {feed.items.map((n) => (
              <li key={n.id}>
                <button onClick={() => openItem(n)} className={`block w-full border-b border-line-strong/30 px-4 py-3 text-left hover:bg-surface-muted ${n.read ? "" : "bg-brand-soft/40"}`}>
                  <span className={`block text-[13px] ${n.read ? "text-body" : "font-semibold text-ink"}`}>{n.title}</span>
                  {n.body && <span className="mt-0.5 block text-xs text-ink-2">{n.body}</span>}
                  <span className="mt-1 block text-[11px] text-ink-3">{new Date(n.createdAt).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" })}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
