import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UsersTabs } from "@/components/admin-tabs";
import { PageHeader } from "@/components/ui";
import { getMe, getSchedules } from "@/lib/api";
import { SchedulesManager } from "./schedules-manager";

export const metadata: Metadata = { title: "Horarios de acceso" };

export default async function SchedulesPage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("users.read")) redirect("/dashboard");
  const schedules = await getSchedules();

  return (
    <>
      <PageHeader title="Usuarios y roles" description="Define cuándo puede entrar cada persona. Fuera de su horario no puede iniciar sesión ni seguir usando el sistema." />
      <UsersTabs active="schedules" canRoles={perms.has("roles.read")} />
      <SchedulesManager schedules={schedules} canManage={perms.has("users.manage")} tenantName={me.tenant.legalName} />
    </>
  );
}
