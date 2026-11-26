"use client";

import type { ApprovalConfig, ApprovalDelegationView, ApprovalRequestView, ApprovalWorkflowView } from "@erp/contracts";
import { Loader2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Field, money } from "@/components/field";
import { Modal } from "@/components/modal";
import { btnDanger, btnPrimary, btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

type Tab = "inbox" | "mine" | "all" | "delegations" | "flows";
type Role = { id: string; name: string };
const STATUS: Record<string, { label: string; tone: "warning" | "success" | "danger" | "neutral" | "info" }> = {
  PENDING: { label: "Pendiente", tone: "warning" }, APPROVED: { label: "Aprobada", tone: "info" }, EXECUTED: { label: "Aprobada y ejecutada", tone: "success" },
  REJECTED: { label: "Rechazada", tone: "danger" }, CANCELLED: { label: "Cancelada", tone: "neutral" },
};
const when = (iso: string) => new Date(iso).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" });

export function ApprovalsManager(p: {
  mine: ApprovalRequestView[]; inbox: ApprovalRequestView[]; all: ApprovalRequestView[]; delegations: ApprovalDelegationView[];
  candidates: { id: string; name: string }[]; workflows: ApprovalWorkflowView[]; roles: Role[]; canDecide: boolean; canManage: boolean;
}) {
  const [tab, setTab] = useState<Tab>(p.canDecide ? "inbox" : "mine");
  const tabs: { id: Tab; label: string; show: boolean; count?: number }[] = [
    { id: "inbox", label: "Por decidir", show: p.canDecide, count: p.inbox.length },
    { id: "mine", label: "Mis solicitudes", show: true },
    { id: "all", label: "Todas", show: p.canDecide || p.canManage },
    { id: "delegations", label: "Delegaciones", show: true },
    { id: "flows", label: "Flujos", show: true },
  ];
  return (
    <div className="grid gap-4">
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-line">
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} data-testid={`tab-${t.id}`} onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-[13px] font-medium ${tab === t.id ? "border-brand text-brand" : "border-transparent text-ink-2 hover:text-ink"}`}>
            {t.label}{t.count ? <span className="ml-2 rounded-full bg-warning-soft px-2 py-0.5 text-xs text-warning">{t.count}</span> : null}
          </button>
        ))}
      </div>
      {tab === "inbox" && <RequestList rows={p.inbox} empty="No tienes solicitudes pendientes de tu decisión." canDecide />}
      {tab === "mine" && <RequestList rows={p.mine} empty="Aún no has pedido ninguna aprobación. Se piden desde la operación que las necesita, por ejemplo al anular una venta." />}
      {tab === "all" && <RequestList rows={p.all} empty="No hay solicitudes." canDecide={p.canDecide} />}
      {tab === "delegations" && <Delegations rows={p.delegations} candidates={p.candidates} canDecide={p.canDecide} />}
      {tab === "flows" && <Flows workflows={p.workflows} roles={p.roles} canManage={p.canManage} />}
    </div>
  );
}

function RequestList({ rows, empty, canDecide = false }: { rows: ApprovalRequestView[]; empty: string; canDecide?: boolean }) {
  const [open, setOpen] = useState<ApprovalRequestView | null>(null);
  return (
    <Card>
      {rows.length === 0 ? <EmptyState icon={ShieldCheck} title="Nada por aquí" description={empty} /> : (
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full text-left text-[13px]" data-testid="approval-rows">
            <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Solicitud</th><th className="px-3 font-medium">Pidió</th><th className="px-3 font-medium">Nivel</th><th className="px-3 text-right font-medium">Importe</th><th className="px-3 font-medium">Estado</th><th className="px-5" /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="h-[52px] border-b border-line-strong/40 text-body hover:bg-surface-muted">
                  <td className="px-5"><span className="font-medium text-ink">{r.title}</span><span className="block text-xs text-ink-3">{r.code} · {when(r.createdAt)}</span></td>
                  <td className="px-3">{r.requestedBy.name}</td>
                  <td className="px-3">{r.status === "PENDING" ? `${r.stepName} (${r.currentStep}/${r.totalSteps})${r.escalated ? " · escalada" : ""}` : "—"}</td>
                  <td className="px-3 text-right tabular-nums">{r.amount ? money(r.amount) : "—"}</td>
                  <td className="px-3"><StatusBadge tone={STATUS[r.status]?.tone}>{STATUS[r.status]?.label ?? r.status}</StatusBadge></td>
                  <td className="px-5 text-right"><button className={`${btnSecondary} h-8 px-3`} onClick={() => setOpen(r)} aria-label={`Abrir ${r.code}`}>{canDecide && r.canDecide ? "Revisar" : "Ver"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${open.code} · ${open.title}` : ""}>{open && <RequestDetail r={open} onDone={() => setOpen(null)} />}</Modal>
    </Card>
  );
}

function RequestDetail({ r, onDone }: { r: ApprovalRequestView; onDone: () => void }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const act = async (url: string, body?: unknown) => {
    setBusy(true); setErr(null);
    const res = await bff<ApprovalRequestView>(url, "POST", body);
    setBusy(false);
    if (!res.ok) return setErr(errorText(res));
    if (res.data.executionError) return setErr(res.data.executionError);
    router.refresh(); onDone();
  };
  return (
    <div className="grid gap-4 text-[13px]">
      <dl className="grid grid-cols-[110px_1fr] gap-y-1.5">
        <dt className="text-ink-2">Estado</dt><dd><StatusBadge tone={STATUS[r.status]?.tone}>{STATUS[r.status]?.label}</StatusBadge></dd>
        <dt className="text-ink-2">Pidió</dt><dd>{r.requestedBy.name}</dd>
        <dt className="text-ink-2">Motivo</dt><dd>{r.reason}</dd>
        {r.amount && <><dt className="text-ink-2">Importe</dt><dd className="tabular-nums">{money(r.amount)}</dd></>}
        {r.status === "PENDING" && <><dt className="text-ink-2">Nivel actual</dt><dd>{r.stepName} ({r.currentStep} de {r.totalSteps}){r.dueAt ? ` · plazo ${when(r.dueAt)}` : ""}{r.escalated ? " · escalada" : ""}</dd></>}
      </dl>
      {r.decisions.length > 0 && (
        <ol className="grid gap-1.5 rounded-lg border border-line bg-surface-muted p-3" data-testid="decisions">
          {r.decisions.map((d) => (
            <li key={d.step}><strong>{d.decision === "APPROVE" ? "Aprobó" : "Rechazó"}</strong> {d.by}{d.onBehalfOf ? ` (en nombre de ${d.onBehalfOf})` : ""} · nivel {d.step} · {when(d.at)}{d.note ? ` — “${d.note}”` : ""}</li>
          ))}
        </ol>
      )}
      {err && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-danger">{err}</p>}
      {r.canDecide && (
        <>
          <Field label="Nota (obligatoria al rechazar)"><textarea aria-label="Nota de la decisión" className={`${inputCls} h-20 py-2`} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="flex justify-end gap-2">
            <button className={btnDanger} disabled={busy} onClick={() => act(`/bff/api/approvals/requests/${r.id}/decide`, { decision: "REJECT", note })}>Rechazar</button>
            <button className={btnPrimary} disabled={busy} onClick={() => act(`/bff/api/approvals/requests/${r.id}/decide`, { decision: "APPROVE", note: note || undefined })}>{busy && <Loader2 className="size-4 animate-spin" />}Aprobar</button>
          </div>
        </>
      )}
      {r.status === "APPROVED" && <div className="flex justify-end"><button className={btnSecondary} disabled={busy} onClick={() => act(`/bff/api/approvals/requests/${r.id}/retry`)}>Reintentar ejecución</button></div>}
      {r.status === "PENDING" && !r.canDecide && <div className="flex justify-end"><button className={btnSecondary} disabled={busy} onClick={() => act(`/bff/api/approvals/requests/${r.id}/cancel`)}>Cancelar solicitud</button></div>}
    </div>
  );
}

function Delegations({ rows, candidates, canDecide }: { rows: ApprovalDelegationView[]; candidates: { id: string; name: string }[]; canDecide: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = new Date().toLocaleDateString("sv"); // fecha local (no UTC): evita "mañana" por la noche
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setErr(null);
    const res = await bff("/bff/api/approvals/delegations", "POST", { delegateUserId: f.get("who"), validFrom: f.get("from"), validTo: f.get("to") });
    setBusy(false);
    if (!res.ok) return setErr(errorText(res));
    setOpen(false); router.refresh();
  };
  const revoke = async (id: string) => { await bff(`/bff/api/approvals/delegations/${id}/revoke`, "POST"); router.refresh(); };
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] text-ink-2">Delegar es dejar que otra persona decida por ti mientras no estás. Sigue valiendo su propio permiso y queda registrado en nombre de quién decidió.</p>
        {canDecide && <button className={btnPrimary} onClick={() => setOpen(true)}>Delegar mis aprobaciones</button>}
      </div>
      {rows.length === 0 ? <EmptyState icon={ShieldCheck} title="Sin delegaciones" /> : (
        <table className="w-full text-left text-[13px]" data-testid="delegation-rows">
          <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="font-medium">De</th><th className="font-medium">Para</th><th className="font-medium">Vigencia</th><th className="font-medium">Estado</th><th /></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="h-[44px] border-b border-line-strong/40">
                <td>{d.delegator.name}</td><td>{d.delegate.name}</td><td>{d.validFrom} → {d.validTo}</td>
                <td><StatusBadge tone={d.active ? "success" : "neutral"}>{d.revoked ? "Revocada" : d.active ? "Vigente" : "Fuera de fecha"}</StatusBadge></td>
                <td className="text-right">{!d.revoked && <button className={`${btnSecondary} h-8 px-3`} onClick={() => revoke(d.id)}>Revocar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Delegar mis aprobaciones">
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Delegar en"><select name="who" aria-label="Delegar en" required className={inputCls}><option value="">Elige a una persona…</option>{candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Desde"><input name="from" aria-label="Desde" type="date" required defaultValue={today} className={inputCls} /></Field>
            <Field label="Hasta"><input name="to" aria-label="Hasta" type="date" required defaultValue={today} className={inputCls} /></Field>
          </div>
          {err && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{err}</p>}
          <div className="flex justify-end gap-2"><button type="button" className={btnSecondary} onClick={() => setOpen(false)}>Cancelar</button><button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />}Guardar delegación</button></div>
        </form>
      </Modal>
    </Card>
  );
}

function Flows({ workflows, roles, canManage }: { workflows: ApprovalWorkflowView[]; roles: Role[]; canManage: boolean }) {
  const [edit, setEdit] = useState<ApprovalWorkflowView | null>(null);
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? "Rol";
  return (
    <Card>
      <table className="w-full text-left text-[13px]" data-testid="flow-rows">
        <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="font-medium">Operación</th><th className="font-medium">Estado</th><th className="font-medium">Regla</th><th /></tr></thead>
        <tbody>
          {workflows.map((w) => (
            <tr key={w.eventType} className="h-[48px] border-b border-line-strong/40 align-middle">
              <td><span className="font-medium text-ink">{w.label}</span>{!w.executable && <span className="block text-xs text-ink-3">Registra la aprobación; el módulo la consulta</span>}</td>
              <td><StatusBadge tone={w.enabled ? "success" : "neutral"}>{w.enabled ? "Activo" : "Sin aprobación"}</StatusBadge></td>
              <td className="text-ink-2">{w.config ? w.config.steps.map((s) => `${s.name}: ${s.roleIds.map(roleName).join(", ") || "usuarios elegidos"}`).join(" → ") + (w.config.minAmount ? ` · desde ${money(w.config.minAmount)}` : "") : "—"}</td>
              <td className="text-right">{canManage && <button className={`${btnSecondary} h-8 px-3`} onClick={() => setEdit(w)} aria-label={`Configurar ${w.label}`}>Configurar</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? `Flujo: ${edit.label}` : ""} size="lg">{edit && <FlowForm w={edit} roles={roles} onDone={() => setEdit(null)} />}</Modal>
    </Card>
  );
}

type StepForm = { name: string; roleId: string; dueHours: string; escalateRoleId: string };

function FlowForm({ w, roles, onDone }: { w: ApprovalWorkflowView; roles: Role[]; onDone: () => void }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(w.enabled);
  const [min, setMin] = useState(w.config?.minAmount?.toString() ?? "");
  const [self, setSelf] = useState(w.config?.forbidSelfApproval ?? true);
  const [steps, setSteps] = useState<StepForm[]>(w.config
    ? w.config.steps.map((s) => ({ name: s.name, roleId: s.roleIds[0] ?? "", dueHours: s.dueHours?.toString() ?? "", escalateRoleId: s.escalateTo?.roleIds[0] ?? "" }))
    : [{ name: "Gerencia", roleId: "", dueHours: "", escalateRoleId: "" }]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const upd = (i: number, k: keyof StepForm, v: string) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (steps.some((s) => !s.roleId)) return setErr("Elige el rol aprobador de cada nivel.");
    const config: ApprovalConfig = {
      forbidSelfApproval: self, ...(min ? { minAmount: Number(min) } : {}),
      steps: steps.map((s) => ({
        name: s.name.trim() || "Nivel", roleIds: [s.roleId], userIds: [],
        ...(s.dueHours ? { dueHours: Number(s.dueHours) } : {}),
        ...(s.dueHours && s.escalateRoleId ? { escalateTo: { roleIds: [s.escalateRoleId], userIds: [] } } : {}),
      })),
    };
    setBusy(true); setErr(null);
    const res = await bff(`/bff/api/approvals/workflows/${w.eventType}`, "PUT", { enabled, config });
    setBusy(false);
    if (!res.ok) return setErr(errorText(res));
    router.refresh(); onDone();
  };
  return (
    <form onSubmit={submit} className="grid gap-4 text-[13px]">
      <label className="flex items-center gap-2"><input type="checkbox" aria-label="Exigir aprobación" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Exigir aprobación para esta operación</label>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Solo desde este importe" hint="Vacío = siempre"><input aria-label="Importe mínimo" type="number" min="0" step="0.01" className={inputCls} value={min} onChange={(e) => setMin(e.target.value)} /></Field>
        <label className="flex items-end gap-2 pb-2"><input type="checkbox" aria-label="Quien pide no puede aprobar" checked={self} onChange={(e) => setSelf(e.target.checked)} />Quien pide no puede aprobar lo suyo</label>
      </div>
      {steps.map((s, i) => (
        <fieldset key={i} className="grid gap-3 rounded-lg border border-line p-3">
          <legend className="px-1 text-xs font-medium text-ink-2">Nivel {i + 1}</legend>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre"><input aria-label={`Nombre del nivel ${i + 1}`} className={inputCls} value={s.name} onChange={(e) => upd(i, "name", e.target.value)} /></Field>
            <Field label="Aprueba el rol"><select aria-label={`Rol aprobador ${i + 1}`} className={inputCls} value={s.roleId} onChange={(e) => upd(i, "roleId", e.target.value)}><option value="">Elige un rol…</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
            <Field label="Plazo en horas" hint="Vencido, amplía a otro rol"><input aria-label={`Plazo del nivel ${i + 1}`} type="number" min="1" className={inputCls} value={s.dueHours} onChange={(e) => upd(i, "dueHours", e.target.value)} /></Field>
            <Field label="Escala al rol"><select aria-label={`Escala del nivel ${i + 1}`} className={inputCls} value={s.escalateRoleId} disabled={!s.dueHours} onChange={(e) => upd(i, "escalateRoleId", e.target.value)}><option value="">Sin escalamiento</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
          </div>
          {steps.length > 1 && <button type="button" className={`${btnSecondary} h-8 w-fit px-3`} onClick={() => setSteps((x) => x.filter((_, j) => j !== i))}>Quitar nivel</button>}
        </fieldset>
      ))}
      {steps.length < 5 && <button type="button" className={`${btnSecondary} w-fit`} onClick={() => setSteps((x) => [...x, { name: `Nivel ${x.length + 1}`, roleId: "", dueHours: "", escalateRoleId: "" }])}>Agregar otro nivel</button>}
      {err && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-danger">{err}</p>}
      <div className="flex justify-end gap-2"><button type="button" className={btnSecondary} onClick={onDone}>Cancelar</button><button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />}Guardar flujo</button></div>
    </form>
  );
}
