import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { InventoryTabs } from "@/components/inventory-tabs";
import { PageHeader } from "@/components/ui";
import { getMe, getReservations, getWarehouses } from "@/lib/api";
import { ReservationsManager } from "./reservations-manager";

export const metadata: Metadata = { title: "Reservas de stock" };

export default async function ReservationsPage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("inventory.read")) redirect("/dashboard");
  const [reservations, warehouses] = await Promise.all([getReservations(), getWarehouses()]);
  return (
    <>
      <PageHeader title="Inventario" description="Stock apartado para un cliente o una cotización. Baja lo disponible sin sacarlo del almacén y se libera solo al vencer." />
      <InventoryTabs active="reservations" canAdjust={perms.has("inventory.adjust.approve")} />
      <ReservationsManager reservations={reservations} warehouses={warehouses.filter((w) => w.status === "ACTIVE").map((w) => ({ id: w.id, code: w.code, name: w.name }))} canReserve={perms.has("inventory.reserve")} />
    </>
  );
}
