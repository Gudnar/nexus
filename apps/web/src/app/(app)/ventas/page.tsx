import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getCustomers, getMe, getSalesSellers } from "@/lib/api";
import { SalesSearch } from "./sales-search";

export const metadata: Metadata = { title: "Búsqueda de ventas" };

export default async function SalesSearchPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("sales.read")) redirect("/dashboard");
  const { status } = await searchParams;
  const initialStatus = ["DRAFT", "CONFIRMED", "CANCELLED"].includes(status ?? "") ? status! : "";
  const [customers, sellers] = await Promise.all([perms.has("customers.read") ? getCustomers() : Promise.resolve([]), getSalesSellers()]);
  return (
    <>
      <PageHeader title="Búsqueda de ventas y deudores" description="Localiza fácilmente tus ventas pendientes y deudores. Consulta el historial con los filtros que necesites." />
      <SalesSearch
        customers={customers.filter((c) => c.status === "ACTIVE").map((c) => ({ id: c.id, name: c.name }))}
        branches={me.branches.map((b) => ({ id: b.id, name: b.name }))}
        sellers={sellers}
        initialStatus={initialStatus}
        can={{ create: perms.has("sales.create"), confirm: perms.has("sales.confirm"), collect: perms.has("sales.collect"), void: perms.has("sales.execute_void"), requestVoid: perms.has("sales.request_void") && perms.has("approvals.read"), discount: perms.has("sales.apply_discount"), return: perms.has("sales.return"), override: perms.has("sales.override_price") }}
      />
    </>
  );
}
