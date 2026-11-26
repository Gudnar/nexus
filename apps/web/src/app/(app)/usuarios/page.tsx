import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UsersTabs } from "@/components/admin-tabs";
import { PageHeader } from "@/components/ui";
import { getBranchesAdmin, getInvitations, getMe, getMembers, getRoles, getSchedules } from "@/lib/api";
import { UsersManager } from "./users-manager";

export const metadata: Metadata = { title: "Usuarios" };

export default async function UsersPage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("users.read")) redirect("/dashboard");
  const canRoles = perms.has("roles.read");
  const [members, invitations, roles, branches, schedules] = await Promise.all([
    getMembers(),
    getInvitations(),
    // Para elegir rol hace falta leerlos; sin roles.read el selector queda vacío (la API lo valida igual).
    canRoles ? getRoles() : Promise.resolve([]),
    perms.has("branches.read") ? getBranchesAdmin() : Promise.resolve([]),
    getSchedules(),
  ]);

  return (
    <>
      <PageHeader title="Usuarios y roles" description="Quién tiene acceso a tu empresa, con qué rol y en qué sucursales." />
      <UsersTabs active="users" canRoles={canRoles} />
      <UsersManager
        members={members}
        invitations={invitations}
        roles={roles}
        branches={branches}
        schedules={schedules}
        myPermissions={me.permissions}
        canManage={perms.has("users.manage")}
        canGrantAll={me.allBranches}
      />
    </>
  );
}
