import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CatalogTabs } from "@/components/catalog-tabs";
import { PageHeader } from "@/components/ui";
import { getBrands, getCategories, getMe, getUnits } from "@/lib/api";
import { flattenCategories } from "@/lib/category-tree";
import { MastersManager } from "./masters-manager";

export const metadata: Metadata = { title: "Categorías, marcas y unidades" };

export default async function MastersPage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("catalog.read")) redirect("/dashboard");
  const [categories, brands, units] = await Promise.all([getCategories(), getBrands(), getUnits()]);

  return (
    <>
      <PageHeader title="Productos" description="Las listas con las que se clasifican y miden tus productos." />
      <CatalogTabs active="masters" />
      <MastersManager categories={flattenCategories(categories)} brands={brands} units={units} canManage={perms.has("catalog.manage")} />
    </>
  );
}
