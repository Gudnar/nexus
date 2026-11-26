import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-ui";
import { getPublicConfig } from "@/lib/public-config";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Recuperar contraseña" };

export default async function ForgotPasswordPage() {
  const { recoveryChannels } = await getPublicConfig();
  return (
    <AuthCard title="Recuperar contraseña" subtitle="Te enviaremos un enlace para crear una nueva.">
      <ForgotForm channels={recoveryChannels} />
    </AuthCard>
  );
}
