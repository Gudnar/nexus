"use client";

import { AtSign, Building2, IdCard, Mail, MailCheck, User } from "lucide-react";
import Link from "next/link";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { authInput, authLink, FormMessage, PasswordInput, SubmitButton } from "@/components/auth-ui";
import { bff, errorText } from "@/lib/client-api";

function Field({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-nx-navy/70">{icon}</span>
      {children}
    </div>
  );
}

export function RegisterForm({ minLength }: { minLength: number }) {
  const id = useId();
  const [f, setF] = useState({ companyName: "", taxId: "", adminName: "", email: "", username: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (f.password !== f.confirm) return setError("Las contraseñas no coinciden.");
    setBusy(true);
    const r = await bff("/bff/public/register", "POST", {
      companyName: f.companyName, adminName: f.adminName, email: f.email, password: f.password,
      ...(f.taxId ? { taxId: f.taxId } : {}), ...(f.username ? { username: f.username } : {}),
    });
    setBusy(false);
    if (r.ok) return setSent(true);
    if (r.data.code === "USERNAME_TAKEN") return setError("Ese usuario ya está en uso. Prueba con otro.");
    if (r.data.code === "REGISTRATION_DISABLED") return setError("El registro dejó de estar disponible.");
    if (r.data.code === "VALIDATION") return setError("Revisa los datos: el correo y el usuario deben tener un formato válido.");
    setError(errorText(r));
  }

  if (sent) {
    return (
      <div className="space-y-5 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-nx-soft text-nx-accent">
          <MailCheck className="size-7" aria-hidden />
        </span>
        <p className="text-slate-700">
          Enviamos un enlace de confirmación a <strong>{f.email}</strong>. Tu empresa se creará cuando lo abras (vence en 24 horas).
        </p>
        <Link href="/login" className={`${authLink} block`}>Volver a iniciar sesión</Link>
      </div>
    );
  }

  const input = (k: keyof typeof f, placeholder: string, extra: Record<string, unknown> = {}) => (
    <input id={`${id}-${k}`} value={f[k]} onChange={set(k)} placeholder={placeholder} aria-label={placeholder} className={authInput} {...extra} />
  );

  return (
    <form onSubmit={submit} className="space-y-3.5" noValidate>
      <Field icon={<Building2 className="size-5" aria-hidden />}>{input("companyName", "Nombre de la empresa", { required: true, autoFocus: true, autoComplete: "organization" })}</Field>
      <Field icon={<IdCard className="size-5" aria-hidden />}>{input("taxId", "NIT (opcional)", { autoComplete: "off" })}</Field>
      <Field icon={<User className="size-5" aria-hidden />}>{input("adminName", "Tu nombre completo", { required: true, autoComplete: "name" })}</Field>
      <Field icon={<Mail className="size-5" aria-hidden />}>{input("email", "Correo electrónico", { required: true, type: "email", autoComplete: "email", autoCapitalize: "none" })}</Field>
      <Field icon={<AtSign className="size-5" aria-hidden />}>{input("username", "Usuario (opcional)", { autoComplete: "off", autoCapitalize: "none", spellCheck: false })}</Field>
      <PasswordInput value={f.password} onChange={(v) => setF((s) => ({ ...s, password: v }))} placeholder="Contraseña" autoComplete="new-password" />
      <PasswordInput value={f.confirm} onChange={(v) => setF((s) => ({ ...s, confirm: v }))} placeholder="Repite la contraseña" autoComplete="new-password" label="Repite la contraseña" />
      <p className="text-[13px] text-slate-500">Mínimo {minLength} caracteres. Con el usuario podrás entrar sin escribir tu correo.</p>
      <FormMessage tone="error">{error}</FormMessage>
      <SubmitButton busy={busy} busyText="Enviando…">Crear cuenta</SubmitButton>
      <p className="text-center text-[14px] text-slate-600">
        ¿Ya tienes cuenta? <Link href="/login" className={authLink}>Iniciar sesión</Link>
      </p>
    </form>
  );
}
