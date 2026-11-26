import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { InventoryTabs } from "@/components/inventory-tabs";
import { PageHeader } from "@/components/ui";
import { getBranchesAdmin, getMe, getValuationPolicies, getWarehouses } from "@/lib/api";
import { WarehousesManager } from "./warehouses-manager";

export const metadata: Metadata = { title: "Almacenes y valoración" };

export default async function WarehousesPage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("inventory.read")) redirect("/dashboard");
  const [warehouses, policy, branches] = await Promise.all([
    getWarehouses(), getValuationPolicies(), perms.has("branches.read") ? getBranchesAdmin() : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader title="Inventario" description="Dónde se guarda la mercadería y cómo se valora su costo." />
      <InventoryTabs active="warehouses" canAdjust={perms.has("inventory.adjust.approve")} />
      <WarehousesManager
        warehouses={warehouses}
        branches={branches.filter((b) => b.status === "ACTIVE").map((b) => ({ id: b.id, name: b.name }))}
        policy={policy}
        canManage={perms.has("inventory.manage")}
      />
    </>
  );
}
