"use client";

import type { CollectMode, SalesSettings } from "@erp/contracts";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { btnPrimary, Card } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

const OPTIONS: { id: CollectMode; title: string; text: string }[] = [
  { id: "AT_POS", title: "Se cobra en el punto de venta", text: "Para negocios sin cajero: quien vende también cobra desde la misma pantalla, con una o varias formas de pago. «Guardar» sigue disponible para dejar una venta pendiente." },
  { id: "AT_CASHIER", title: "Se cobra en caja (módulo «Ventas pendientes»)", text: "Para negocios con cajero: el punto de venta solo registra y guarda la venta; el cajero la cobra desde «Ventas pendientes». Solo quien tiene el permiso «Cobrar ventas guardadas (caja)» puede confirmar ventas." },
];

export function CollectModeForm({ initial }: { initial: CollectMode }) {
  const [mode, setMode] = useState<CollectMode>(initial);
  const [saved, setSaved] = useState<CollectMode>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true); setMsg(null);
    const r = await bff<SalesSettings>("/bff/api/sales/settings", "PUT", { collectMode: mode });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: errorText(r) });
    setSaved(r.data.collectMode); setMsg({ ok: true, text: "Guardado." });
  }

  return (
    <Card>
      <div className="grid gap-3" role="radiogroup" aria-label="Dónde se cobra" data-testid="collect-mode">
        {OPTIONS.map((o) => (
          <label key={o.id} className={`flex cursor-pointer gap-3 rounded-lg border px-4 py-3 ${mode === o.id ? "border-brand bg-brand-soft" : "border-line-strong hover:bg-surface-muted"}`}>
            <input type="radio" name="collectMode" className="mt-1" checked={mode === o.id} onChange={() => setMode(o.id)} data-testid={`mode-${o.id}`} />
            <span><span className="block text-[14px] font-semibold text-ink">{o.title}</span><span className="block text-[13px] text-ink-2">{o.text}</span></span>
          </label>
        ))}
      </div>
      {mode === "AT_CASHIER" && <p className="mt-3 rounded-lg bg-info-soft px-3 py-2 text-[12px] text-info">Los roles Administrador, Gerente y Cajero ya traen ese permiso. Asígnalo a otros roles desde «Usuarios y roles».</p>}
      <div className="mt-4 flex items-center gap-3">
        <button className={btnPrimary} onClick={() => void save()} disabled={busy || mode === saved} data-testid="save-mode">{busy && <Loader2 className="size-4 animate-spin" aria-hidden />}Guardar</button>
        {msg && <span role={msg.ok ? "status" : "alert"} className={`text-[13px] ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</span>}
      </div>
    </Card>
  );
}
