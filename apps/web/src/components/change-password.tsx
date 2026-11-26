"use client";

import { KeyRound, Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Field } from "@/components/field";
import { Modal } from "@/components/modal";
import { btnPrimary, btnSecondary, inputCls } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

/** Formulario para que cada persona cambie su propia contraseña (pide la actual; cierra sus otras sesiones). */
export function ChangePasswordForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (f.next !== f.confirm) return setError("Las contraseñas nuevas no coinciden.");
    if (f.next === f.current) return setError("La nueva contraseña debe ser distinta de la actual.");
    setBusy(true);
    const r = await bff("/bff/api/me/password", "POST", { currentPassword: f.current, newPassword: f.next });
    setBusy(false);
    if (r.ok) return setSaved(true);
    setError(r.data.code === "INVALID_CREDENTIALS" ? "La contraseña actual es incorrecta." : errorText(r));
  }

  if (saved) {
    return (
      <div className="grid gap-4 text-[13px]" data-testid="password-changed">
        <p role="status" className="rounded-lg bg-success-soft px-3 py-2.5 text-success">Contraseña actualizada. Se cerraron tus otras sesiones abiertas.</p>
        <div className="flex justify-end"><button className={btnPrimary} onClick={onDone}>Listo</button></div>
      </div>
    );
  }
  return (
    <form onSubmit={save} className="grid gap-4 text-[13px]">
      <Field label="Contraseña actual"><input aria-label="Contraseña actual" type="password" autoComplete="current-password" required autoFocus className={inputCls} value={f.current} onChange={set("current")} /></Field>
      <Field label="Nueva contraseña" hint="Mínimo 10 caracteres. No uses tu correo ni contraseñas comunes."><input aria-label="Nueva contraseña" type="password" autoComplete="new-password" required className={inputCls} value={f.next} onChange={set("next")} /></Field>
      <Field label="Repite la nueva contraseña"><input aria-label="Repite la nueva contraseña" type="password" autoComplete="new-password" required className={inputCls} value={f.confirm} onChange={set("confirm")} /></Field>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />}Cambiar contraseña</button>
      </div>
    </form>
  );
}

/** Botón + ventana, para ponerlo donde haga falta. */
export function ChangePasswordButton({ className = btnSecondary, label = "Cambiar mi contraseña" }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}><KeyRound className="size-4" aria-hidden />{label}</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Cambiar mi contraseña">
        <ChangePasswordForm onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />
      </Modal>
    </>
  );
}
