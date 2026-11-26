import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PurchasingTabs } from "@/components/purchasing-tabs";
import { PageHeader } from "@/components/ui";
import { getMe, getReceipts, getSuppliers, getWarehouses } from "@/lib/api";
import { ReceiptsManager } from "./receipts-manager";

export const metadata: Metadata = { title: "Recepciones" };

export default async function ReceiptsPage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("purchases.read")) redirect("/dashboard");
  const [receipts, suppliers, warehouses] = await Promise.all([getReceipts(), getSuppliers(), getWarehouses()]);

  return (
    <>
      <PageHeader title="Compras" description="Mercadería recibida. Una recepción anulada devuelve el stock al costo original." />
      <PurchasingTabs active="receipts" />
      <ReceiptsManager
        receipts={receipts}
        suppliers={suppliers.filter((s) => s.status === "ACTIVE").map((s) => ({ id: s.id, code: s.code, name: s.name }))}
        warehouses={warehouses.filter((w) => w.status === "ACTIVE").map((w) => ({ id: w.id, code: w.code, name: w.name }))}
        canReceive={perms.has("purchases.receive")}
      />
    </>
  );
}
