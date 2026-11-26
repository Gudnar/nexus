/**
 * Catálogo inicial de permisos (planificación v2.1 §5.3) y plantillas de rol.
 * Los roles son plantillas EDITABLES por tenant: no se codifica `isAdmin`/`isCashier`.
 * Convención: `modulo.accion` o `modulo.recurso.accion`.
 */
export const PERMISSION_CODES = [
  // Administración del tenant
  "tenant.settings.read",
  "tenant.settings.update",
  "branches.read",
  "branches.manage",
  "users.read",
  "users.manage",
  "roles.read",
  "roles.manage",
  "audit.read",
  // Catálogo
  "catalog.read",
  "catalog.manage",
  // Precios e impuestos
  "pricing.read",
  "pricing.manage",
  "taxes.read",
  "taxes.manage",
  // Ventas
  "sales.read",
  "sales.create",
  "sales.update_draft",
  "sales.confirm",
  "sales.request_void",
  "sales.approve_void",
  "sales.execute_void",
  "sales.apply_discount",
  "sales.override_price",
  // Aprobaciones
  "approvals.read",
  "approvals.decide",
  "approvals.manage",
  // Integraciones con servicios externos
  "integrations.manage",
  // Documentos e impresión
  "documents.manage",
  // Caja
  "cash.open_session",
  "cash.close_session",
  "cash.approve_difference",
  "cash.reopen_session",
  "cash.read",
  "cash.manage",
  // Inventario
  "inventory.read",
  "inventory.manage",
  "inventory.adjust.request",
  "inventory.adjust.approve",
  "inventory.transfer",
  "inventory.reserve",
  // Clientes y cobros
  "customers.read",
  "customers.manage",
  "sales.collect",
  /** Cobrar las ventas que otro dejó guardadas (módulo «Ventas pendientes de cobro»). Con el cobro en caja activado, solo quien lo tiene confirma ventas. */
  "sales.collect_pending",
  "sales.return",
  // Compras
  "purchases.read",
  "purchases.manage",
  "purchases.receive",
  "purchases.pay",
  // Reportes
  "reports.financial.read",
  "reports.export",
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

export function parsePermission(code: string): { module: string; resource: string | null; action: string } {
  const parts = code.split(".");
  const module = parts[0]!;
  const action = parts[parts.length - 1]!;
  const resource = parts.length > 2 ? parts.slice(1, -1).join(".") : null;
  return { module, resource, action };
}

export interface RoleTemplate {
  code: string;
  name: string;
  /** "*" = todos los permisos del catálogo. */
  permissions: readonly (PermissionCode | "*")[];
}

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  { code: "admin", name: "Administrador", permissions: ["*"] },
  {
    code: "manager",
    name: "Gerente",
    permissions: [
      "tenant.settings.read", "branches.read", "users.read", "roles.read", "audit.read",
      "catalog.read", "catalog.manage", "pricing.read", "pricing.manage", "taxes.read", "taxes.manage",
      "customers.read", "customers.manage", "sales.collect", "sales.collect_pending", "sales.return", "sales.override_price", "sales.read", "sales.create", "sales.update_draft", "sales.confirm", "sales.execute_void", "sales.approve_void", "sales.apply_discount",
      "approvals.read", "approvals.decide", "cash.read", "cash.manage", "cash.open_session", "cash.close_session", "cash.reopen_session", "cash.approve_difference", "inventory.read", "inventory.manage", "inventory.adjust.request", "inventory.adjust.approve", "inventory.transfer", "inventory.reserve", "purchases.read", "purchases.manage", "purchases.receive", "purchases.pay",
      "reports.financial.read", "reports.export",
    ],
  },
  {
    code: "seller",
    name: "Vendedor",
    permissions: ["catalog.read", "pricing.read", "taxes.read", "customers.read", "customers.manage", "sales.read", "sales.create", "sales.update_draft", "sales.confirm", "sales.request_void", "sales.collect", "inventory.read", "inventory.reserve", "approvals.read"],
  },
  {
    code: "cashier",
    name: "Cajero",
    permissions: ["catalog.read", "pricing.read", "taxes.read", "customers.read", "sales.read", "sales.create", "sales.confirm", "sales.collect", "sales.collect_pending", "cash.read", "cash.open_session", "cash.close_session", "approvals.read", "customers.manage"],
  },
  {
    code: "auditor",
    name: "Auditor",
    permissions: ["audit.read", "catalog.read", "pricing.read", "taxes.read", "customers.read", "sales.read", "inventory.read", "purchases.read", "reports.financial.read"],
  },
];

/** Unidades de medida que recibe toda empresa nueva (editables después). */
export const DEFAULT_UNITS: readonly { code: string; name: string; decimals: number }[] = [
  { code: "UND", name: "Unidad", decimals: 0 },
  { code: "CJ", name: "Caja", decimals: 0 },
  { code: "PQT", name: "Paquete", decimals: 0 },
  { code: "KG", name: "Kilogramo", decimals: 3 },
  { code: "LT", name: "Litro", decimals: 3 },
  { code: "M", name: "Metro", decimals: 2 },
];
