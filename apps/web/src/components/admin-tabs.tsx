import Link from "next/link";

/** Pestañas de la sección Usuarios y roles (según los permisos del usuario). */
export function UsersTabs({ active, canRoles }: { active: "users" | "roles" | "schedules"; canRoles: boolean }) {
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
    <nav aria-label="Secciones" className="mb-6 flex gap-6 border-b border-line">
      {tab("users", "/usuarios", "Usuarios")}
      {canRoles && tab("roles", "/usuarios/roles", "Roles y permisos")}
      {tab("schedules", "/usuarios/horarios", "Horarios de acceso")}
    </nav>
  );
}
