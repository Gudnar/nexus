"use client";

import type { DocPaper, PrinterView, RenderedDocument, TextPrintResult } from "@erp/contracts";
import { Loader2, Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { btnSecondary } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";
import { sendToLocalPrinter } from "@/lib/printer-transport";

const PAPERS: { id: "" | DocPaper; label: string }[] = [
  { id: "", label: "Papel de la plantilla" }, { id: "THERMAL_58", label: "Térmica 58 mm" }, { id: "THERMAL_80", label: "Térmica 80 mm" }, { id: "LETTER", label: "Carta" }, { id: "LEGAL", label: "Oficio" },
];
const KEY = "erp.printer";
const safe = { get: () => { try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; } }, set: (v: string) => { try { localStorage.setItem(KEY, v); } catch { /* sin almacenamiento */ } } };

/**
 * Imprime un documento. Con una impresora de tickets (modo texto) el ticket sale directo: el servidor lo envía por red, o el navegador
 * por USB o puerto serie. Sin ella, se abre el diálogo de impresión del navegador con el documento con formato.
 */
export function PrintButton({ docType, id, label = "Imprimir", iconOnly = false, className, params }: { docType: "SALE_RECEIPT" | "QUOTE" | "PURCHASE_ORDER" | "SUPPLIER_DEPOSIT"; id: string; label?: string; iconOnly?: boolean; className?: string; params?: { amount?: number; concept?: string } }) {
  const [paper, setPaper] = useState<"" | DocPaper>("");
  const [printers, setPrinters] = useState<PrinterView[]>([]);
  const [target, setTarget] = useState(""); // "" = diálogo del navegador; si no, id de una impresora de tickets
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void bff<PrinterView[]>("/bff/api/documents/printers", "GET").then((r) => {
      if (!r.ok) return;
      const text = r.data.filter((p) => p.active && p.mode === "TEXT");
      setPrinters(text);
      const saved = safe.get();
      setTarget(text.some((p) => p.id === saved) ? saved : saved === "browser" ? "" : text.find((p) => p.isDefault)?.id ?? "");
    });
  }, []);

  const choose = (v: string) => { setTarget(v); safe.set(v || "browser"); };

  async function printBrowser() {
    const qs = new URLSearchParams();
    if (paper) qs.set("paper", paper);
    if (params?.amount !== undefined) qs.set("amount", String(params.amount));
    if (params?.concept) qs.set("concept", params.concept);
    const r = await bff<RenderedDocument>(`/bff/api/documents/render/${docType}/${id}${qs.size ? `?${qs}` : ""}`, "GET");
    if (!r.ok) return setMsg({ ok: false, text: errorText(r) });
    document.querySelectorAll("iframe[data-testid=print-frame]").forEach((f) => f.remove());
    const frame = document.createElement("iframe");
    frame.setAttribute("data-testid", "print-frame");
    frame.setAttribute("aria-hidden", "true");
    frame.title = r.data.title;
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    frame.srcdoc = r.data.html;
    frame.onload = () => { try { frame.contentWindow?.focus(); frame.contentWindow?.print(); } catch { /* el usuario puede imprimir desde el navegador */ } };
    document.body.appendChild(frame);
    setTimeout(() => frame.remove(), 120_000);
  }

  async function printTicket() {
    const r = await bff<TextPrintResult>(`/bff/api/documents/print/${docType}/${id}`, "POST", { printerId: target, ...(params?.amount !== undefined ? { amount: params.amount } : {}), ...(params?.concept ? { concept: params.concept } : {}) });
    if (!r.ok) return setMsg({ ok: false, text: errorText(r) });
    try {
      if (!r.data.delivered) await sendToLocalPrinter(r.data);
      setMsg({ ok: true, text: "Enviado a la impresora." });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "No se pudo enviar a la impresora." }); }
  }

  async function print() {
    setBusy(true); setMsg(null);
    try { await (target ? printTicket() : printBrowser()); } finally { setBusy(false); }
  }

  // En una lista (solo ícono) no hay dónde mostrar el mensaje: se avisa con un cuadro si algo falla.
  useEffect(() => { if (iconOnly && msg && !msg.ok) window.alert(msg.text); }, [iconOnly, msg]);
  if (iconOnly) {
    return (
      <button type="button" className={className ?? "rounded-md border border-line-strong bg-surface p-1.5 text-ink-2 hover:bg-surface-muted disabled:opacity-60"} onClick={print} disabled={busy} aria-label={label} title={label}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Printer className="size-4" aria-hidden />}
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {printers.length > 0 && (
        <select aria-label="Imprimir con" value={target} onChange={(e) => choose(e.target.value)} className="h-10 rounded-lg border border-line-strong bg-surface px-2 text-[13px]">
          <option value="">Navegador (con formato)</option>
          {printers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
      {!target && (
        <select aria-label="Papel de impresión" value={paper} onChange={(e) => setPaper(e.target.value as "" | DocPaper)} className="h-10 rounded-lg border border-line-strong bg-surface px-2 text-[13px]">
          {PAPERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      )}
      <button type="button" className={btnSecondary} onClick={print} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Printer className="size-4" aria-hidden />}{label}</button>
      {msg && <span role={msg.ok ? "status" : "alert"} data-testid="print-msg" className={`text-[13px] ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</span>}
    </span>
  );
}
