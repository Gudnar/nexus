import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getIntegrations, getMe } from "@/lib/api";
import { IntegrationsManager } from "./integrations-manager";

export const metadata: Metadata = { title: "Integraciones" };

export default async function IntegrationsPage() {
  const me = await getMe();
  if (!me.permissions.includes("integrations.manage")) redirect("/dashboard");
  const integrations = await getIntegrations();
  return (
    <>
      <PageHeader title="Integraciones" description="Conecta NEXUS con servicios externos. Los datos secretos se guardan cifrados y no se vuelven a mostrar." />
      <IntegrationsManager integrations={integrations} />
    </>
  );
}
