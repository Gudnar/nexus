"use client";

import type { MfaSetupResponse, SecurityOverview } from "@erp/contracts";
import { Check, Copy, Download, KeyRound, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { btnDanger, btnPrimary, btnSecondary, Card, CardHeader, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

type Msg = { tone: "ok" | "error"; text: string } | null;

function Notice({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p role={msg.tone === "error" ? "alert" : "status"}
      className={`rounded-lg px-3.5 py-2.5 text-[13px] ${msg.tone === "error" ? "bg-danger-soft text-danger" : "bg-success-soft text-success"}`}>
      {msg.text}
    </p>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export function SecurityPanels({ overview }: { overview: SecurityOverview }) {
  return (
    <div className="grid max-w-[1040px] gap-6">
      <ProfileCard overview={overview} />
      <PasswordCard />
      <MfaCard overview={overview} />
    </div>
  );
}

// ───────────── Perfil: nombre y usuario ─────────────

function ProfileCard({ overview }: { overview: SecurityOverview }) {
  const router = useRouter();
  const [name, setName] = useState(overview.name);
  const [username, setUsername] = useState(overview.username ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await bff("/bff/api/me/profile", "PATCH", { name, username: username.trim() === "" ? null : username });
    setBusy(false);
    if (r.ok) {
      setMsg({ tone: "ok", text: "Cambios guardados." });
      router.refresh();
    } else if (r.data.code === "USERNAME_TAKEN") setMsg({ tone: "error", text: "Ese usuario ya está en uso." });
    else if (r.status === 400) setMsg({ tone: "error", text: "Usa 3 a 32 caracteres: letras, números, punto, guion o guion bajo." });
    else setMsg({ tone: "error", text: errorText(r) });
  }

  return (
    <Card>
      <CardHeader title="Acceso a tu cuenta" />
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Correo electrónico">
          <input className={`${inputCls} bg-surface-muted text-ink-2`} value={overview.email} readOnly aria-readonly />
        </Field>
        <Field label="Nombre">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} />
        </Field>
        <Field label="Usuario (opcional)" hint="Podrás iniciar sesión con tu usuario o con tu correo.">
          <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" spellCheck={false} placeholder="p. ej. maria.lopez" />
        </Field>
        <div className="flex items-end justify-between gap-3 sm:col-span-2">
          <div className="flex-1"><Notice msg={msg} /></div>
          <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Guardar cambios</button>
        </div>
      </form>
    </Card>
  );
}

// ───────────── Contraseña ─────────────

function PasswordCard() {
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (f.next !== f.confirm) return setMsg({ tone: "error", text: "Las contraseñas nuevas no coinciden." });
    setBusy(true);
    const r = await bff("/bff/api/me/password", "POST", { currentPassword: f.current, newPassword: f.next });
    setBusy(false);
    if (r.ok) {
      setF({ current: "", next: "", confirm: "" });
      setMsg({ tone: "ok", text: "Contraseña actualizada. Se cerraron tus otras sesiones." });
    } else if (r.data.code === "INVALID_CREDENTIALS") setMsg({ tone: "error", text: "La contraseña actual es incorrecta." });
    else setMsg({ tone: "error", text: errorText(r) });
  }

  return (
    <Card>
      <CardHeader title="Contraseña" />
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-3">
        <Field label="Contraseña actual">
          <input type="password" autoComplete="current-password" className={inputCls} value={f.current} onChange={set("current")} required />
        </Field>
        <Field label="Nueva contraseña" hint="Mínimo 10 caracteres.">
          <input type="password" autoComplete="new-password" className={inputCls} value={f.next} onChange={set("next")} required />
        </Field>
        <Field label="Repite la nueva">
          <input type="password" autoComplete="new-password" className={inputCls} value={f.confirm} onChange={set("confirm")} required />
        </Field>
        <div className="flex items-end justify-between gap-3 sm:col-span-3">
          <div className="flex-1"><Notice msg={msg} /></div>
          <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Cambiar contraseña</button>
        </div>
      </form>
    </Card>
  );
}

// ───────────── MFA ─────────────

type Step = "idle" | "password" | "scan" | "codes" | "disable" | "regen";

function MfaCard({ overview }: { overview: SecurityOverview }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => { setStep("idle"); setPassword(""); setCode(""); setSetup(null); setMsg(null); };
  const fail = (r: Parameters<typeof errorText>[0]) =>
    setMsg({ tone: "error", text: r.data.code === "INVALID_CREDENTIALS" ? "La contraseña es incorrecta." : r.data.code === "INVALID_MFA_CODE" ? "El código no es válido." : errorText(r) });

  async function begin(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await bff<MfaSetupResponse>("/bff/api/me/mfa/setup", "POST", { password });
    setBusy(false);
    if (r.ok) { setSetup(r.data); setPassword(""); setStep("scan"); } else fail(r);
  }
  async function enable(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await bff<{ recoveryCodes: string[] }>("/bff/api/me/mfa/enable", "POST", { code });
    setBusy(false);
    if (r.ok) { setCodes(r.data.recoveryCodes); setCode(""); setStep("codes"); } else fail(r);
  }
  async function disable(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await bff("/bff/api/me/mfa/disable", "POST", { password, code });
    setBusy(false);
    if (r.ok) { reset(); router.refresh(); } else fail(r);
  }
  async function regenerate(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await bff<{ recoveryCodes: string[] }>("/bff/api/me/mfa/recovery-codes", "POST", { password, code });
    setBusy(false);
    if (r.ok) { setCodes(r.data.recoveryCodes); setPassword(""); setCode(""); setStep("codes"); } else fail(r);
  }

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };
  const download = () => {
    const blob = new Blob([`NEXUS ERP — códigos de recuperación de ${overview.email}\nCada código sirve una sola vez.\n\n${codes.join("\n")}\n`], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "nexus-erp-codigos-recuperacion.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card>
      <CardHeader
        title="Verificación en dos pasos (MFA)"
        action={overview.mfaEnabled || step === "codes" ? <StatusBadge tone="success">Activada</StatusBadge> : <StatusBadge>Desactivada</StatusBadge>}
      />

      {step === "idle" && !overview.mfaEnabled && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-xl text-ink-2">
            Añade una capa extra: además de tu contraseña, te pediremos un código de una app autenticadora (Google Authenticator, Microsoft Authenticator, Authy o 1Password).
          </p>
          <button className={btnPrimary} onClick={() => setStep("password")}><ShieldCheck className="size-4" aria-hidden /> Activar MFA</button>
        </div>
      )}

      {step === "idle" && overview.mfaEnabled && (
        <div className="space-y-4">
          <p className="text-ink-2">
            Activada{overview.mfaEnabledAt ? ` el ${new Date(overview.mfaEnabledAt).toLocaleDateString("es-BO")}` : ""}. Te pedimos un código al iniciar sesión y al restablecer la contraseña.
          </p>
          <p className="flex items-center gap-2 text-[13px]">
            <KeyRound className="size-4 text-ink-3" aria-hidden />
            Códigos de recuperación disponibles: <strong>{overview.recoveryCodesRemaining}</strong>
            {overview.recoveryCodesRemaining <= 2 && <StatusBadge tone="warning">Quedan pocos</StatusBadge>}
          </p>
          <div className="flex flex-wrap gap-2">
            <button className={btnSecondary} onClick={() => setStep("regen")}><KeyRound className="size-4" aria-hidden /> Generar códigos nuevos</button>
            <button className={btnSecondary} onClick={() => setStep("disable")}><ShieldOff className="size-4" aria-hidden /> Desactivar MFA</button>
          </div>
        </div>
      )}

      {step === "password" && (
        <form onSubmit={begin} className="grid max-w-md gap-4">
          <p className="text-ink-2">Para empezar, confirma tu contraseña.</p>
          <Field label="Contraseña"><input type="password" autoFocus autoComplete="current-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          <Notice msg={msg} />
          <div className="flex gap-2">
            <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Continuar</button>
            <button type="button" className={btnSecondary} onClick={reset}>Cancelar</button>
          </div>
        </form>
      )}

      {step === "scan" && setup && (
        <form onSubmit={enable} className="grid gap-6 md:grid-cols-[auto_1fr]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="Código QR para tu app autenticadora" width={200} height={200} className="rounded-lg border border-line bg-white p-2"
            src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`} />
          <div className="grid max-w-md content-start gap-4">
            <ol className="list-decimal space-y-1 pl-5 text-ink-2">
              <li>Escanea el código con tu app autenticadora.</li>
              <li>Ingresa el código de 6 dígitos que muestra la app.</li>
            </ol>
            <p className="text-xs text-ink-3">
              ¿No puedes escanear? Ingresa esta clave manualmente: <code className="select-all break-all rounded bg-neutral-soft px-1.5 py-0.5 text-ink">{setup.secret}</code>
            </p>
            <Field label="Código de 6 dígitos">
              <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}" className={`${inputCls} tracking-[0.3em]`} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required />
            </Field>
            <Notice msg={msg} />
            <div className="flex gap-2">
              <button className={btnPrimary} disabled={busy || code.length !== 6}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Activar</button>
              <button type="button" className={btnSecondary} onClick={reset}>Cancelar</button>
            </div>
          </div>
        </form>
      )}

      {step === "codes" && (
        <div className="space-y-4">
          <p className="rounded-lg bg-warning-soft px-3.5 py-2.5 text-[13px] text-warning">
            Guarda estos códigos en un lugar seguro. Se muestran <strong>una sola vez</strong>; cada uno sirve para entrar una vez si pierdes tu teléfono.
          </p>
          <ul className="grid max-w-md grid-cols-2 gap-2 font-mono text-[14px]" aria-label="Códigos de recuperación">
            {codes.map((c) => <li key={c} className="rounded-md border border-line bg-surface-muted px-3 py-2 text-center tracking-wider">{c}</li>)}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button className={btnSecondary} onClick={() => copy(codes.join("\n"))}>{copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? "Copiados" : "Copiar"}</button>
            <button className={btnSecondary} onClick={download}><Download className="size-4" aria-hidden /> Descargar</button>
            <button className={btnPrimary} onClick={() => { reset(); setCodes([]); router.refresh(); }}>Ya los guardé</button>
          </div>
        </div>
      )}

      {(step === "disable" || step === "regen") && (
        <form onSubmit={step === "disable" ? disable : regenerate} className="grid max-w-md gap-4">
          <p className="text-ink-2">
            {step === "disable" ? "Para desactivar el MFA confirma tu contraseña y un código." : "Los códigos anteriores dejarán de funcionar. Confirma tu contraseña y un código."}
          </p>
          <Field label="Contraseña"><input type="password" autoFocus autoComplete="current-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          <Field label="Código de tu app o de recuperación"><input autoComplete="one-time-code" className={inputCls} value={code} onChange={(e) => setCode(e.target.value.trim())} required minLength={6} maxLength={11} /></Field>
          <Notice msg={msg} />
          <div className="flex gap-2">
            <button className={step === "disable" ? btnDanger : btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {step === "disable" ? "Desactivar MFA" : "Generar códigos"}</button>
            <button type="button" className={btnSecondary} onClick={reset}>Cancelar</button>
          </div>
        </form>
      )}
    </Card>
  );
}
