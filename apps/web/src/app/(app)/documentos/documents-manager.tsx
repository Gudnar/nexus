"use client";

import type { DocPaper, DocumentConfig, DocumentTemplateView, PrinterView, RenderedDocument } from "@erp/contracts";
import { Loader2, Printer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Field } from "@/components/field";
import { btnPrimary, btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";
import { PrintersManager } from "./printers-manager";

const PAPERS: { id: DocPaper; label: string }[] = [{ id: "THERMAL_58", label: "Térmica 58 mm" }, { id: "THERMAL_80", label: "Térmica 80 mm" }, { id: "LETTER", label: "Carta" }, { id: "LEGAL", label: "Oficio" }];
const SHOW: { key: keyof DocumentConfig["show"]; label: string }[] = [
  { key: "customer", label: "Cliente o proveedor" }, { key: "unitPrice", label: "Precio unitario" }, { key: "discount", label: "Descuento" },
  { key: "taxes", label: "Desglose de impuestos" }, { key: "payments", label: "Cobros" }, { key: "notes", label: "Observaciones" },
];

export function DocumentsManager({ templates, printers, branches, registers }: { templates: DocumentTemplateView[]; printers: PrinterView[]; branches: { id: string; name: string }[]; registers: { id: string; name: string; branchId: string }[] }) {
  const [tab, setTab] = useState<"templates" | "printers">("templates");
  return (
    <div className="grid gap-4">
      <div role="tablist" className="flex gap-1 border-b border-line">
        {([["templates", "Plantillas"], ["printers", "Impresoras"]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} data-testid={`tab-${id}`} onClick={() => setTab(id)} className={`-mb-px border-b-2 px-4 py-2.5 text-[13px] font-medium ${tab === id ? "border-brand text-brand" : "border-transparent text-ink-2 hover:text-ink"}`}>{label}</button>
        ))}
      </div>
      {tab === "templates" ? <Templates templates={templates} /> : <PrintersManager printers={printers} branches={branches} registers={registers} />}
    </div>
  );
}

function Templates({ templates }: { templates: DocumentTemplateView[] }) {
  const router = useRouter();
  const [type, setType] = useState(templates[0]!.docType);
  const current = templates.find((t) => t.docType === type)!;
  const [cfg, setCfg] = useState<DocumentConfig>(current.config);
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setCfg(current.config); setMsg(null); }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  // Vista previa en vivo (con retardo) con datos de ejemplo.
  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await bff<RenderedDocument>(`/bff/api/documents/templates/${type}/preview`, "POST", cfg);
      if (r.ok) setHtml(r.data.html);
    }, 350);
    return () => clearTimeout(t);
  }, [cfg, type]);

  const set = <K extends keyof DocumentConfig>(k: K, v: DocumentConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await bff(`/bff/api/documents/templates/${type}`, "PUT", cfg);
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: errorText(r) });
    setMsg({ ok: true, text: "Plantilla guardada." });
    router.refresh();
  }
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_1fr]">
      <Card>
        <form onSubmit={save} className="grid gap-4 text-[13px]">
          <Field label="Documento">
            <select aria-label="Documento" className={inputCls} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              {templates.map((t) => <option key={t.docType} value={t.docType}>{t.label}{t.customized ? ` (v${t.version})` : ""}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Papel"><select aria-label="Papel" className={inputCls} value={cfg.paper} onChange={(e) => set("paper", e.target.value as DocPaper)}>{PAPERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
            <Field label="Copias"><input aria-label="Copias" type="number" min={1} max={5} className={inputCls} value={cfg.copies} onChange={(e) => set("copies", Number(e.target.value))} /></Field>
            <Field label="Margen (mm)"><input aria-label="Margen" type="number" min={0} max={30} className={inputCls} value={cfg.marginMm} onChange={(e) => set("marginMm", Number(e.target.value))} /></Field>
            <Field label="Tamaño de letra (pt)"><input aria-label="Tamaño de letra" type="number" min={7} max={14} className={inputCls} value={cfg.fontSizePt} onChange={(e) => set("fontSizePt", Number(e.target.value))} /></Field>
          </div>
          <Field label="Datos de la empresa bajo el nombre" hint="Una línea por dato: dirección, teléfono…">
            <textarea aria-label="Encabezado" className={`${inputCls} h-20 py-2`} value={cfg.headerLines.join("\n")} onChange={(e) => set("headerLines", e.target.value.split("\n").slice(0, 5))} />
          </Field>
          <Field label="Mensaje al pie"><input aria-label="Pie" className={inputCls} value={cfg.footerText} onChange={(e) => set("footerText", e.target.value)} /></Field>
          <Field label="Texto legal o condiciones"><textarea aria-label="Texto legal" className={`${inputCls} h-16 py-2`} value={cfg.legalText} onChange={(e) => set("legalText", e.target.value)} /></Field>
          <fieldset className="grid grid-cols-2 gap-2"><legend className="mb-1 text-xs font-medium text-ink-2">Qué se muestra</legend>
            {SHOW.map((s) => <label key={s.key} className="flex items-center gap-2"><input type="checkbox" aria-label={s.label} checked={cfg.show[s.key]} onChange={(e) => set("show", { ...cfg.show, [s.key]: e.target.checked })} />{s.label}</label>)}
          </fieldset>
          <p className="text-xs text-ink-3">La leyenda “documento interno, no es factura” del recibo y de la cotización no se puede quitar.</p>
          {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-success" : "text-danger"}>{msg.text}</p>}
          <div className="flex justify-end"><button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />}Guardar plantilla</button></div>
        </form>
      </Card>
      <Card>
        <p className="mb-2 text-[13px] font-medium text-ink">Vista previa (datos de ejemplo)</p>
        <iframe title="Vista previa" data-testid="preview-frame" srcDoc={html} className="h-[560px] w-full rounded-lg border border-line bg-white" />
      </Card>
    </div>
  );
}
