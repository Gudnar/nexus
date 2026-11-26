import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { InventoryTabs } from "@/components/inventory-tabs";
import { PageHeader } from "@/components/ui";
import { getAdjustments, getMe, getWarehouses } from "@/lib/api";
import { AdjustmentsManager } from "./adjustments-manager";

export const metadata: Metadata = { title: "Ajustes de inventario" };

export default async function AdjustmentsPage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("inventory.read")) redirect("/dashboard");
  if (!perms.has("inventory.adjust.approve")) redirect("/inventario");
  const [adjustments, warehouses] = await Promise.all([getAdjustments(), getWarehouses()]);

  return (
    <>
      <PageHeader title="Inventario" description="Carga inicial, mermas y correcciones. Cada ajuste deja movimientos en el kardex y no se puede borrar." />
      <InventoryTabs active="adjust" canAdjust />
      <AdjustmentsManager adjustments={adjustments} warehouses={warehouses.filter((w) => w.status === "ACTIVE").map((w) => ({ id: w.id, code: w.code, name: w.name }))} />
    </>
  );
}
