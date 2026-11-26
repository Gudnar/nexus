"use client";

import type { CreateTenantResult, PlatformPlanView, PlatformTenantView } from "@erp/contracts";
import { Building2, Check, Copy, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Field } from "@/components/field";
import { Modal } from "@/components/modal";
import { btnPrimary, btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  ACTIVE: { label: "Activa", tone: "success" }, TRIAL: { label: "En prueba", tone: "warning" }, SUSPENDED: { label: "Suspendida", tone: "danger" }, CANCELLED: { label: "Cancelada", tone: "neutral" },
};

/** Empresas clientes: estado, plan y totales. Nunca muestra datos de negocio de la empresa. */
export function TenantsManager({ tenants, plans }: { tenants: PlatformTenantView[]; plans: PlatformPlanView[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<CreateTenantResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(t: PlatformTenantView, body: { status?: string; planCode?: string }) {
    if (body.status === "SUSPENDED" && !window.confirm(`¿Suspender «${t.legalName}»? Sus usuarios no podrán entrar y se cerrarán sus sesiones abiertas.`)) return;
    setError(null);
    const r = await bff(`/bff/platform/tenants/${t.id}`, "PATCH", body);
    if (!r.ok) return setError(errorText(r));
    router.refresh();
  }

  return (
    <div className="grid gap-4">
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">{error}</p>}
      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[13px] text-ink-2">Cada empresa tiene su propio administrador y sus datos separados. Aquí solo ves su cuenta, no su información de negocio.</p>
          <button className={btnPrimary} onClick={() => setCreating(true)}>Nueva empresa</button>
        </div>
        {tenants.length === 0 ? <EmptyState icon={Building2} title="Aún no hay empresas" /> : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]" data-testid="tenant-rows">
              <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Empresa</th><th className="px-3 font-medium">Plan</th><th className="px-3 font-medium">Estado</th><th className="px-3 text-right font-medium">Usuarios</th><th className="px-3 text-right font-medium">Sucursales</th><th className="px-3 font-medium">Alta</th><th className="px-5" /></tr></thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id} className="h-[52px] border-b border-line-strong/40 text-body">
                    <td className="px-5"><span className="font-medium text-ink">{t.legalName}</span><span className="block text-xs text-ink-3">{t.slug}{t.taxId ? ` · NIT ${t.taxId}` : ""}</span></td>
                    <td className="px-3">
                      <select aria-label={`Plan de ${t.legalName}`} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px]" value={t.plan?.code ?? ""} onChange={(e) => patch(t, { planCode: e.target.value })} disabled={t.status === "CANCELLED"}>
                        {!t.plan && <option value="">Sin plan</option>}
                        {plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                      </select>
                    </td>
                    <td className="px-3"><StatusBadge tone={STATUS[t.status]?.tone}>{STATUS[t.status]?.label ?? t.status}</StatusBadge></td>
                    <td className="px-3 text-right tabular-nums">{t.users}</td><td className="px-3 text-right tabular-nums">{t.branches}</td>
                    <td className="px-3 text-ink-2">{new Date(t.createdAt).toLocaleDateString("es-BO")}</td>
                    <td className="px-5 text-right">
                      {t.status === "SUSPENDED" && <button className={`${btnSecondary} h-8 px-3`} onClick={() => patch(t, { status: "ACTIVE" })} aria-label={`Reactivar ${t.legalName}`}>Reactivar</button>}
                      {t.status === "TRIAL" && <button className={`${btnSecondary} mr-2 h-8 px-3`} onClick={() => patch(t, { status: "ACTIVE" })} aria-label={`Activar ${t.legalName}`}>Pasar a activa</button>}
                      {(t.status === "ACTIVE" || t.status === "TRIAL") && <button className={`${btnSecondary} h-8 px-3`} onClick={() => patch(t, { status: "SUSPENDED" })} aria-label={`Suspender ${t.legalName}`}>Suspender</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="Nueva empresa" size="lg">
        <CreateForm plans={plans} onCancel={() => setCreating(false)} onCreated={(r) => { setCreating(false); setResult(r); router.refresh(); }} />
      </Modal>
      <Modal open={!!result} onClose={() => setResult(null)} title="Empresa creada">{result && <Created r={result} onClose={() => setResult(null)} />}</Modal>
    </div>
  );
}

function CreateForm({ plans, onCancel, onCreated }: { plans: PlatformPlanView[]; onCancel: () => void; onCreated: (r: CreateTenantResult) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "").trim();
    setBusy(true); setError(null);
    const r = await bff<CreateTenantResult>("/bff/platform/tenants", "POST", {
      companyName: v("company"), taxId: v("tax") || undefined, planCode: v("plan"), status: v("status"),
      adminName: v("admin"), adminEmail: v("email"), adminUsername: v("username") || undefined,
    });
    setBusy(false);
    if (!r.ok) return setError(errorText(r, "No se pudo crear la empresa."));
    onCreated(r.data);
  }
  return (
    <form onSubmit={submit} className="grid gap-4 text-[13px]">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Razón social"><input name="company" aria-label="Razón social" required minLength={2} className={inputCls} /></Field>
        <Field label="NIT (opcional)"><input name="tax" aria-label="NIT" className={inputCls} /></Field>
        <Field label="Plan"><select name="plan" aria-label="Plan" required className={inputCls}>{plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></Field>
        <Field label="Estado inicial"><select name="status" aria-label="Estado inicial" className={inputCls}><option value="TRIAL">En prueba</option><option value="ACTIVE">Activa</option></select></Field>
      </div>
      <fieldset className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2">
        <legend className="px-1 text-xs font-medium text-ink-2">Administrador de la empresa</legend>
        <Field label="Nombre completo"><input name="admin" aria-label="Nombre del administrador" required minLength={2} className={inputCls} /></Field>
        <Field label="Correo"><input name="email" aria-label="Correo del administrador" type="email" required className={inputCls} /></Field>
        <Field label="Usuario (opcional)" hint="3 a 32: letras, números, punto o guion"><input name="username" aria-label="Usuario del administrador" className={inputCls} /></Field>
      </fieldset>
      <p className="text-xs text-ink-3">No se define ninguna contraseña: el administrador recibe un enlace de un solo uso para crear la suya. Si su correo ya tiene cuenta, entra con la que tiene.</p>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-danger">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button><button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />}Crear empresa</button></div>
    </form>
  );
}

function Created({ r, onClose }: { r: CreateTenantResult; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(r.setupUrl ?? ""); setCopied(true); } catch { /* se puede seleccionar a mano */ } };
  return (
    <div className="grid gap-4 text-[13px]" data-testid="tenant-created">
      <p><strong>{r.tenant.legalName}</strong> quedó creada ({STATUS[r.tenant.status]?.label.toLowerCase()}, identificador <code>{r.tenant.slug}</code>) con su sucursal central y sus cinco roles.</p>
      {r.setupUrl ? (
        <>
          <p>Para que el administrador cree su contraseña, envíale este enlace. {r.emailSent ? "También se lo enviamos por correo." : "No se pudo enviar el correo: compártelo tú."} Vence en 72 horas, sirve una sola vez y no volverá a mostrarse.</p>
          <div className="flex items-center gap-2"><input readOnly aria-label="Enlace de acceso" value={r.setupUrl} className={`${inputCls} font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} /><button className={btnSecondary} onClick={copy}>{copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}{copied ? "Copiado" : "Copiar"}</button></div>
        </>
      ) : <p>Ese correo ya tenía cuenta: entra con su contraseña de siempre y elige la empresa. {r.emailSent ? "Se le avisó por correo." : ""}</p>}
      <div className="flex justify-end"><button className={btnPrimary} onClick={onClose}>Listo</button></div>
    </div>
  );
}
