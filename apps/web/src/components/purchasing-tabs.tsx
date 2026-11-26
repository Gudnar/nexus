import Link from "next/link";

export function PurchasingTabs({ active }: { active: "orders" | "receipts" }) {
  const tab = (id: string, href: string, label: string) => (
    <Link href={href} aria-current={active === id ? "page" : undefined}
      className={`border-b-2 px-1 pb-2.5 text-[13px] font-medium ${active === id ? "border-brand text-brand-hover" : "border-transparent text-ink-2 hover:text-ink"}`}>
      {label}
    </Link>
  );
  return (
    <nav aria-label="Secciones de compras" className="mb-6 flex gap-6 border-b border-line">
      {tab("orders", "/compras", "Órdenes de compra")}
      {tab("receipts", "/compras/recepciones", "Recepciones")}
    </nav>
  );
}
