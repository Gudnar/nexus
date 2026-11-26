import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getMe, getSuppliers } from "@/lib/api";
import { SuppliersManager } from "./suppliers-manager";

export const metadata: Metadata = { title: "Proveedores" };

export default async function SuppliersPage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("purchases.read")) redirect("/dashboard");
  const suppliers = await getSuppliers();
  return (
    <>
      <PageHeader title="Proveedores" description="A quién le compras. Se usan en las órdenes de compra y en las recepciones de mercadería." />
      <SuppliersManager suppliers={suppliers} canManage={perms.has("purchases.manage")} />
    </>
  );
}
