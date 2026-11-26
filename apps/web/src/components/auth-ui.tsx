"use client";

import { Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

/** Estilos de los formularios de acceso (acento azul de los assets de NEXUS ERP). */
export const authInput =
  "h-[52px] w-full rounded-xl border border-slate-200 bg-white pl-12 pr-4 text-base text-nx-navy placeholder:text-slate-400 focus:border-nx-accent focus:outline-none focus:ring-2 focus:ring-nx-accent/20";

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-gradient-to-br from-[#e4ebff] via-[#f0f4ff] to-white">
      <main className="grid flex-1 place-items-center px-5 py-10">
        <div className="w-full max-w-[460px]">
          <div className="mb-6 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/login/01_brand_logo_nexus_erp.png" alt="NEXUS ERP" width={240} height={66} />
          </div>
          <div className="rounded-[22px] border border-slate-100 bg-white p-8 shadow-[0_24px_64px_rgba(35,75,196,0.10)] sm:p-10">
            <h1 className="text-center text-[26px] font-bold tracking-tight text-nx-navy">{title}</h1>
            {subtitle && <p className="mt-1.5 text-center text-slate-600">{subtitle}</p>}
            <div className="mt-7">{children}</div>
          </div>
        </div>
      </main>
      <footer className="flex h-14 items-center justify-center border-t border-slate-200/70 bg-white/80 text-[13px] text-slate-500">
        NEXUS ERP · v0.1
      </footer>
    </div>
  );
}

export function PasswordInput({
  value, onChange, placeholder = "Contraseña", autoComplete = "current-password", label = "Contraseña", id: given,
}: { value: string; onChange: (v: string) => void; placeholder?: string; autoComplete?: string; label?: string; id?: string }) {
  const auto = useId();
  const id = given ?? auto;
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="sr-only">{label}</label>
      <div className="relative">
        <Lock className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-nx-navy/70" aria-hidden />
        <input
          id={id} type={show ? "text" : "password"} autoComplete={autoComplete} required
          placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)}
          className={`${authInput} pr-12`}
        />
        <button
          type="button" onClick={() => setShow((s) => !s)}
          aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={show}
          className="absolute right-3 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-nx-navy/70 hover:bg-slate-100"
        >
          {show ? <Eye className="size-5" /> : <EyeOff className="size-5" />}
        </button>
      </div>
    </div>
  );
}

export function SubmitButton({ busy, children, busyText }: { busy: boolean; children: ReactNode; busyText: string }) {
  return (
    <button
      type="submit" disabled={busy}
      className="flex h-[52px] w-full items-center justify-center gap-2.5 rounded-xl bg-nx-accent text-base font-semibold text-white shadow-[0_8px_20px_rgba(45,91,227,0.28)] transition-colors hover:bg-nx-accent-hover disabled:opacity-70"
    >
      {busy && <Loader2 className="size-5 animate-spin" aria-hidden />}
      {busy ? busyText : children}
    </button>
  );
}

export function FormMessage({ tone, children }: { tone: "error" | "ok"; children?: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"} aria-live={tone === "error" ? "assertive" : "polite"}
      className={
        children
          ? tone === "error"
            ? "rounded-lg bg-danger-soft px-4 py-2.5 text-[13px] text-danger"
            : "rounded-lg bg-success-soft px-4 py-2.5 text-[13px] text-success"
          : "sr-only"
      }
    >
      {children}
    </p>
  );
}

export const authLink = "font-medium text-nx-accent hover:underline";
