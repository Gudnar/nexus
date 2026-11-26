import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PricingTabs } from "@/components/pricing-tabs";
import { getCategories, getMe, getPriceLists } from "@/lib/api";
import { PriceSheet } from "./price-sheet";

export const metadata: Metadata = { title: "Hoja de precios" };

export default async function PriceSheetPage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("pricing.read")) redirect("/dashboard");
  const [lists, categories] = await Promise.all([getPriceLists(), perms.has("catalog.read") ? getCategories() : Promise.resolve([])]);
  return (
    <>
      <PageHeader title="Precios" description="Edita los precios de muchos productos a la vez, como en una hoja de cálculo, por categoría." />
      <PricingTabs active="sheet" canTaxes={perms.has("taxes.read")} />
      <PriceSheet lists={lists.filter((l) => l.status === "ACTIVE")} categories={categories} canManage={perms.has("pricing.manage")} />
    </>
  );
}
