"use client";

import type { DocPaper, PrinterView, TextPrintResult } from "@erp/contracts";
import { Loader2, Printer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Field } from "@/components/field";
import { Modal } from "@/components/modal";
import { btnPrimary, btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";
import { sendToLocalPrinter } from "@/lib/printer-transport";

const PAPERS: { id: DocPaper; label: string }[] = [{ id: "THERMAL_58", label: "Térmica 58 mm" }, { id: "THERMAL_80", label: "Térmica 80 mm" }, { id: "LETTER", label: "Carta" }, { id: "LEGAL", label: "Oficio" }];
const CONNECTIONS: Record<string, { label: string; hint: string }> = {
  BROWSER: { label: "Diálogo del navegador", hint: "Abre la ventana de impresión del sistema. Sirve para cualquier impresora instalada en el equipo." },
  NETWORK: { label: "Red (IP y puerto)", hint: "Impresora con cable de red o Wi-Fi. El sistema le envía el ticket directamente (puerto RAW 9100). Solo direcciones de tu red local." },
  USB: { label: "USB directo", hint: "El navegador envía el ticket a la impresora USB, sin diálogo. Solo Chrome o Edge; pide permiso la primera vez." },
  SERIAL: { label: "Puerto serie / Bluetooth", hint: "Para impresoras serie o Bluetooth emparejadas como puerto COM. Solo Chrome o Edge." },
  SYSTEM: { label: "Cola del sistema", hint: "Impresora compartida o de la cola del sistema operativo." },
};
const CODEPAGES = [["CP858", "CP858 · español con €, la más común"], ["CP850", "CP850 · Europa occidental"], ["CP437", "CP437 · estándar antiguo"], ["WPC1252", "Windows-1252"], ["UTF8", "UTF-8 (solo modelos que lo admiten)"]];
const COLS_BY_PAPER: Record<DocPaper, number> = { THERMAL_58: 32, THERMAL_80: 42, LETTER: 80, LEGAL: 80 };

type Reg = { id: string; name: string; branchId: string };
type Branch = { id: string; name: string };

export function PrintersManager({ printers, branches, registers }: { printers: PrinterView[]; branches: Branch[]; registers: Reg[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<PrinterView | "new" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function run(p: PrinterView, kind: "test" | "drawer") {
    setBusyId(p.id); setNote(null);
    const r = await bff<TextPrintResult>(`/bff/api/documents/printers/${p.id}/${kind}`, "POST");
    if (!r.ok) { setBusyId(null); return setNote({ ok: false, text: errorText(r) }); }
    try {
      if (!r.data.delivered) await sendToLocalPrinter(r.data);
      setNote({ ok: true, text: kind === "test" ? `Prueba enviada a «${p.name}».` : `Se abrió el cajón de «${p.name}».` });
    } catch (e) { setNote({ ok: false, text: e instanceof Error ? e.message : "No se pudo enviar a la impresora." }); }
    setBusyId(null);
  }
  const off = async (id: string) => { await bff(`/bff/api/documents/printers/${id}/deactivate`, "POST"); router.refresh(); };

  return (
    <div className="grid gap-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-3xl text-[13px] text-ink-2">Registra cada impresora con su forma de conexión. Las de tickets (cajas, térmicas chinas y compatibles ESC/POS) se usan en <strong>modo texto</strong>: ancho en caracteres, página de códigos para acentos, corte de papel y apertura del cajón. Las láser o de inyección usan el diálogo del navegador con el documento con formato.</p>
          <button className={btnPrimary} onClick={() => setEditing("new")}>Nueva impresora</button>
        </div>
        {note && <p role={note.ok ? "status" : "alert"} data-testid="printer-note" className={`mt-3 rounded-lg px-3 py-2 text-[13px] ${note.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>{note.text}</p>}
      </Card>
      <Card>
        {printers.length === 0 ? <EmptyState icon={Printer} title="Sin impresoras registradas" description="Agrega la primera con «Nueva impresora»." /> : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]" data-testid="printer-rows">
              <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Impresora</th><th className="px-3 font-medium">Conexión</th><th className="px-3 font-medium">Modo y papel</th><th className="px-3 font-medium">Dónde se usa</th><th className="px-3 font-medium">Estado</th><th className="px-5" /></tr></thead>
              <tbody>
                {printers.map((p) => (
                  <tr key={p.id} className="border-b border-line-strong/40 align-top">
                    <td className="px-5 py-3"><span className="font-medium text-ink">{p.name}</span>{p.openDrawer && <span className="block text-xs text-ink-3">Con cajón de dinero</span>}</td>
                    <td className="px-3 py-3">{CONNECTIONS[p.connection]?.label}{p.connection === "NETWORK" && <span className="block text-xs text-ink-3">{p.host}:{p.port}</span>}</td>
                    <td className="px-3 py-3">{p.mode === "TEXT" ? `Texto · ${p.charsPerLine} col · ${p.codepage}` : "Formato (HTML)"}<span className="block text-xs text-ink-3">{PAPERS.find((x) => x.id === p.paper)?.label}</span></td>
                    <td className="px-3 py-3">{p.cashRegisterName ? `Caja: ${p.cashRegisterName}` : branches.find((b) => b.id === p.branchId)?.name ?? "Todas las sucursales"}</td>
                    <td className="px-3 py-3">{p.active ? <StatusBadge tone={p.isDefault ? "success" : "neutral"}>{p.isDefault ? "Predeterminada" : "Activa"}</StatusBadge> : <StatusBadge>Inactiva</StatusBadge>}</td>
                    <td className="px-5 py-3 text-right">
                      {p.active && (
                        <span className="inline-flex flex-wrap justify-end gap-2">
                          {p.mode === "TEXT" && <button className={`${btnSecondary} h-8 px-3`} disabled={busyId === p.id} onClick={() => run(p, "test")} aria-label={`Prueba de ${p.name}`}>{busyId === p.id && <Loader2 className="size-3.5 animate-spin" aria-hidden />}Imprimir prueba</button>}
                          {p.openDrawer && <button className={`${btnSecondary} h-8 px-3`} disabled={busyId === p.id} onClick={() => run(p, "drawer")} aria-label={`Abrir cajón de ${p.name}`}>Abrir cajón</button>}
                          <button className={`${btnSecondary} h-8 px-3`} onClick={() => setEditing(p)} aria-label={`Editar ${p.name}`}>Editar</button>
                          <button className={`${btnSecondary} h-8 px-3`} onClick={() => off(p.id)} aria-label={`Desactivar ${p.name}`}>Desactivar</button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Nueva impresora" : "Editar impresora"} size="lg">
        {editing !== null && <PrinterForm printer={editing === "new" ? null : editing} branches={branches} registers={registers} onDone={() => { setEditing(null); router.refresh(); }} onCancel={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function PrinterForm({ printer, branches, registers, onDone, onCancel }: { printer: PrinterView | null; branches: Branch[]; registers: Reg[]; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(printer?.name ?? "");
  const [kind, setKind] = useState(printer?.kind ?? "THERMAL");
  const [connection, setConnection] = useState(printer?.connection ?? "NETWORK");
  const [mode, setMode] = useState(printer?.mode ?? "TEXT");
  const [paper, setPaper] = useState<DocPaper>(printer?.paper ?? "THERMAL_80");
  const [host, setHost] = useState(printer?.host ?? "");
  const [port, setPort] = useState(String(printer?.port ?? 9100));
  const [cols, setCols] = useState(String(printer?.charsPerLine ?? 42));
  const [codepage, setCodepage] = useState(printer?.codepage ?? "CP858");
  const [cut, setCut] = useState(printer?.cutMode ?? "FULL");
  const [feed, setFeed] = useState(String(printer?.feedLines ?? 3));
  const [drawer, setDrawer] = useState(printer?.openDrawer ?? false);
  const [branchId, setBranchId] = useState(printer?.branchId ?? "");
  const [registerId, setRegisterId] = useState(printer?.cashRegisterId ?? "");
  const [isDefault, setIsDefault] = useState(printer?.isDefault ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = mode === "TEXT";
  const regs = registers.filter((r) => !branchId || r.branchId === branchId);

  function pickPaper(p: DocPaper) { setPaper(p); if (!printer) setCols(String(COLS_BY_PAPER[p])); }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const reg = registers.find((r) => r.id === registerId);
    const body = {
      name, kind, paper, connection, mode, host: connection === "NETWORK" ? host.trim() : null, port: connection === "NETWORK" ? Number(port) : null,
      charsPerLine: Number(cols), codepage, cutMode: cut, openDrawer: text && drawer, feedLines: Number(feed),
      branchId: registerId ? (reg?.branchId ?? null) : branchId || null, cashRegisterId: registerId || null, isDefault,
    };
    const r = await bff(printer ? `/bff/api/documents/printers/${printer.id}` : "/bff/api/documents/printers", printer ? "PUT" : "POST", body);
    setBusy(false);
    if (!r.ok) return setError(errorText(r));
    onDone();
  }
  return (
    <form onSubmit={submit} className="grid gap-4 text-[13px]">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre"><input aria-label="Nombre de la impresora" required minLength={2} className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Caja 1 · Xprinter" /></Field>
        <Field label="Tipo de equipo"><select aria-label="Tipo de equipo" className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}><option value="THERMAL">Térmica de tickets</option><option value="LASER">Láser / inyección</option><option value="BROWSER">Del navegador</option><option value="OTHER">Otra</option></select></Field>
        <Field label="Cómo se conecta" hint={CONNECTIONS[connection]?.hint}><select aria-label="Conexión" className={inputCls} value={connection} onChange={(e) => setConnection(e.target.value as typeof connection)}>{Object.entries(CONNECTIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <Field label="Cómo imprime" hint={text ? "Texto plano con comandos ESC/POS: el más rápido y compatible con impresoras de tickets chinas." : "Documento con formato (logo, tablas) por el diálogo del navegador."}>
          <select aria-label="Modo" className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="TEXT">Texto (ESC/POS)</option><option value="HTML">Documento con formato</option></select>
        </Field>
      </div>
      {connection === "NETWORK" && (
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <Field label="Dirección IP" hint="Ejemplo: 192.168.1.50"><input aria-label="Dirección IP" required className={inputCls} value={host} onChange={(e) => setHost(e.target.value)} /></Field>
          <Field label="Puerto"><input aria-label="Puerto" type="number" min={1} max={65535} required className={inputCls} value={port} onChange={(e) => setPort(e.target.value)} /></Field>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Papel"><select aria-label="Papel de la impresora" className={inputCls} value={paper} onChange={(e) => pickPaper(e.target.value as DocPaper)}>{PAPERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
        {text && <Field label="Caracteres por línea" hint="32 = 58 mm · 42 o 48 = 80 mm"><input aria-label="Caracteres por línea" type="number" min={24} max={96} className={inputCls} value={cols} onChange={(e) => setCols(e.target.value)} /></Field>}
        {text && <Field label="Acentos y ñ (página de códigos)"><select aria-label="Página de códigos" className={inputCls} value={codepage} onChange={(e) => setCodepage(e.target.value as typeof codepage)}>{CODEPAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>}
      </div>
      {text && (
        <div className="grid items-end gap-3 sm:grid-cols-3">
          <Field label="Corte de papel"><select aria-label="Corte" className={inputCls} value={cut} onChange={(e) => setCut(e.target.value as typeof cut)}><option value="FULL">Corte total</option><option value="PARTIAL">Corte parcial</option><option value="NONE">Sin corte</option></select></Field>
          <Field label="Líneas en blanco al final"><input aria-label="Líneas al final" type="number" min={0} max={12} className={inputCls} value={feed} onChange={(e) => setFeed(e.target.value)} /></Field>
          <label className="flex h-10 items-center gap-2"><input type="checkbox" aria-label="Cajón de dinero" checked={drawer} onChange={(e) => setDrawer(e.target.checked)} />Tiene cajón de dinero</label>
        </div>
      )}
      <fieldset className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2">
        <legend className="px-1 text-xs font-medium text-ink-2">Dónde se usa</legend>
        <Field label="Sucursal"><select aria-label="Sucursal" className={inputCls} value={branchId} onChange={(e) => { setBranchId(e.target.value); setRegisterId(""); }}><option value="">Todas</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Caja" hint="Para el recibo que sale en esa caja"><select aria-label="Caja" className={inputCls} value={registerId} onChange={(e) => setRegisterId(e.target.value)}><option value="">Ninguna en particular</option>{regs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" aria-label="Predeterminada" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />Usar como predeterminada en {registerId ? "esa caja" : "esa sucursal"}</label>
      </fieldset>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-danger">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button><button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />}{printer ? "Guardar cambios" : "Agregar impresora"}</button></div>
    </form>
  );
}
