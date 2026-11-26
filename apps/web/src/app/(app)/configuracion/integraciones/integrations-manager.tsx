"use client";

import type { IntegrationTestResult, IntegrationView } from "@erp/contracts";
import { CheckCircle2, ImageIcon, Loader2, PlugZap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Field } from "@/components/field";
import { btnPrimary, btnSecondary, Card, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

export function IntegrationsManager({ integrations }: { integrations: IntegrationView[] }) {
  return (
    <div className="grid gap-5">
      {integrations.map((i) => i.provider === "CLOUDINARY" && <CloudinaryCard key={i.provider} view={i} />)}
      <p className="text-[13px] text-ink-3">Más integraciones llegarán aquí: pasarelas de pago, mensajería y facturación.</p>
    </div>
  );
}

function CloudinaryCard({ view }: { view: IntegrationView }) {
  const router = useRouter();
  const [open, setOpen] = useState(!view.configured);
  const [f, setF] = useState({ cloudName: view.config?.cloudName ?? "", apiKey: view.config?.apiKey ?? "", apiSecret: "", folder: view.config?.folder ?? "nexus/productos", enabled: view.enabled || !view.configured });
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await bff("/bff/api/integrations/cloudinary", "PUT", { cloudName: f.cloudName.trim(), apiKey: f.apiKey.trim(), ...(f.apiSecret.trim() ? { apiSecret: f.apiSecret.trim() } : {}), folder: f.folder.trim() || "nexus/productos", enabled: f.enabled });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: errorText(r, "No se pudo guardar.") });
    setMsg({ ok: true, text: "Datos guardados." });
    set("apiSecret", "");
    router.refresh();
  }

  async function test() {
    setTesting(true); setMsg(null);
    const r = await bff<IntegrationTestResult>("/bff/api/integrations/cloudinary/test", "POST");
    setTesting(false);
    setMsg(r.ok ? { ok: r.data.ok, text: r.data.message } : { ok: false, text: errorText(r) });
  }

  const status = !view.configured ? { tone: "neutral" as const, label: "Sin configurar" } : view.enabled ? { tone: "success" as const, label: "Activa" } : { tone: "warning" as const, label: "Desactivada" };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand" aria-hidden><ImageIcon className="size-5" /></span>
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink">{view.label} <StatusBadge tone={status.tone}>{status.label}</StatusBadge></h2>
            <p className="mt-1 max-w-xl text-[13px] text-ink-2">{view.description} Las fotos se suben directo a tu cuenta de Cloudinary desde el navegador; NEXUS solo guarda su dirección.</p>
            {view.configured && view.config && <p className="mt-1.5 text-xs text-ink-3" data-testid="cloudinary-summary">Nube <strong>{view.config.cloudName}</strong> · carpeta {view.config.folder} · API key {view.config.apiKey.slice(0, 4)}…{view.config.apiKey.slice(-3)}</p>}
          </div>
        </div>
        <button className={btnSecondary} onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Ocultar" : view.configured ? "Configurar" : "Conectar"}</button>
      </div>

      {open && (
        <form onSubmit={save} className="mt-5 grid gap-4 border-t border-line pt-5 text-[13px]" data-testid="cloudinary-form">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cloud name" hint="Lo ves en el panel de Cloudinary, arriba a la izquierda."><input aria-label="Cloud name" required className={inputCls} value={f.cloudName} onChange={(e) => set("cloudName", e.target.value)} placeholder="mi-tienda" autoComplete="off" /></Field>
            <Field label="API key"><input aria-label="API key" required inputMode="numeric" className={inputCls} value={f.apiKey} onChange={(e) => set("apiKey", e.target.value)} placeholder="123456789012345" autoComplete="off" /></Field>
            <Field label="API secret" hint={view.secretSet ? "Ya hay uno guardado. Déjalo vacío para conservarlo." : "Se guarda cifrado y no se vuelve a mostrar."}>
              <input aria-label="API secret" type="password" required={!view.secretSet} className={inputCls} value={f.apiSecret} onChange={(e) => set("apiSecret", e.target.value)} placeholder={view.secretSet ? "••••••••••••••••" : ""} autoComplete="new-password" />
            </Field>
            <Field label="Carpeta" hint="Dónde se ordenan las fotos en Cloudinary."><input aria-label="Carpeta" className={inputCls} value={f.folder} onChange={(e) => set("folder", e.target.value)} /></Field>
          </div>
          <label className="flex items-center gap-2.5"><input type="checkbox" className="size-4 accent-brand" aria-label="Integración activa" checked={f.enabled} onChange={(e) => set("enabled", e.target.checked)} />Integración activa (permite subir fotos a los productos)</label>
          {msg && <p role={msg.ok ? "status" : "alert"} data-testid="cloudinary-msg" className={`flex items-center gap-2 rounded-lg px-3 py-2 ${msg.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>{msg.ok && <CheckCircle2 className="size-4" aria-hidden />}{msg.text}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={btnSecondary} onClick={test} disabled={testing || !view.configured} title={view.configured ? undefined : "Guarda los datos primero"}>{testing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <PlugZap className="size-4" aria-hidden />}Probar conexión</button>
            <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />}Guardar</button>
          </div>
        </form>
      )}
    </Card>
  );
}
