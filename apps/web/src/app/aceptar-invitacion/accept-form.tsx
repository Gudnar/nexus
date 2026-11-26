"use client";

import type { InvitationInfo } from "@erp/contracts";
import { AtSign, CircleCheck, Loader2, TriangleAlert, User } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState, type FormEvent } from "react";
import { authInput, authLink, FormMessage, PasswordInput, SubmitButton } from "@/components/auth-ui";
import { bff, errorText } from "@/lib/client-api";

export function AcceptForm({ token, minLength }: { token: string; minLength: number }) {
  const id = useId();
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "done">(token ? "loading" : "invalid");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    bff<InvitationInfo>("/bff/public/invitation", "POST", { action: "info", token }).then((r) => {
      if (!alive) return;
      if (r.ok) { setInfo(r.data); setState("ready"); } else setState("invalid");
    });
    return () => { alive = false; };
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!info) return;
    if (!info.accountExists && password !== confirm) return setError("Las contraseñas no coinciden.");
    setBusy(true);
    const r = await bff("/bff/public/invitation", "POST", {
      action: "accept", token, password,
      ...(info.accountExists ? {} : { name, ...(username ? { username } : {}) }),
    });
    setBusy(false);
    if (r.ok) return setState("done");
    if (r.data.code === "INVALID_TOKEN") { setState("invalid"); return; }
    if (r.data.code === "USERNAME_TAKEN") return setError("Ese usuario ya está en uso. Prueba con otro.");
    if (r.data.code === "ALREADY_MEMBER") return setError("Ya perteneces a esta empresa. Inicia sesión.");
    if (r.status === 401) return setError("La contraseña es incorrecta.");
    if (r.status === 400 && r.data.code === "VALIDATION") return setError("Revisa los datos (el usuario admite letras, números, punto, guion y guion bajo).");
    setError(errorText(r));
  }

  if (state === "loading") {
    return <div className="grid place-items-center py-8"><Loader2 className="size-6 animate-spin text-nx-accent" aria-label="Cargando" /></div>;
  }
  if (state === "invalid") {
    return (
      <div className="space-y-4 text-center">
        <TriangleAlert className="mx-auto size-10 text-warning" aria-hidden />
        <p className="text-slate-700">La invitación no es válida o ya venció. Pide a tu administrador que te envíe una nueva.</p>
        <Link href="/login" className={authLink}>Ir a iniciar sesión</Link>
      </div>
    );
  }
  if (state === "done") {
    return (
      <div className="space-y-5 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-success-soft text-success">
          <CircleCheck className="size-7" aria-hidden />
        </span>
        <p className="text-slate-700">¡Listo! Ya formas parte de <strong>{info?.tenantName}</strong>.</p>
        <Link href="/login" className="flex h-[52px] items-center justify-center rounded-xl bg-nx-accent font-semibold text-white hover:bg-nx-accent-hover">
          Iniciar sesión
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="rounded-xl bg-[#f1f4fd] p-4 text-[14px] text-slate-700">
        <p><strong>{info!.tenantName}</strong> te invita como <strong>{info!.roleName}</strong>.</p>
        <p className="mt-0.5 text-slate-500">{info!.email}</p>
      </div>
      {info!.accountExists ? (
        <>
          <p className="text-[14px] text-slate-600">Ya tienes una cuenta con este correo. Confirma con tu contraseña para añadir esta empresa.</p>
          <PasswordInput value={password} onChange={setPassword} />
        </>
      ) : (
        <>
          <div className="relative">
            <User className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-nx-navy/70" aria-hidden />
            <input id={`${id}-n`} aria-label="Tu nombre completo" placeholder="Tu nombre completo" value={name} onChange={(e) => setName(e.target.value)} required autoFocus autoComplete="name" className={authInput} />
          </div>
          <div className="relative">
            <AtSign className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-nx-navy/70" aria-hidden />
            <input aria-label="Usuario (opcional)" placeholder="Usuario (opcional)" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} className={authInput} />
          </div>
          <PasswordInput value={password} onChange={setPassword} placeholder="Crea una contraseña" autoComplete="new-password" label="Contraseña" />
          <PasswordInput value={confirm} onChange={setConfirm} placeholder="Repite la contraseña" autoComplete="new-password" label="Repite la contraseña" />
          <p className="text-[13px] text-slate-500">Mínimo {minLength} caracteres. No uses tu correo ni contraseñas comunes.</p>
        </>
      )}
      <FormMessage tone="error">{error}</FormMessage>
      <SubmitButton busy={busy} busyText="Aceptando…">Aceptar invitación</SubmitButton>
    </form>
  );
}
