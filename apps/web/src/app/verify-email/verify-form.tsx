"use client";

import { CircleCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { authLink, FormMessage, SubmitButton } from "@/components/auth-ui";
import { bff, errorText } from "@/lib/client-api";

export function VerifyForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ email: string; tenant: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <div className="space-y-4 text-center">
        <TriangleAlert className="mx-auto size-10 text-warning" aria-hidden />
        <p className="text-slate-700">El enlace está incompleto. Revisa el correo que recibiste.</p>
        <Link href="/login" className={authLink}>Ir a iniciar sesión</Link>
      </div>
    );
  }
  if (result) {
    return (
      <div className="space-y-5 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-success-soft text-success">
          <CircleCheck className="size-7" aria-hidden />
        </span>
        <p className="text-slate-700">Tu correo fue confirmado y tu empresa está lista. Ya puedes iniciar sesión con <strong>{result.email}</strong>.</p>
        <Link href="/login" className="flex h-[52px] items-center justify-center rounded-xl bg-nx-accent font-semibold text-white hover:bg-nx-accent-hover">
          Iniciar sesión
        </Link>
      </div>
    );
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    const r = await bff<{ email: string; tenant: string; code?: string }>("/bff/public/verify", "POST", { token });
    setBusy(false);
    if (r.ok) return setResult(r.data);
    if (r.data.code === "INVALID_TOKEN") return setError("El enlace no es válido o ya venció. Vuelve a registrarte.");
    if (r.data.code === "REGISTRATION_DISABLED") return setError("El registro no está habilitado en este momento.");
    if (r.data.code === "ACCOUNT_EXISTS") return setError("Ya existe una cuenta con esos datos. Inicia sesión.");
    setError(errorText(r));
  }

  return (
    <div className="space-y-4">
      <FormMessage tone="error">{error}</FormMessage>
      <form onSubmit={(e) => { e.preventDefault(); void confirm(); }}>
        <SubmitButton busy={busy} busyText="Confirmando…">Confirmar y crear mi empresa</SubmitButton>
      </form>
    </div>
  );
}
