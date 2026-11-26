"use client";

import type { ScheduleSummary } from "@erp/contracts";
import { Clock, Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { btnDanger, btnPrimary, btnSecondary, Card, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const ZONES = [
  "America/La_Paz", "America/Lima", "America/Bogota", "America/Santiago", "America/Argentina/Buenos_Aires",
  "America/Sao_Paulo", "America/Mexico_City", "America/Guayaquil", "America/Asuncion", "UTC",
];
const NEW = "new";
/** Campos de ancho fijo dentro de filas flexibles (inputCls trae w-full). */
const compact = inputCls.replace("w-full ", "");

interface Range { start: string; end: string }
interface Exc { date: string; type: "BLOCK" | "ALLOW"; allDay: boolean; start: string; end: string; reason: string }

/** El control <input type="time"> no tiene 24:00: la medianoche final se escribe 00:00. */
const toInput = (t: string) => (t === "24:00" ? "00:00" : t);
const fromInput = (t: string) => (t === "00:00" ? "24:00" : t);

function weekFrom(s: ScheduleSummary | null): Range[][] {
  const week: Range[][] = DAYS.map(() => []);
  for (const r of s?.rules ?? []) week[r.weekday - 1]!.push({ start: toInput(r.start), end: toInput(r.end) });
  return week;
}

/** Resumen legible: «Lun–Vie 08:00–18:00 · Sáb 09:00–13:00». */
function summarize(s: ScheduleSummary): string {
  if (s.rules.length === 0) return "Sin ventanas: nadie puede entrar";
  const short = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const byRange = new Map<string, number[]>();
  for (const r of s.rules) byRange.set(`${r.start}–${r.end}`, [...(byRange.get(`${r.start}–${r.end}`) ?? []), r.weekday]);
  return [...byRange.entries()].map(([range, days]) => {
    const d = [...days].sort((a, b) => a - b);
    const consecutive = d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1]! + 1);
    return `${consecutive ? `${short[d[0]! - 1]}–${short[d[d.length - 1]! - 1]}` : d.map((x) => short[x - 1]).join(", ")} ${range}`;
  }).join(" · ");
}

export function SchedulesManager({ schedules, canManage, tenantName }: { schedules: ScheduleSummary[]; canManage: boolean; tenantName: string }) {
  const [selected, setSelected] = useState<string>(schedules[0]?.id ?? (canManage ? NEW : ""));
  const router = useRouter();
  const current = schedules.find((s) => s.id === selected) ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <Card className="h-fit p-3">
        {schedules.length === 0 && <p className="px-3 py-4 text-[13px] text-ink-2">Aún no hay horarios. Sin horario, una persona entra a cualquier hora.</p>}
        <ul aria-label="Horarios" className="grid gap-1">
          {schedules.map((s) => (
            <li key={s.id}>
              <button onClick={() => setSelected(s.id)} aria-current={selected === s.id ? "true" : undefined}
                className={`w-full rounded-lg px-3 py-2.5 text-left text-[13px] ${selected === s.id ? "bg-brand-soft text-brand-hover" : "text-body hover:bg-surface-muted"}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold">{s.name}</span>
                  <span className="shrink-0 text-xs font-normal text-ink-3">{s.members} {s.members === 1 ? "usuario" : "usuarios"}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs font-normal text-ink-2">{summarize(s)}</span>
              </button>
            </li>
          ))}
        </ul>
        {canManage && (
          <button className={`${btnSecondary} mt-3 w-full`} onClick={() => setSelected(NEW)}>
            <Plus className="size-4" aria-hidden /> Nuevo horario
          </button>
        )}
      </Card>

      {selected === NEW || current ? (
        <ScheduleEditor
          key={selected}
          schedule={selected === NEW ? null : current}
          canManage={canManage}
          tenantName={tenantName}
          onSaved={(id) => { if (id) setSelected(id); router.refresh(); }}
          onDeleted={() => { setSelected(schedules.find((s) => s.id !== selected)?.id ?? (canManage ? NEW : "")); router.refresh(); }}
        />
      ) : (
        <Card><p className="py-10 text-center text-ink-2"><Clock className="mx-auto mb-2 size-6 text-ink-3" aria-hidden />Selecciona un horario.</p></Card>
      )}
    </div>
  );
}

function ScheduleEditor({
  schedule, canManage, tenantName, onSaved, onDeleted,
}: { schedule: ScheduleSummary | null; canManage: boolean; tenantName: string; onSaved: (id?: string) => void; onDeleted: () => void }) {
  const [name, setName] = useState(schedule?.name ?? "");
  const [timezone, setTimezone] = useState(schedule?.timezone ?? "");
  const [week, setWeek] = useState<Range[][]>(weekFrom(schedule));
  const [excs, setExcs] = useState<Exc[]>(
    (schedule?.exceptions ?? []).map((e) => ({ date: e.date, type: e.type, allDay: e.start === null, start: toInput(e.start ?? "09:00"), end: toInput(e.end ?? "13:00"), reason: e.reason ?? "" })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const readOnly = !canManage;
  const setDay = (i: number, v: Range[]) => setWeek((w) => w.map((r, j) => (j === i ? v : r)));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setSaved(false);
    const body = {
      name,
      timezone: timezone.trim() || null,
      rules: week.flatMap((ranges, i) => ranges.map((r) => ({ weekday: i + 1, start: r.start, end: fromInput(r.end) }))),
      exceptions: excs.filter((x) => x.date).map((x) => ({
        date: x.date, type: x.type, ...(x.allDay ? {} : { start: x.start, end: fromInput(x.end) }), ...(x.reason ? { reason: x.reason } : {}),
      })),
    };
    const r = schedule
      ? await bff<{ id: string; code?: string }>(`/bff/api/admin/schedules/${schedule.id}`, "PATCH", body)
      : await bff<{ id: string; code?: string }>("/bff/api/admin/schedules", "POST", body);
    setBusy(false);
    if (r.ok) { setSaved(true); onSaved(schedule ? undefined : r.data.id); }
    else if (r.status === 400 && r.data.code === "INVALID_TIMEZONE") setError("Zona horaria no válida. Usa nombres como America/La_Paz.");
    else if (r.status === 400) setError("Revisa las horas (el fin debe ser distinto del inicio) y las fechas de las excepciones.");
    else setError(errorText(r));
  }

  async function remove() {
    if (!schedule || !window.confirm(`¿Eliminar el horario «${schedule.name}»?`)) return;
    setBusy(true); setError(null);
    const r = await bff(`/bff/api/admin/schedules/${schedule.id}`, "DELETE");
    setBusy(false);
    if (r.ok) onDeleted(); else setError(errorText(r));
  }

  const empty = week.every((d) => d.length === 0);

  return (
    <Card>
      <form onSubmit={save} className="grid gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-2">Nombre del horario</span>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} readOnly={readOnly} required minLength={2} maxLength={60} placeholder="p. ej. Oficina" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-2">Zona horaria</span>
            <input className={inputCls} list="zones" value={timezone} onChange={(e) => setTimezone(e.target.value)} readOnly={readOnly} placeholder={`La de la empresa (${tenantName})`} />
            <datalist id="zones">{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
          </label>
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-[13px] font-semibold text-ink">Ventanas semanales</legend>
          {DAYS.map((day, i) => {
            const ranges = week[i]!;
            return (
              <div key={day} className="flex flex-wrap items-start gap-3 rounded-lg border border-line px-3 py-2.5">
                <label className="flex w-[130px] cursor-pointer items-center gap-2.5 pt-1.5 text-[13px] font-medium text-body">
                  <input type="checkbox" className="size-4 accent-brand" disabled={readOnly} checked={ranges.length > 0}
                    onChange={(e) => setDay(i, e.target.checked ? [{ start: "08:00", end: "18:00" }] : [])} />
                  {day}
                </label>
                <div className="grid flex-1 gap-2">
                  {ranges.length === 0 && <span className="pt-1.5 text-[13px] text-ink-3">Sin acceso</span>}
                  {ranges.map((r, k) => (
                    <div key={k} className="flex flex-wrap items-center gap-2">
                      <input type="time" aria-label={`${day}: desde`} className={`${compact} w-[120px]`} value={r.start} disabled={readOnly}
                        onChange={(e) => setDay(i, ranges.map((x, j) => (j === k ? { ...x, start: e.target.value } : x)))} required />
                      <span className="text-ink-3">a</span>
                      <input type="time" aria-label={`${day}: hasta`} className={`${compact} w-[120px]`} value={r.end} disabled={readOnly}
                        onChange={(e) => setDay(i, ranges.map((x, j) => (j === k ? { ...x, end: e.target.value } : x)))} required />
                      {r.end <= r.start && r.end !== "" && <StatusBadge tone="info">Termina al día siguiente</StatusBadge>}
                      {!readOnly && (
                        <button type="button" className="rounded-md p-1.5 text-ink-3 hover:bg-neutral-soft hover:text-danger" aria-label={`Quitar franja de ${day}`}
                          onClick={() => setDay(i, ranges.filter((_, j) => j !== k))}><Trash2 className="size-4" /></button>
                      )}
                    </div>
                  ))}
                  {!readOnly && ranges.length > 0 && (
                    <button type="button" className="w-fit text-xs font-medium text-brand hover:underline"
                      onClick={() => setDay(i, [...ranges, { start: "14:00", end: "18:00" }])}>+ Añadir franja</button>
                  )}
                </div>
              </div>
            );
          })}
          {!readOnly && (
            <button type="button" className="w-fit text-xs font-medium text-brand hover:underline"
              onClick={() => setWeek((w) => w.map((d, i) => (i >= 1 && i <= 4 ? w[0]!.map((r) => ({ ...r })) : d)))}>
              Copiar el lunes a martes–viernes
            </button>
          )}
          {empty && <p className="rounded-lg bg-warning-soft px-3.5 py-2.5 text-[13px] text-warning">Sin ventanas, las personas con este horario no podrán entrar nunca.</p>}
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-[13px] font-semibold text-ink">Excepciones por fecha</legend>
          <p className="text-xs text-ink-2">Bloquea un feriado o permite un acceso extraordinario. Si coinciden, el bloqueo gana.</p>
          {excs.map((x, i) => {
            const upd = (patch: Partial<Exc>) => setExcs((l) => l.map((y, j) => (j === i ? { ...y, ...patch } : y)));
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2.5">
                <input type="date" aria-label="Fecha" className={`${compact} w-[150px]`} value={x.date} onChange={(e) => upd({ date: e.target.value })} disabled={readOnly} required />
                <select aria-label="Tipo" className={`${compact} w-[130px]`} value={x.type} onChange={(e) => upd({ type: e.target.value as Exc["type"] })} disabled={readOnly}>
                  <option value="BLOCK">Bloquear</option><option value="ALLOW">Permitir</option>
                </select>
                <label className="flex items-center gap-1.5 text-[13px] text-body">
                  <input type="checkbox" className="size-4 accent-brand" checked={x.allDay} onChange={(e) => upd({ allDay: e.target.checked })} disabled={readOnly} /> Todo el día
                </label>
                {!x.allDay && (
                  <>
                    <input type="time" aria-label="Desde" className={`${compact} w-[110px]`} value={x.start} onChange={(e) => upd({ start: e.target.value })} disabled={readOnly} required />
                    <span className="text-ink-3">a</span>
                    <input type="time" aria-label="Hasta" className={`${compact} w-[110px]`} value={x.end} onChange={(e) => upd({ end: e.target.value })} disabled={readOnly} required />
                  </>
                )}
                <input aria-label="Motivo" className={`${inputCls} min-w-[160px] flex-1`} placeholder="Motivo (opcional)" value={x.reason} maxLength={200} onChange={(e) => upd({ reason: e.target.value })} disabled={readOnly} />
                {!readOnly && (
                  <button type="button" className="rounded-md p-1.5 text-ink-3 hover:bg-neutral-soft hover:text-danger" aria-label="Quitar excepción"
                    onClick={() => setExcs((l) => l.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
                )}
              </div>
            );
          })}
          {!readOnly && (
            <button type="button" className="w-fit text-xs font-medium text-brand hover:underline"
              onClick={() => setExcs((l) => [...l, { date: "", type: "BLOCK", allDay: true, start: "09:00", end: "13:00", reason: "" }])}>+ Añadir excepción</button>
          )}
        </fieldset>

        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">{error}</p>}
        {saved && !error && <p role="status" className="rounded-lg bg-success-soft px-3.5 py-2.5 text-[13px] text-success">Cambios guardados.</p>}

        {!readOnly && (
          <div className="flex items-center justify-between gap-3">
            <div>
              {schedule && (
                <button type="button" className={btnDanger} onClick={remove} disabled={busy || schedule.members > 0}
                  title={schedule.members > 0 ? "Hay usuarios con este horario" : undefined}>
                  <Trash2 className="size-4" aria-hidden /> Eliminar horario
                </button>
              )}
            </div>
            <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {schedule ? "Guardar cambios" : "Crear horario"}</button>
          </div>
        )}
      </form>
    </Card>
  );
}
