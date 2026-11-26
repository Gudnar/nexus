"use client";

import { ArrowRightToLine, KeyRound, Loader2, ShieldCheck, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { authInput, authLink, FormMessage, PasswordInput } from "@/components/auth-ui";
import { bff, errorText } from "@/lib/client-api";

interface Tenant {
  slug: string;
  name: string;
}

export function LoginForm({ registrationEnabled }: { registrationEnabled: boolean }) {
  const router = useRouter();
  const id = useId();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [tenant, setTenant] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function done() {
    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
    router.refresh();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mfaToken) {
        const r = await bff("/bff/auth/mfa", "POST", { mfaToken, code, remember });
        if (r.ok) return done();
        if (r.data.code === "INVALID_MFA_CODE" && r.status === 401) setError("Código incorrecto. Inténtalo de nuevo.");
        else if (r.status === 429) setError("Demasiados intentos. Espera unos minutos e inicia sesión de nuevo.");
        else setError("No se pudo verificar. Inicia sesión de nuevo.");
        return;
      }
      const r = await bff<{ code?: string; tenants?: Tenant[]; mfaRequired?: boolean; mfaToken?: string }>(
        "/bff/auth/login", "POST", { identifier, password, remember, ...(tenant ? { tenant } : {}) },
      );
      if (r.ok && r.data.mfaRequired && r.data.mfaToken) {
        setMfaToken(r.data.mfaToken);
        return;
      }
      if (r.ok) return done();
      if (r.data.code === "TENANT_REQUIRED" && r.data.tenants?.length) {
        setTenants(r.data.tenants);
        setTenant(r.data.tenants[0]!.slug);
        setError("Perteneces a más de una empresa. Elige a cuál quieres entrar.");
      } else if (r.status === 400) setError("Revisa tu usuario o correo y la contraseña.");
      else if (r.status === 401) setError("Credenciales inválidas.");
      else setError(errorText(r));
    } finally {
      setBusy(false);
    }
  }

  if (mfaToken) {
    const recovery = code.includes("-") || /[a-z]/i.test(code);
    return (
      <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
        <div className="flex items-start gap-3 rounded-xl bg-[#f1f4fd] p-4 text-[13px] text-slate-700">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-nx-accent" aria-hidden />
          <p>Ingresa el código de 6 dígitos de tu aplicación autenticadora, o un código de recuperación.</p>
        </div>
        <div>
          <label htmlFor={`${id}-code`} className="sr-only">Código de verificación</label>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-nx-navy/70" aria-hidden />
            <input
              id={`${id}-code`} autoFocus required autoComplete="one-time-code" inputMode={recovery ? "text" : "numeric"}
              placeholder="Código de verificación" value={code} maxLength={11}
              onChange={(e) => setCode(e.target.value.trim())}
              className={`${authInput} tracking-widest`}
            />
          </div>
        </div>
        <FormMessage tone="error">{error}</FormMessage>
        <button
          type="submit" disabled={busy || code.length < 6}
          className="flex h-[52px] w-full items-center justify-center gap-2.5 rounded-xl bg-nx-accent text-base font-semibold text-white shadow-[0_8px_20px_rgba(45,91,227,0.28)] hover:bg-nx-accent-hover disabled:opacity-70"
        >
          {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <ShieldCheck className="size-5" aria-hidden />}
          {busy ? "Verificando…" : "Verificar"}
        </button>
        <button type="button" className={`${authLink} block w-full text-center text-[14px]`} onClick={() => { setMfaToken(null); setCode(""); setError(null); }}>
          Volver
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
      <div>
        <label htmlFor={`${id}-user`} className="sr-only">Usuario o correo electrónico</label>
        <div className="relative">
          <User className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-nx-navy/70" aria-hidden />
          <input
            id={`${id}-user`} type="text" autoComplete="username" required autoFocus autoCapitalize="none" spellCheck={false}
            placeholder="Usuario o correo electrónico" value={identifier} onChange={(e) => setIdentifier(e.target.value)}
            className={authInput}
          />
        </div>
      </div>

      <PasswordInput value={password} onChange={setPassword} />

      {tenants && (
        <div>
          <label htmlFor={`${id}-tenant`} className="mb-1.5 block text-[13px] font-medium text-nx-navy">Empresa</label>
          <select
            id={`${id}-tenant`} value={tenant} onChange={(e) => setTenant(e.target.value)}
            className="h-[52px] w-full rounded-xl border border-slate-200 bg-white px-4 text-base text-nx-navy focus:border-nx-accent focus:outline-none focus:ring-2 focus:ring-nx-accent/20"
          >
            {tenants.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
          </select>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2.5 text-[15px] text-slate-700">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-[18px] rounded accent-nx-accent" />
          Recordar mi sesión
        </label>
        <Link href="/forgot-password" className={`${authLink} text-[14px]`}>¿Olvidaste tu contraseña?</Link>
      </div>

      <FormMessage tone="error">{error}</FormMessage>

      <button
        type="submit" disabled={busy}
        className="flex h-[52px] w-full items-center justify-center gap-2.5 rounded-xl bg-nx-accent text-base font-semibold text-white shadow-[0_8px_20px_rgba(45,91,227,0.28)] transition-colors hover:bg-nx-accent-hover disabled:opacity-70"
      >
        {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <ArrowRightToLine className="size-5" aria-hidden />}
        {busy ? "Ingresando…" : "Ingresar"}
      </button>

      {registrationEnabled && (
        <p className="pt-1 text-center text-[14px] text-slate-600">
          ¿Tu empresa aún no usa NEXUS ERP? <Link href="/register" className={authLink}>Crear una cuenta</Link>
        </p>
      )}
    </form>
  );
}
