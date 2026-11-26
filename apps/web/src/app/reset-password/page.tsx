import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-ui";
import { getPublicConfig } from "@/lib/public-config";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Nueva contraseña" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const { passwordMinLength } = await getPublicConfig();
  return (
    <AuthCard title="Crea una nueva contraseña" subtitle="Elige una contraseña que no uses en otros sitios.">
      <ResetForm token={token ?? ""} minLength={passwordMinLength} />
    </AuthCard>
  );
}
