"use client";

import { CASH_DENOMINATIONS, type CashRegisterSummary, type CashSessionDetail, type CashSessionSummary } from "@erp/contracts";
import { Loader2, Plus, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Field, money } from "@/components/field";
import { Modal } from "@/components/modal";
import { btnPrimary, btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

const METHOD: Record<string, string> = { CASH: "Efectivo", TRANSFER: "Transferencia", QR: "QR", CARD: "Tarjeta", CHEQUE: "Cheque" };
const STATUS: Record<string, [string, "success" | "warning" | "info" | "neutral"]> = { OPEN: ["Abierto", "success"], CLOSING: ["En cierre", "warning"], CLOSED: ["Cerrado", "neutral"] };
const TYPE: Record<string, string> = {
  OPENING: "Fondo inicial", SALE_PAYMENT: "Cobro de venta", REFUND: "Reintegro", INCOME: "Ingreso", EXPENSE: "Gasto", WITHDRAWAL: "Retiro",
  TRANSFER_IN: "Traspaso recibido", TRANSFER_OUT: "Traspaso enviado", REVERSAL: "Reverso",
};

interface Can { operate: boolean; close: boolean; manage: boolean; approve: boolean; reopen: boolean }
interface Props {
  registers: CashRegisterSummary[]; sessions: CashSessionSummary[]; mine: CashSessionSummary[]; tolerance: number;
  total: { method: string; income: string; outflow: string; net: string }[];
  members: { userId: string; name: string }[]; branches: { id: string; name: string }[]; can: Can;
}

export function CashManager({ registers, sessions, mine, tolerance, total, members, branches, can }: Props) {
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const [openId, setOpenId] = useState<string | null>(mine[0]?.id ?? null);
  const [regForm, setRegForm] = useState<CashRegisterSummary | "new" | null>(null);
  const [tol, setTol] = useState(String(tolerance));
  const [tolMsg, setTolMsg] = useState<string | null>(null);
  const refresh = () => router.refresh();
  const free = registers.filter((r) => r.status === "ACTIVE" && !r.activeSession);

  async function saveTolerance() {
    setTolMsg(null);
    const r = await bff("/bff/api/cash/settings", "PUT", { differenceTolerance: Number(tol) });
    setTolMsg(r.ok ? "Guardado." : errorText(r));
    if (r.ok) refresh();
  }

  return (
    <div className="grid gap-6">
      {can.operate && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-ink">Mi turno</h2>
            {mine.length === 0 && <button className={btnPrimary} onClick={() => setOpening(true)} disabled={free.length === 0}><Wallet className="size-4" aria-hidden /> Abrir turno</button>}
          </div>
          {mine.length === 0 ? (
            <p className="text-[13px] text-ink-2" data-testid="no-session">{free.length === 0 ? "No hay cajas libres en tus sucursales. Pide que creen una caja o espera a que se cierre otro turno." : "No tienes un turno abierto. Ábrelo para poder cobrar en efectivo."}</p>
          ) : (
            <ul className="grid gap-2">
              {mine.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3">
                  <div>
                    <span className="font-medium text-ink">{s.code} · {s.register.name}</span> <StatusBadge tone={STATUS[s.status]![1]}>{STATUS[s.status]![0]}</StatusBadge>
                    <span className="block text-xs text-ink-2">Efectivo esperado: <strong className="tabular-nums text-ink" data-testid="my-expected">{money(s.expectedCash)}</strong></span>
                  </div>
                  <button className={btnSecondary} onClick={() => setOpenId(s.id)}>Abrir turno en pantalla</button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-ink">Cajas</h2>
            {can.manage && <button className={btnSecondary} onClick={() => setRegForm("new")}><Plus className="size-4" aria-hidden /> Nueva caja</button>}
          </div>
          {registers.length === 0 ? (
            <EmptyState icon={Wallet} title="Aún no hay cajas" description={can.manage ? "Crea la primera con «Nueva caja». Mientras una sucursal no tenga cajas, sus cobros no exigen turno." : "Pide a un administrador que cree las cajas."} />
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Caja</th><th className="px-3 font-medium">Sucursal</th><th className="px-3 font-medium">Turno</th>{can.manage && <th className="px-5" />}</tr></thead>
                <tbody>
                  {registers.map((r) => (
                    <tr key={r.id} className="h-[48px] border-b border-line-strong/40 text-body hover:bg-surface-muted">
                      <td className="px-5"><span className="font-medium text-ink">{r.name}</span><span className="block text-xs text-ink-3">{r.code}{r.kind === "VAULT" ? " · bóveda" : ""}{r.status === "INACTIVE" ? " · inactiva" : ""}</span></td>
                      <td className="px-3">{r.branch.name}</td>
                      <td className="px-3">{r.activeSession ? <button className="text-brand hover:underline" onClick={() => setOpenId(r.activeSession!.id)}>{r.activeSession.code} · {r.activeSession.responsible} ({STATUS[r.activeSession.status]![0]})</button> : <span className="text-ink-3">Libre</span>}</td>
                      {can.manage && <td className="px-5 text-right"><button className={`${btnSecondary} h-8 px-3`} onClick={() => setRegForm(r)}>Editar</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-ink">Totales por medio de pago</h2>
          {total.length === 0 ? <p className="text-[13px] text-ink-2">Aún no hay movimientos.</p> : (
            <table className="w-full text-left text-[13px] tabular-nums">
              <thead><tr className="h-9 border-y border-line text-ink-2"><th className="font-medium">Medio</th><th className="text-right font-medium">Entradas</th><th className="text-right font-medium">Salidas</th><th className="text-right font-medium">Neto</th></tr></thead>
              <tbody>{total.map((t) => <tr key={t.method} className="h-9 border-b border-line-strong/40"><td>{METHOD[t.method] ?? t.method}</td><td className="text-right">{money(t.income)}</td><td className="text-right">{money(t.outflow)}</td><td className="text-right font-medium text-ink">{money(t.net)}</td></tr>)}</tbody>
            </table>
          )}
          {can.manage && (
            <div className="mt-5 border-t border-line pt-4">
              <Field label="Tolerancia de diferencia al cerrar" hint="Hasta este importe el cierre se aprueba solo (con justificación). Más: lo decide otra persona.">
                <div className="flex gap-2"><input type="number" min={0} step="any" className={inputCls} value={tol} onChange={(e) => setTol(e.target.value)} aria-label="Tolerancia" /><button className={btnSecondary} onClick={saveTolerance}>Guardar</button></div>
              </Field>
              {tolMsg && <p role="status" className="mt-1 text-xs text-ink-2">{tolMsg}</p>}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-4 text-base font-semibold text-ink">Turnos</h2>
        {sessions.length === 0 ? <p className="text-[13px] text-ink-2">Aún no hay turnos.</p> : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Turno</th><th className="px-3 font-medium">Caja</th><th className="px-3 font-medium">Responsable</th><th className="px-3 font-medium">Apertura</th><th className="px-3 text-right font-medium">Efectivo esperado</th><th className="px-3 font-medium">Estado</th><th className="px-5" /></tr></thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="h-[46px] border-b border-line-strong/40 text-body hover:bg-surface-muted">
                    <td className="px-5 font-medium text-ink">{s.code}</td><td className="px-3">{s.register.code}</td><td className="px-3">{s.responsible.name}</td>
                    <td className="px-3 text-ink-2" suppressHydrationWarning>{new Date(s.openedAt).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="px-3 text-right tabular-nums">{money(s.expectedCash)}</td>
                    <td className="px-3"><StatusBadge tone={STATUS[s.status]![1]}>{STATUS[s.status]![0]}</StatusBadge>{s.reopenedCount > 0 && <span className="ml-1 text-xs text-ink-3">reabierto</span>}</td>
                    <td className="px-5 text-right"><button className={`${btnSecondary} h-8 px-3`} onClick={() => setOpenId(s.id)}>Ver</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={opening} onClose={() => setOpening(false)} title="Abrir turno de caja" size="lg">
        {opening && <OpenForm registers={free} onDone={(id) => { setOpening(false); refresh(); setOpenId(id); }} onCancel={() => setOpening(false)} />}
      </Modal>
      <Modal open={openId !== null} onClose={() => setOpenId(null)} title="Turno de caja" size="lg">
        {openId && <SessionView key={openId} id={openId} can={can} members={members} onChanged={refresh} onClose={() => setOpenId(null)} />}
      </Modal>
      <Modal open={regForm !== null} onClose={() => setRegForm(null)} title={regForm === "new" ? "Nueva caja" : "Editar caja"}>
        {regForm && <RegisterForm register={regForm === "new" ? null : regForm} branches={branches} onDone={() => { setRegForm(null); refresh(); }} onCancel={() => setRegForm(null)} />}
      </Modal>
    </div>
  );
}

// ───────────── Denominaciones ─────────────

function Denominations({ value, onChange, label }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void; label: string }) {
  const total = Object.entries(value).reduce((s, [k, n]) => s + Number(k) * Number(n || 0), 0);
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-medium text-ink-2">{label}</legend>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {CASH_DENOMINATIONS.map((d) => (
          <label key={d} className="grid gap-1 text-xs text-ink-2">
            <span>Bs {d}</span>
            <input type="number" min={0} step={1} className={inputCls} value={value[d] ?? ""} onChange={(e) => onChange({ ...value, [d]: e.target.value })} aria-label={`Cantidad de Bs ${d}`} />
          </label>
        ))}
      </div>
      <p className="mt-2 text-[13px] text-ink-2">Total contado: <strong className="tabular-nums text-ink" data-testid="denom-total">{money(total)}</strong></p>
    </fieldset>
  );
}
const toNumbers = (v: Record<string, string>) => Object.fromEntries(Object.entries(v).filter(([, n]) => n !== "" && Number(n) > 0).map(([k, n]) => [k, Number(n)]));

// ───────────── Apertura ─────────────

function OpenForm({ registers, onDone, onCancel }: { registers: CashRegisterSummary[]; onDone: (id: string) => void; onCancel: () => void }) {
  const branchOpts = [...new Map(registers.map((r) => [r.branch.id, r.branch.name])).entries()];
  const [branchId, setBranchId] = useState(registers[0]?.branch.id ?? "");
  const inBranch = registers.filter((r) => r.branch.id === branchId);
  const [registerId, setRegisterId] = useState(inBranch[0]?.id ?? "");
  const [dens, setDens] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await bff<CashSessionDetail>("/bff/api/cash/sessions", "POST", { registerId, denominations: toNumbers(dens) });
    setBusy(false);
    if (r.ok) return onDone(r.data.id);
    setError(errorText(r));
  }
  return (
    <form onSubmit={submit} className="grid gap-5">
      <Field label="Sucursal"><select className={inputCls} value={branchId} onChange={(e) => { setBranchId(e.target.value); setRegisterId(registers.find((r) => r.branch.id === e.target.value)?.id ?? ""); }} aria-label="Sucursal">{branchOpts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
      <Field label="Caja"><select className={inputCls} value={registerId} onChange={(e) => setRegisterId(e.target.value)} aria-label="Caja">{inBranch.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.code})</option>)}</select></Field>
      <Denominations value={dens} onChange={setDens} label="Fondo inicial: cuenta los billetes y monedas que hay en la caja" />
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy || !registerId}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Abrir turno</button>
      </div>
    </form>
  );
}

// ───────────── Turno: detalle y acciones ─────────────

function SessionView({ id, can, members, onChanged, onClose }: { id: string; can: Can; members: { userId: string; name: string }[]; onChanged: () => void; onClose: () => void }) {
  const [s, setS] = useState<CashSessionDetail | null>(null);
  const [mode, setMode] = useState<"view" | "move" | "count" | "close" | "decide" | "reopen">("view");
  const [error, setError] = useState<string | null>(null);
  const [partner, setPartner] = useState("");
  useEffect(() => { void bff<CashSessionDetail>(`/bff/api/cash/sessions/${id}`, "GET").then((r) => (r.ok ? setS(r.data) : setError(errorText(r)))); }, [id]);
  const done = (d: CashSessionDetail) => { setS(d); setMode("view"); onChanged(); };

  async function addParticipant() {
    setError(null);
    const r = await bff<CashSessionDetail>(`/bff/api/cash/sessions/${id}/participants`, "POST", { userId: partner });
    if (r.ok) { setPartner(""); done(r.data); } else setError(errorText(r));
  }

  if (!s) return error ? <p role="alert" className="text-danger">{error}</p> : <p className="text-ink-2">Cargando…</p>;
  const [label, tone] = STATUS[s.status]!;
  const pending = s.differences.find((d) => d.status === "PENDING");

  if (mode === "move") return <MovementForm session={s} onDone={done} onCancel={() => setMode("view")} />;
  if (mode === "count" || mode === "close") return <CountForm session={s} closing={mode === "close"} onDone={done} onCancel={() => setMode("view")} />;
  if (mode === "decide") return <TextForm title="Decidir sobre la diferencia" session={s} endpoint="decision" extra={(approve) => ({ approve })} labelOk="Aprobar" labelNo="Rechazar" onDone={done} onCancel={() => setMode("view")} withChoice />;
  if (mode === "reopen") return <TextForm title="Reabrir el turno" session={s} endpoint="reopen" fieldName="reason" labelOk="Reabrir turno" onDone={done} onCancel={() => setMode("view")} />;

  return (
    <div className="grid gap-5" data-testid="cash-session">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-ink">{s.code} · {s.register.name} <StatusBadge tone={tone}>{label}</StatusBadge></h3>
          <p className="mt-1 text-[13px] text-ink-2">Responsable: {s.responsible.name}{s.participants.length > 0 ? ` · Participan: ${s.participants.map((p) => p.name).join(", ")}` : ""}</p>
        </div>
        <p className="text-right text-[13px] text-ink-2">Efectivo esperado<span className="block text-lg font-semibold tabular-nums text-ink" data-testid="expected-cash">{money(s.expectedCash)}</span></p>
      </div>

      <table className="w-full text-left text-[13px] tabular-nums">
        <thead><tr className="h-9 border-y border-line text-ink-2"><th className="font-medium">Medio</th><th className="text-right font-medium">Entradas</th><th className="text-right font-medium">Salidas</th><th className="text-right font-medium">Neto</th></tr></thead>
        <tbody>{s.totals.map((t) => <tr key={t.method} className="h-9 border-b border-line-strong/40"><td>{METHOD[t.method]}</td><td className="text-right">{money(t.income)}</td><td className="text-right">{money(t.outflow)}</td><td className="text-right font-medium text-ink">{money(t.net)}</td></tr>)}</tbody>
      </table>

      {s.differences.length > 0 && (
        <div className="grid gap-1 text-[13px]" data-testid="cash-differences">
          {s.differences.map((d) => (
            <p key={d.id} className="rounded-lg border border-line px-3 py-2">
              Diferencia <strong className={Number(d.amount) < 0 ? "text-danger" : "text-warning"}>{money(d.amount)}</strong> · {d.justification} · <StatusBadge tone={d.status === "APPROVED" ? "success" : d.status === "REJECTED" ? "danger" : "warning"}>{{ PENDING: "Pendiente", APPROVED: "Aprobada", REJECTED: "Rechazada" }[d.status]}</StatusBadge>{d.decisionNote && <span className="text-ink-3"> · {d.decisionNote}</span>}
            </p>
          ))}
        </div>
      )}

      <div className="max-h-56 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-surface"><tr className="h-8 border-y border-line text-ink-2"><th className="font-medium">Hora</th><th className="font-medium">Movimiento</th><th className="font-medium">Medio</th><th className="text-right font-medium">Importe</th><th className="font-medium">Detalle</th></tr></thead>
          <tbody className="tabular-nums">
            {s.movements.map((m) => (
              <tr key={m.id} className="h-8 border-b border-line-strong/40">
                <td className="text-ink-3" suppressHydrationWarning>{new Date(m.createdAt).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" })}</td>
                <td>{TYPE[m.type]}</td><td>{METHOD[m.method]}</td>
                <td className={`text-right ${Number(m.amount) < 0 ? "text-danger" : "text-success"}`}>{Number(m.amount) > 0 ? "+" : ""}{money(m.amount)}</td>
                <td className="max-w-[220px] truncate text-ink-2" title={m.note ?? ""}>{m.note ?? ""}{m.actor ? ` · ${m.actor}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {s.status === "OPEN" && members.length > 0 && can.operate && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Agregar participante al turno"><select className={`${inputCls} w-[240px]`} value={partner} onChange={(e) => setPartner(e.target.value)} aria-label="Participante"><option value="">Elige una persona…</option>{members.filter((m) => m.userId !== s.responsible.id && !s.participants.some((p) => p.userId === m.userId)).map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select></Field>
          <button className={btnSecondary} disabled={!partner} onClick={addParticipant}>Agregar</button>
        </div>
      )}

      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        <button className={btnSecondary} onClick={onClose}>Cerrar ventana</button>
        {s.status === "OPEN" && can.operate && <button className={btnSecondary} onClick={() => setMode("move")}>Ingreso / gasto / retiro</button>}
        {s.status === "OPEN" && can.operate && <button className={btnSecondary} onClick={() => setMode("count")}>Arqueo parcial</button>}
        {s.status === "OPEN" && can.close && <button className={btnPrimary} onClick={() => setMode("close")}>Cerrar turno</button>}
        {s.status === "CLOSING" && pending && can.approve && <button className={btnPrimary} onClick={() => setMode("decide")}>Decidir diferencia</button>}
        {s.status === "CLOSED" && can.reopen && <button className={btnSecondary} onClick={() => setMode("reopen")}>Reabrir turno</button>}
      </div>
    </div>
  );
}

function MovementForm({ session, onDone, onCancel }: { session: CashSessionDetail; onDone: (s: CashSessionDetail) => void; onCancel: () => void }) {
  const [f, setF] = useState({ type: "EXPENSE", method: "CASH", amount: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await bff<CashSessionDetail>(`/bff/api/cash/sessions/${session.id}/movements`, "POST", { type: f.type, method: f.method, amount: Number(f.amount), note: f.note });
    setBusy(false);
    if (r.ok) return onDone(r.data);
    setError(errorText(r));
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <h3 className="text-lg font-semibold text-ink">Movimiento de caja · {session.code}</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Tipo"><select className={inputCls} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} aria-label="Tipo de movimiento"><option value="INCOME">Ingreso</option><option value="EXPENSE">Gasto</option><option value="WITHDRAWAL">Retiro</option></select></Field>
        <Field label="Medio"><select className={inputCls} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Importe"><input type="number" min={0} step="any" className={inputCls} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required aria-label="Importe del movimiento" /></Field>
      </div>
      <Field label="Motivo" hint="Queda registrado con tu nombre."><input className={inputCls} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} required minLength={3} maxLength={300} aria-label="Motivo del movimiento" /></Field>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Volver</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Registrar</button>
      </div>
    </form>
  );
}

function CountForm({ session, closing, onDone, onCancel }: { session: CashSessionDetail; closing: boolean; onDone: (s: CashSessionDetail) => void; onCancel: () => void }) {
  const [dens, setDens] = useState<Record<string, string>>({});
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counted = Object.entries(dens).reduce((s, [k, n]) => s + Number(k) * Number(n || 0), 0);
  const diff = counted - Number(session.expectedCash);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await bff<CashSessionDetail>(`/bff/api/cash/sessions/${session.id}/${closing ? "close" : "count"}`, "POST", { denominations: toNumbers(dens), ...(closing && justification.trim() ? { justification: justification.trim() } : {}) });
    setBusy(false);
    if (r.ok) return onDone(r.data);
    setError(errorText(r));
  }
  return (
    <form onSubmit={submit} className="grid gap-5">
      <div>
        <h3 className="text-lg font-semibold text-ink">{closing ? "Cerrar turno" : "Arqueo parcial"} · {session.code}</h3>
        <p className="mt-1 text-[13px] text-ink-2">{closing ? "Cuenta el efectivo. Al cerrar no entra ningún movimiento más. " : "Compara lo contado con lo esperado sin cerrar el turno. "}Esperado por el sistema: <strong className="tabular-nums text-ink">{money(session.expectedCash)}</strong>.</p>
      </div>
      <Denominations value={dens} onChange={setDens} label="Efectivo contado" />
      <p className={`text-[13px] ${Math.abs(diff) < 0.005 ? "text-success" : "text-warning"}`} data-testid="count-diff">{Math.abs(diff) < 0.005 ? "Cuadra exactamente." : `Diferencia: ${diff > 0 ? "+" : ""}${money(diff)} (${diff > 0 ? "sobrante" : "faltante"})`}</p>
      {closing && Math.abs(diff) >= 0.005 && <Field label="Justificación de la diferencia" hint="Obligatoria. Si supera la tolerancia, la decide otra persona."><input className={inputCls} value={justification} onChange={(e) => setJustification(e.target.value)} required minLength={3} maxLength={300} aria-label="Justificación" /></Field>}
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Volver</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {closing ? "Cerrar turno" : "Registrar arqueo"}</button>
      </div>
    </form>
  );
}

function TextForm({ title, session, endpoint, fieldName = "note", extra, labelOk, labelNo, withChoice, onDone, onCancel }: {
  title: string; session: CashSessionDetail; endpoint: string; fieldName?: string; extra?: (approve: boolean) => object; labelOk: string; labelNo?: string; withChoice?: boolean;
  onDone: (s: CashSessionDetail) => void; onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(approve: boolean) {
    if (text.trim().length < 3) return setError("Escribe el motivo (mínimo 3 letras).");
    setBusy(true); setError(null);
    const r = await bff<CashSessionDetail>(`/bff/api/cash/sessions/${session.id}/${endpoint}`, "POST", { [fieldName]: text.trim(), ...(extra ? extra(approve) : {}) });
    setBusy(false);
    if (r.ok) return onDone(r.data);
    setError(errorText(r));
  }
  return (
    <div className="grid gap-4">
      <h3 className="text-lg font-semibold text-ink">{title} · {session.code}</h3>
      {withChoice && session.differences.find((d) => d.status === "PENDING") && <p className="text-[13px] text-ink-2">Diferencia de <strong>{money(session.differences.find((d) => d.status === "PENDING")!.amount)}</strong>: «{session.differences.find((d) => d.status === "PENDING")!.justification}». No puedes decidir sobre tu propio cierre.</p>}
      <Field label="Motivo"><input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} maxLength={300} aria-label="Motivo de la decisión" /></Field>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className={btnSecondary} onClick={onCancel}>Volver</button>
        {withChoice && labelNo && <button className={btnSecondary} disabled={busy} onClick={() => send(false)}>{labelNo}</button>}
        <button className={btnPrimary} disabled={busy} onClick={() => send(true)}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {labelOk}</button>
      </div>
    </div>
  );
}

function RegisterForm({ register, branches, onDone, onCancel }: { register: CashRegisterSummary | null; branches: { id: string; name: string }[]; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ code: register?.code ?? "", name: register?.name ?? "", branchId: register?.branch.id ?? branches[0]?.id ?? "", kind: register?.kind ?? "BOX", status: register?.status ?? "ACTIVE" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = register
      ? await bff(`/bff/api/cash/registers/${register.id}`, "PATCH", { name: f.name, status: f.status })
      : await bff("/bff/api/cash/registers", "POST", { code: f.code.trim(), name: f.name, branchId: f.branchId, kind: f.kind });
    setBusy(false);
    if (r.ok) return onDone();
    setError(errorText(r));
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Código" hint={register ? "No se puede cambiar." : undefined}><input className={`${inputCls} ${register ? "bg-surface-muted" : ""}`} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} disabled={!!register} required maxLength={32} /></Field>
      <Field label="Nombre"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} maxLength={80} /></Field>
      <Field label="Sucursal" hint={register ? "No se puede cambiar." : undefined}><select className={`${inputCls} ${register ? "bg-surface-muted" : ""}`} value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })} disabled={!!register}>{register ? <option value={register.branch.id}>{register.branch.name}</option> : branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      {!register && <Field label="Tipo"><select className={inputCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as "BOX" | "VAULT" })}><option value="BOX">Caja</option><option value="VAULT">Bóveda</option></select></Field>}
      {register && <Field label="Estado"><select className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as "ACTIVE" | "INACTIVE" })}><option value="ACTIVE">Activa</option><option value="INACTIVE">Inactiva</option></select></Field>}
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Guardar</button>
      </div>
    </form>
  );
}
