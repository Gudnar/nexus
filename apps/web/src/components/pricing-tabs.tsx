import Link from "next/link";

export function PricingTabs({ active, canTaxes }: { active: "lists" | "sheet" | "taxes" | "quote"; canTaxes: boolean }) {
  const tab = (id: string, href: string, label: string) => (
    <Link
      href={href}
      aria-current={active === id ? "page" : undefined}
      className={`border-b-2 px-1 pb-2.5 text-[13px] font-medium ${active === id ? "border-brand text-brand-hover" : "border-transparent text-ink-2 hover:text-ink"}`}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Secciones de precios" className="mb-6 flex gap-6 border-b border-line">
      {tab("lists", "/precios", "Listas de precios")}
      {tab("sheet", "/precios/hoja", "Edición masiva")}
      {canTaxes && tab("taxes", "/precios/impuestos", "Impuestos")}
      {tab("quote", "/precios/cotizador", "Cotizador")}
    </nav>
  );
}
