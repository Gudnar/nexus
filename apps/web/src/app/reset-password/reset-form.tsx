"use client";

import { CircleCheck, KeyRound } from "lucide-react";
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { authInput, authLink, FormMessage, PasswordInput, SubmitButton } from "@/components/auth-ui";
import { bff, errorText } from "@/lib/client-api";

export function ResetForm({ token, minLength }: { token: string; minLength: number }) {
  const id = useId();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-slate-700">El enlace está incompleto. Solicita uno nuevo.</p>
        <Link href="/forgot-password" className={authLink}>Recuperar contraseña</Link>
      </div>
    );
  }
  if (done) {
    return (
      <div className="space-y-5 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-success-soft text-success">
          <CircleCheck className="size-7" aria-hidden />
        </span>
        <p className="text-slate-700">Tu contraseña fue actualizada y se cerraron tus sesiones abiertas.</p>
        <Link href="/login" className="flex h-[52px] items-center justify-center rounded-xl bg-nx-accent font-semibold text-white hover:bg-nx-accent-hover">
          Iniciar sesión
        </Link>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError("Las contraseñas no coinciden.");
    setBusy(true);
    const r = await bff("/bff/auth/reset", "POST", { token, password, ...(needsMfa ? { mfaCode } : {}) });
    setBusy(false);
    if (r.ok) return setDone(true);
    if (r.data.code === "MFA_REQUIRED") {
      setNeedsMfa(true);
      return setError("Tu cuenta tiene verificación en dos pasos. Ingresa tu código para continuar.");
    }
    if (r.data.code === "INVALID_MFA_CODE") return setError("Código de verificación incorrecto.");
    if (r.data.code === "INVALID_TOKEN") return setError("El enlace no es válido o ya venció. Solicita uno nuevo.");
    setError(errorText(r));
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <PasswordInput value={password} onChange={setPassword} placeholder="Nueva contraseña" autoComplete="new-password" label="Nueva contraseña" />
      <PasswordInput value={confirm} onChange={setConfirm} placeholder="Repite la contraseña" autoComplete="new-password" label="Repite la contraseña" />
      <p className="text-[13px] text-slate-500">Mínimo {minLength} caracteres. No uses tu correo ni contraseñas comunes.</p>
      {needsMfa && (
        <div>
          <label htmlFor={`${id}-mfa`} className="sr-only">Código de verificación</label>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-nx-navy/70" aria-hidden />
            <input id={`${id}-mfa`} required autoFocus autoComplete="one-time-code" placeholder="Código de verificación" value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.trim())} className={authInput} maxLength={11} />
          </div>
        </div>
      )}
      <FormMessage tone="error">{error}</FormMessage>
      <SubmitButton busy={busy} busyText="Guardando…">Guardar contraseña</SubmitButton>
    </form>
  );
}
