import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PricingTabs } from "@/components/pricing-tabs";
import { getBranchesAdmin, getMe, getPriceLists } from "@/lib/api";
import { PriceListsManager } from "./price-lists-manager";

export const metadata: Metadata = { title: "Listas de precios" };

export default async function PricesPage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("pricing.read")) redirect("/dashboard");
  const [lists, branches] = await Promise.all([getPriceLists(), perms.has("branches.read") ? getBranchesAdmin() : Promise.resolve([])]);

  return (
    <>
      <PageHeader title="Precios" description="Listas de precios con escalas por cantidad, con o sin impuestos incluidos." />
      <PricingTabs active="lists" canTaxes={perms.has("taxes.read")} />
      <PriceListsManager
        lists={lists}
        branches={branches.filter((b) => b.status === "ACTIVE").map((b) => ({ id: b.id, name: b.name }))}
        canManage={perms.has("pricing.manage")}
      />
    </>
  );
}
