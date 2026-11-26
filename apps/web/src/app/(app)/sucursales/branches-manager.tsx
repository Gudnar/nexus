"use client";

import type { BranchDetail } from "@erp/contracts";
import { Loader2, MapPin, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Modal } from "@/components/modal";
import { btnPrimary, btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

interface Props {
  branches: BranchDetail[];
  canManage: boolean;
  canCreate: boolean;
  canChangeMain: boolean;
}

export function BranchesManager({ branches, canManage, canCreate, canChangeMain }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<BranchDetail | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function patch(b: BranchDetail, body: object) {
    setBusyId(b.id);
    setError(null);
    const r = await bff(`/bff/api/admin/branches/${b.id}`, "PATCH", body);
    setBusyId(null);
    if (r.ok) router.refresh();
    else setError(errorText(r));
  }

  return (
    <>
      {error && <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-4 py-2.5 text-[13px] text-danger">{error}</p>}
      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">
            {branches.length} {branches.length === 1 ? "sucursal" : "sucursales"}
          </h2>
          {canCreate && (
            <button className={btnPrimary} onClick={() => setEditing("new")}>
              <Plus className="size-4" aria-hidden /> Nueva sucursal
            </button>
          )}
        </div>

        {branches.length === 0 ? (
          <EmptyState icon={MapPin} title="No hay sucursales" description="Crea la primera sucursal para empezar a operar." />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="h-[42px] border-y border-line text-ink-2">
                  <th className="px-5 font-medium">Código</th>
                  <th className="px-3 font-medium">Nombre</th>
                  <th className="px-3 font-medium">Contacto</th>
                  <th className="px-3 font-medium">Estado</th>
                  <th className="px-3 text-right font-medium">Usuarios</th>
                  {canManage && <th className="px-5 text-right font-medium">Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => (
                  <tr key={b.id} className="h-[56px] border-b border-line-strong/40 text-body last:border-0 hover:bg-surface-muted">
                    <td className="px-5 font-medium text-ink">{b.code}</td>
                    <td className="px-3">
                      {b.name}
                      {b.isMain && <span className="ml-2"><StatusBadge tone="info">Principal</StatusBadge></span>}
                    </td>
                    <td className="px-3 text-ink-2">
                      {[b.address, b.phone, b.email].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="px-3">
                      <StatusBadge tone={b.status === "ACTIVE" ? "success" : "neutral"}>{b.status === "ACTIVE" ? "Activa" : "Inactiva"}</StatusBadge>
                    </td>
                    <td className="px-3 text-right tabular-nums">{b.activeUsers}</td>
                    {canManage && (
                      <td className="px-5">
                        <div className="flex justify-end gap-2">
                          <button className={`${btnSecondary} h-8 px-3`} onClick={() => setEditing(b)}>Editar</button>
                          {canChangeMain && !b.isMain && b.status === "ACTIVE" && (
                            <button className={`${btnSecondary} h-8 px-3`} disabled={busyId === b.id} onClick={() => patch(b, { isMain: true })}>
                              Hacer principal
                            </button>
                          )}
                          {!b.isMain && (
                            <button className={`${btnSecondary} h-8 px-3`} disabled={busyId === b.id}
                              onClick={() => patch(b, { status: b.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })}>
                              {busyId === b.id && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                              {b.status === "ACTIVE" ? "Desactivar" : "Activar"}
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Nueva sucursal" : "Editar sucursal"}>
        {editing && <BranchForm branch={editing === "new" ? null : editing} onDone={() => { setEditing(null); router.refresh(); }} onCancel={() => setEditing(null)} />}
      </Modal>
    </>
  );
}

function BranchForm({ branch, onDone, onCancel }: { branch: BranchDetail | null; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({
    code: branch?.code ?? "", name: branch?.name ?? "", address: branch?.address ?? "", phone: branch?.phone ?? "", email: branch?.email ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { code, ...rest } = f;
    const r = branch
      ? await bff(`/bff/api/admin/branches/${branch.id}`, "PATCH", rest)
      : await bff("/bff/api/admin/branches", "POST", { code, ...rest });
    setBusy(false);
    if (r.ok) return onDone();
    if (r.status === 400) setError("Revisa los datos: el código admite letras, números, guion o guion bajo (máx. 12) y el correo debe ser válido.");
    else setError(errorText(r));
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
        <Field label="Código" hint={branch ? "No se puede cambiar." : "Ej.: SUC02"}>
          <input className={`${inputCls} uppercase ${branch ? "bg-surface-muted text-ink-2" : ""}`} value={f.code} onChange={set("code")} readOnly={!!branch} required maxLength={12} autoFocus={!branch} />
        </Field>
        <Field label="Nombre">
          <input className={inputCls} value={f.name} onChange={set("name")} required minLength={2} maxLength={120} autoFocus={!!branch} />
        </Field>
      </div>
      <Field label="Dirección"><input className={inputCls} value={f.address} onChange={set("address")} maxLength={200} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Teléfono"><input className={inputCls} value={f.phone} onChange={set("phone")} maxLength={40} inputMode="tel" /></Field>
        <Field label="Correo"><input className={inputCls} type="email" value={f.email} onChange={set("email")} maxLength={254} /></Field>
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {branch ? "Guardar cambios" : "Crear sucursal"}</button>
      </div>
    </form>
  );
}
