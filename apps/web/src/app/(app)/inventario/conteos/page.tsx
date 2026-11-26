import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { InventoryTabs } from "@/components/inventory-tabs";
import { PageHeader } from "@/components/ui";
import { getCounts, getMe, getWarehouses } from "@/lib/api";
import { CountsManager } from "./counts-manager";

export const metadata: Metadata = { title: "Conteos físicos" };

export default async function CountsPage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("inventory.read")) redirect("/dashboard");
  const [counts, warehouses] = await Promise.all([getCounts(), getWarehouses()]);
  return (
    <>
      <PageHeader title="Inventario" description="Cuenta lo que hay en el almacén; quien aprueba aplica las diferencias como ajustes." />
      <InventoryTabs active="counts" canAdjust={perms.has("inventory.adjust.approve")} />
      <CountsManager
        counts={counts}
        warehouses={warehouses.filter((w) => w.status === "ACTIVE").map((w) => ({ id: w.id, code: w.code, name: w.name }))}
        canCount={perms.has("inventory.adjust.request")}
        canApprove={perms.has("inventory.adjust.approve")}
      />
    </>
  );
}
