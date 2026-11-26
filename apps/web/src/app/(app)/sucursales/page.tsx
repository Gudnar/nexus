import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getBranchesAdmin, getMe } from "@/lib/api";
import { BranchesManager } from "./branches-manager";

export const metadata: Metadata = { title: "Sucursales" };

export default async function BranchesPage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("branches.read")) redirect("/dashboard");
  const branches = await getBranchesAdmin();
  return (
    <>
      <PageHeader title="Sucursales" description="Las ubicaciones de tu empresa: cada una tiene sus almacenes, cajas y equipo." />
      <BranchesManager
        branches={branches}
        canManage={perms.has("branches.manage")}
        canCreate={perms.has("branches.manage") && me.allBranches}
        canChangeMain={me.allBranches}
      />
    </>
  );
}
