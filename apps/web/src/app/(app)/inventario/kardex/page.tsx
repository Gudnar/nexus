import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { InventoryTabs } from "@/components/inventory-tabs";
import { PageHeader } from "@/components/ui";
import { getKardex, getMe, getProduct, getWarehouses } from "@/lib/api";
import { KardexView } from "./kardex-view";

export const metadata: Metadata = { title: "Kardex" };

type Params = { productId?: string; warehouseId?: string; from?: string; to?: string; cursor?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function KardexPage({ searchParams }: { searchParams: Promise<Params> }) {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("inventory.read")) redirect("/dashboard");
  const sp = await searchParams;
  const productId = sp.productId && UUID.test(sp.productId) ? sp.productId : undefined;
  const qs = productId
    ? new URLSearchParams(Object.entries({ productId, warehouseId: sp.warehouseId && UUID.test(sp.warehouseId) ? sp.warehouseId : undefined, from: sp.from, to: sp.to, cursor: sp.cursor, limit: "30" }).filter(([, v]) => v) as [string, string][]).toString()
    : null;
  const [kardex, product, warehouses] = await Promise.all([
    qs ? getKardex(qs) : Promise.resolve(null),
    productId ? getProduct(productId).catch(() => null) : Promise.resolve(null),
    getWarehouses(),
  ]);

  return (
    <>
      <PageHeader title="Inventario" description="Historial de movimientos de un producto, con el saldo después de cada uno." />
      <InventoryTabs active="kardex" canAdjust={perms.has("inventory.adjust.approve")} />
      <KardexView
        kardex={kardex}
        product={product ? { id: product.id, code: product.code, name: product.name, unit: product.baseUnit.code } : null}
        warehouses={warehouses.map((w) => ({ id: w.id, code: w.code, name: w.name }))}
        filters={{ warehouseId: sp.warehouseId ?? "", from: sp.from ?? "", to: sp.to ?? "" }}
        canReverse={perms.has("inventory.adjust.approve")}
        hasCursor={!!sp.cursor}
      />
    </>
  );
}
