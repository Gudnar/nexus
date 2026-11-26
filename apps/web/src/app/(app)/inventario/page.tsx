import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { InventoryTabs } from "@/components/inventory-tabs";
import { PageHeader } from "@/components/ui";
import { getMe, getStock, getWarehouses } from "@/lib/api";
import { StockManager } from "./stock-manager";

export const metadata: Metadata = { title: "Existencias" };

type Params = { q?: string; warehouseId?: string; cursor?: string };

export default async function StockPage({ searchParams }: { searchParams: Promise<Params> }) {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("inventory.read")) redirect("/dashboard");
  const sp = await searchParams;
  const qs = new URLSearchParams(Object.entries({ q: sp.q, warehouseId: sp.warehouseId, cursor: sp.cursor, limit: "25" }).filter(([, v]) => v) as [string, string][]).toString();
  const [stock, warehouses] = await Promise.all([getStock(qs), getWarehouses()]);

  return (
    <>
      <PageHeader title="Inventario" description="Existencias por almacén, con su valor y el detalle por lote." />
      <InventoryTabs active="stock" canAdjust={perms.has("inventory.adjust.approve")} />
      <StockManager list={stock} warehouses={warehouses.map((w) => ({ id: w.id, code: w.code, name: w.name }))} filters={{ q: sp.q ?? "", warehouseId: sp.warehouseId ?? "" }} hasCursor={!!sp.cursor} />
    </>
  );
}
