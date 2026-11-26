import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PurchasingTabs } from "@/components/purchasing-tabs";
import { PageHeader } from "@/components/ui";
import { getMe, getPurchaseOrders, getSuppliers, getWarehouses } from "@/lib/api";
import { OrdersManager } from "./orders-manager";

export const metadata: Metadata = { title: "Órdenes de compra" };

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("purchases.read")) redirect("/dashboard");
  const { status } = await searchParams;
  const valid = ["DRAFT", "ISSUED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"].includes(status ?? "") ? status : undefined;
  const [orders, suppliers, warehouses] = await Promise.all([getPurchaseOrders(valid ? `status=${valid}` : ""), getSuppliers(), getWarehouses()]);

  return (
    <>
      <PageHeader title="Compras" description="Pide mercadería a tus proveedores y recíbela total o parcialmente; cada recepción crea el lote con su costo." />
      <PurchasingTabs active="orders" />
      <OrdersManager
        orders={orders}
        suppliers={suppliers.filter((s) => s.status === "ACTIVE").map((s) => ({ id: s.id, code: s.code, name: s.name }))}
        warehouses={warehouses.filter((w) => w.status === "ACTIVE").map((w) => ({ id: w.id, code: w.code, name: w.name }))}
        status={valid ?? ""}
        canManage={perms.has("purchases.manage")}
        canReceive={perms.has("purchases.receive")}
      />
    </>
  );
}
