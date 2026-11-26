import { Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, authLink } from "@/components/auth-ui";
import { getPublicConfig } from "@/lib/public-config";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Crear cuenta" };

export default async function RegisterPage() {
  const config = await getPublicConfig();

  if (!config.registrationEnabled) {
    return (
      <AuthCard title="Registro no disponible">
        <div className="space-y-5 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-nx-soft text-nx-accent">
            <Lock className="size-7" aria-hidden />
          </span>
          <p className="text-slate-700">
            El registro de nuevas empresas no está habilitado en este momento. Si necesitas una cuenta, contacta al administrador de la plataforma.
          </p>
          <Link href="/login" className={`${authLink} block`}>Volver a iniciar sesión</Link>
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Crea tu empresa" subtitle="Empieza con un periodo de prueba. Confirmaremos tu correo.">
      <RegisterForm minLength={config.passwordMinLength} />
    </AuthCard>
  );
}
