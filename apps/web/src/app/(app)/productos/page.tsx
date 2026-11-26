import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CatalogTabs } from "@/components/catalog-tabs";
import { PageHeader } from "@/components/ui";
import { getBrands, getCategories, getMe, getProducts, getTaxProfiles, getUnits } from "@/lib/api";
import { flattenCategories } from "@/lib/category-tree";
import { ProductsManager } from "./products-manager";

export const metadata: Metadata = { title: "Productos" };

type Params = { q?: string; categoryId?: string; brandId?: string; status?: string; kind?: string; cursor?: string };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("catalog.read")) redirect("/dashboard");

  const sp = await searchParams;
  // El filtro vive en la URL; se reenvía a la API solo lo que ella acepta.
  const qs = new URLSearchParams(
    Object.entries({ q: sp.q, categoryId: sp.categoryId, brandId: sp.brandId, status: sp.status, kind: sp.kind, cursor: sp.cursor, limit: "20" })
      .filter(([, v]) => v) as [string, string][],
  ).toString();
  const [list, categories, brands, units, taxProfiles] = await Promise.all([
    getProducts(qs), getCategories(), getBrands(), getUnits(),
    perms.has("taxes.read") ? getTaxProfiles() : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader title="Productos" description="Bienes y servicios que vendes y compras. El catálogo es común a todas las sucursales." />
      <CatalogTabs active="products" />
      <ProductsManager
        list={list}
        categories={flattenCategories(categories)}
        brands={brands}
        units={units}
        taxProfiles={taxProfiles}
        canManage={perms.has("catalog.manage")}
        filters={{ q: sp.q ?? "", categoryId: sp.categoryId ?? "", brandId: sp.brandId ?? "", status: sp.status ?? "", kind: sp.kind ?? "" }}
        hasCursor={!!sp.cursor}
      />
    </>
  );
}
