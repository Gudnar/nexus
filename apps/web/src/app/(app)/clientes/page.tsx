import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getCustomers, getMe, getPriceLists } from "@/lib/api";
import { CustomersManager } from "./customers-manager";

export const metadata: Metadata = { title: "Clientes" };

export default async function CustomersPage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("customers.read")) redirect("/dashboard");
  const [customers, lists] = await Promise.all([getCustomers(), perms.has("pricing.read") ? getPriceLists() : Promise.resolve([])]);
  return (
    <>
      <PageHeader title="Clientes" description="A quién le vendes. Cada cliente puede tener su lista de precios, plazo de pago y límite de crédito." />
      <CustomersManager customers={customers} lists={lists.filter((l) => l.status === "ACTIVE").map((l) => ({ id: l.id, name: l.name, code: l.code }))} canManage={perms.has("customers.manage")} />
    </>
  );
}
