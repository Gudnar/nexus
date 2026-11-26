"use client";

import { MailCheck, User } from "lucide-react";
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { authInput, authLink, FormMessage, SubmitButton } from "@/components/auth-ui";
import { bff, errorText } from "@/lib/client-api";

const LABELS: Record<string, string> = { EMAIL: "Correo electrónico", SMS: "SMS", WHATSAPP: "WhatsApp" };

export function ForgotForm({ channels }: { channels: string[] }) {
  const id = useId();
  const [identifier, setIdentifier] = useState("");
  const [channel, setChannel] = useState(channels[0] ?? "EMAIL");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await bff("/bff/auth/forgot", "POST", { identifier, channel });
    setBusy(false);
    if (r.ok) setSent(true);
    else setError(errorText(r));
  }

  if (sent) {
    return (
      <div className="space-y-5 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-nx-soft text-nx-accent">
          <MailCheck className="size-7" aria-hidden />
        </span>
        <p className="text-slate-700">
          Si existe una cuenta con esos datos, enviamos un enlace de recuperación por{" "}
          <strong>{LABELS[channel]?.toLowerCase()}</strong>. Vence en 30 minutos y solo puede usarse una vez.
        </p>
        <p className="text-[13px] text-slate-500">¿No llega? Revisa la carpeta de spam o inténtalo de nuevo en unos minutos.</p>
        <Link href="/login" className={`${authLink} block`}>Volver a iniciar sesión</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <label htmlFor={`${id}-u`} className="sr-only">Usuario o correo electrónico</label>
        <div className="relative">
          <User className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-nx-navy/70" aria-hidden />
          <input
            id={`${id}-u`} type="text" required autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false}
            placeholder="Usuario o correo electrónico" value={identifier} onChange={(e) => setIdentifier(e.target.value)}
            className={authInput}
          />
        </div>
      </div>
      {channels.length > 1 && (
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-nx-navy">Recibir el enlace por</legend>
          <div className="flex flex-wrap gap-2">
            {channels.map((c) => (
              <label key={c} className={`cursor-pointer rounded-lg border px-3.5 py-2 text-[14px] ${channel === c ? "border-nx-accent bg-nx-soft text-nx-accent" : "border-slate-200 text-slate-700"}`}>
                <input type="radio" name="channel" value={c} checked={channel === c} onChange={() => setChannel(c)} className="sr-only" />
                {LABELS[c] ?? c}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <FormMessage tone="error">{error}</FormMessage>
      <SubmitButton busy={busy} busyText="Enviando…">Enviar enlace</SubmitButton>
      <Link href="/login" className={`${authLink} block text-center text-[14px]`}>Volver a iniciar sesión</Link>
    </form>
  );
}
