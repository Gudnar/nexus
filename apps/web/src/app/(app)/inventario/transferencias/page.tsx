import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { InventoryTabs } from "@/components/inventory-tabs";
import { PageHeader } from "@/components/ui";
import { getMe, getTransfers, getWarehouses } from "@/lib/api";
import { TransfersManager } from "./transfers-manager";

export const metadata: Metadata = { title: "Transferencias" };

export default async function TransfersPage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("inventory.read")) redirect("/dashboard");
  const [transfers, warehouses] = await Promise.all([getTransfers(), getWarehouses()]);
  return (
    <>
      <PageHeader title="Inventario" description="Mueve mercadería entre almacenes. Mientras viaja queda «en tránsito» y conserva su lote y su costo." />
      <InventoryTabs active="transfers" canAdjust={perms.has("inventory.adjust.approve")} />
      <TransfersManager transfers={transfers} warehouses={warehouses.filter((w) => w.status === "ACTIVE").map((w) => ({ id: w.id, code: w.code, name: w.name }))} canTransfer={perms.has("inventory.transfer")} />
    </>
  );
}
