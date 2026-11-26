import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getCustomers, getMe, getQuotes, getSalesWarehouses } from "@/lib/api";
import { QuotesManager } from "./quotes-manager";

export const metadata: Metadata = { title: "Cotizaciones" };

export default async function QuotesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("sales.read")) redirect("/dashboard");
  const { status } = await searchParams;
  const valid = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "CANCELLED"].includes(status ?? "") ? status : undefined;
  const [quotes, customers, warehouses] = await Promise.all([
    getQuotes(valid ? `status=${valid}` : ""),
    perms.has("customers.read") ? getCustomers() : Promise.resolve([]),
    perms.has("sales.create") ? getSalesWarehouses() : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader title="Cotizaciones" description="Ofrece precios con vigencia. Al aceptarla, la cotización se convierte en una venta conservando el precio acordado." />
      <QuotesManager
        quotes={quotes}
        customers={customers.filter((c) => c.status === "ACTIVE").map((c) => ({ id: c.id, name: c.name, code: c.code }))}
        branches={me.branches.filter((b) => b.status === "ACTIVE").map((b) => ({ id: b.id, name: b.name }))}
        warehouses={warehouses.filter((w) => w.status === "ACTIVE").map((w) => ({ id: w.id, name: w.name, code: w.code, branchId: w.branch.id }))}
        status={valid ?? ""}
        canCreate={perms.has("sales.create")}
        canDiscount={perms.has("sales.apply_discount")}
      />
    </>
  );
}
