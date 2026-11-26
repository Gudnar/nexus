import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui";
import { getPlatformPlans, getPlatformSettings, getPlatformTenants } from "@/lib/api";
import { PlatformLogout, PlatformRegistration } from "./platform-console";
import { TenantsManager } from "./tenants-manager";

export const metadata: Metadata = { title: "Consola de plataforma" };

/** Consola del administrador global. Sesión propia (cookie y token de audiencia distintos). */
export default async function PlatformPage() {
  const settings = await getPlatformSettings();
  if (!settings) redirect("/plataforma/login");
  const [tenants, plans] = await Promise.all([getPlatformTenants(), getPlatformPlans()]);

  return (
    <div className="min-h-screen bg-canvas">
      <header className="flex h-[68px] items-center justify-between border-b border-line bg-surface px-7">
        <div>
          <p className="text-xs font-semibold tracking-wide text-brand">NEXUS ERP</p>
          <p className="font-semibold text-ink">Consola de plataforma</p>
        </div>
        <PlatformLogout />
      </header>
      <main className="mx-auto max-w-[1100px] p-4 sm:p-7">
        <h1 className="mb-6 text-[24px] font-[650] text-ink">Ajustes globales</h1>
        <Card>
          <CardHeader title="Registro de nuevas empresas" />
          <PlatformRegistration enabled={settings.registration.enabled} />
        </Card>
        <h2 className="mb-4 mt-10 text-[20px] font-[650] text-ink">Empresas</h2>
        <TenantsManager tenants={tenants ?? []} plans={plans ?? []} />
      </main>
    </div>
  );
}
