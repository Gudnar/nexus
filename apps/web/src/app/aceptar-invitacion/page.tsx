import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-ui";
import { getPublicConfig } from "@/lib/public-config";
import { AcceptForm } from "./accept-form";

export const metadata: Metadata = { title: "Aceptar invitación" };

/** Los datos de la invitación se piden desde el navegador: abrir el enlace no consume nada. */
export default async function AcceptInvitationPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const { passwordMinLength } = await getPublicConfig();
  return (
    <AuthCard title="Te invitaron a NEXUS ERP" subtitle="Acepta la invitación para entrar a la empresa.">
      <AcceptForm token={token ?? ""} minLength={passwordMinLength} />
    </AuthCard>
  );
}
