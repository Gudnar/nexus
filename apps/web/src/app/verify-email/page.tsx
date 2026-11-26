import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-ui";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = { title: "Confirmar correo" };

/**
 * No consume el enlace al cargar: los filtros de correo y los antivirus abren los enlaces
 * automáticamente. La confirmación ocurre solo cuando la persona pulsa el botón.
 */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthCard title="Confirma tu correo" subtitle="Un último paso para crear tu empresa.">
      <VerifyForm token={token ?? ""} />
    </AuthCard>
  );
}
