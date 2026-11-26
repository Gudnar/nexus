import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UsersTabs } from "@/components/admin-tabs";
import { PageHeader } from "@/components/ui";
import { getMe, getPermissionCatalog, getRoles } from "@/lib/api";
import { RolesManager } from "./roles-manager";

export const metadata: Metadata = { title: "Roles y permisos" };

export default async function RolesPage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("roles.read")) redirect("/usuarios");
  const [roles, catalog] = await Promise.all([getRoles(), getPermissionCatalog()]);

  return (
    <>
      <PageHeader title="Usuarios y roles" description="Define qué puede hacer cada rol. Solo puedes otorgar permisos que tú mismo tienes." />
      <UsersTabs active="roles" canRoles />
      <RolesManager roles={roles} catalog={catalog} myPermissions={me.permissions} canManage={perms.has("roles.manage")} />
    </>
  );
}
