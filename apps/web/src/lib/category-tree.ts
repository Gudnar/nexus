import type { CategorySummary } from "@erp/contracts";

export interface FlatCategory extends CategorySummary {
  depth: number;
  /** «Bebidas › Gaseosas» */
  path: string;
}

/** Ordena las categorías como árbol (padres antes que hijas) y calcula profundidad y ruta legible. */
export function flattenCategories(list: CategorySummary[]): FlatCategory[] {
  const kids = new Map<string | null, CategorySummary[]>();
  for (const c of list) kids.set(c.parentId, [...(kids.get(c.parentId) ?? []), c]);
  const out: FlatCategory[] = [];
  const walk = (parent: string | null, depth: number, path: string[]) => {
    for (const c of (kids.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name, "es"))) {
      const p = [...path, c.name];
      out.push({ ...c, depth, path: p.join(" › ") });
      walk(c.id, depth + 1, p);
    }
  };
  walk(null, 0, []);
  return out;
}
