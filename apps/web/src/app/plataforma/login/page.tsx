import type { Metadata } from "next";
import { PlatformLoginForm } from "./platform-login-form";

export const metadata: Metadata = { title: "Consola de plataforma" };

export default function PlatformLoginPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-5">
      <div className="w-full max-w-[400px]">
        <p className="mb-1 text-center text-xs font-semibold tracking-wide text-brand">NEXUS ERP</p>
        <h1 className="mb-6 text-center text-[24px] font-[650] text-ink">Consola de plataforma</h1>
        <div className="rounded-lg border border-line bg-surface p-6 shadow-card">
          <PlatformLoginForm />
        </div>
        <p className="mt-4 text-center text-xs text-ink-3">Acceso exclusivo del administrador global.</p>
      </div>
    </main>
  );
}
