import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { getSecurity } from "@/lib/api";
import { SecurityPanels } from "./security-panels";

export const metadata: Metadata = { title: "Seguridad de la cuenta" };

export default async function SecurityPage() {
  const overview = await getSecurity();
  return (
    <>
      <PageHeader title="Seguridad de la cuenta" description="Tu acceso, tu contraseña y la verificación en dos pasos." />
      <SecurityPanels overview={overview} />
    </>
  );
}
