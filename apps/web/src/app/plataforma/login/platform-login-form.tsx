"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { btnPrimary, inputCls } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

export function PlatformLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await bff("/bff/platform/login", "POST", { email, password, ...(totp ? { totp } : {}) });
    setBusy(false);
    if (r.ok) {
      router.replace("/plataforma");
      router.refresh();
    } else setError(r.status === 401 ? "Credenciales inválidas." : errorText(r));
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-ink-2">Correo</span>
        <input type="email" autoComplete="username" autoFocus required className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-ink-2">Contraseña</span>
        <input type="password" autoComplete="current-password" required className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-ink-2">Código TOTP (si lo tienes configurado)</span>
        <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} className={inputCls} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))} />
      </label>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">{error}</p>}
      <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Entrar</button>
    </form>
  );
}
