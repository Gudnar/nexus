import type { SaleDetail, IntegrationView, PlatformPlanView, PlatformTenantView, DocumentTemplateView, PrinterView, ApprovalDelegationView, ApprovalRequestView, ApprovalWorkflowView, PayablesReport, ReceivablesReport, SupplierPaymentView, CashRegisterSummary, CashSessionSummary, CashSettings, SalesSettings, ReservationView, CustomerSummary, QuoteSummary, SaleSummary, CountSummary, TransferSummary, GoodsReceiptSummary, PurchaseOrderSummary, SupplierSummary, AdjustmentSummary, StockList, KardexList, ValuationPolicySummary, WarehouseSummary, PriceListSummary, TaxCodeSummary, TaxProfileSummary, ImportJobSummary, BrandSummary, CategorySummary, ProductList, UnitSummary, ScheduleSummary, BranchDetail, InvitationSummary, MemberSummary, PermissionInfo, RoleSummary, DashboardResponse, MeResponse, PlatformSettings, ProblemDetails, SecurityOverview } from "@erp/contracts";
import { BRANCH_HEADER } from "@erp/contracts";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { API_URL, AT_COOKIE, BRANCH_COOKIE, PT_COOKIE } from "./session";

export class ApiError extends Error {
  constructor(readonly status: number, readonly problem?: ProblemDetails) {
    super(problem?.detail ?? `API ${status}`);
  }
}

async function request<T>(path: string, useBranch = true): Promise<T> {
  const store = await cookies();
  const token = store.get(AT_COOKIE)?.value;
  if (!token) redirect("/bff/auth/expired");
  const branch = useBranch ? store.get(BRANCH_COOKIE)?.value : undefined;

  const call = (withBranch: boolean) =>
    fetch(`${API_URL}${path}`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${token}`, ...(withBranch && branch ? { [BRANCH_HEADER]: branch } : {}) },
    });

  let res = await call(true);
  // La sucursal guardada en la cookie ya no es válida (acceso retirado): se ignora.
  if (res.status === 403 && branch) {
    const body = (await res.clone().json().catch(() => ({}))) as ProblemDetails;
    if (body.code === "BRANCH_FORBIDDEN" || body.code === "INVALID_BRANCH") res = await call(false);
  }
  if (res.status === 401) redirect("/bff/auth/expired");
  if (res.status === 403) {
    // Fuera del horario de acceso: se cierra la sesión local y se explica en el login.
    const body = (await res.clone().json().catch(() => ({}))) as ProblemDetails;
    if (body.code === "OUTSIDE_SCHEDULE") redirect("/bff/auth/expired?reason=schedule");
  }
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => undefined)) as ProblemDetails | undefined);
  return (await res.json()) as T;
}

export const getMe = () => request<MeResponse>("/api/v1/me", false);
export const getDashboard = (days: number) => request<DashboardResponse>(`/api/v1/dashboard?days=${days}`);

export const getSecurity = () => request<SecurityOverview>("/api/v1/me/security", false);

/** Ajustes globales. null si no hay sesión de plataforma válida (el llamador redirige al acceso). */
export async function getPlatformSettings(): Promise<PlatformSettings | null> {
  const token = (await cookies()).get(PT_COOKIE)?.value;
  if (!token) return null;
  const res = await fetch(`${API_URL}/api/v1/platform/settings`, { cache: "no-store", headers: { authorization: `Bearer ${token}` } }).catch(() => null);
  return res?.ok ? ((await res.json()) as PlatformSettings) : null;
}

// Administración de la empresa (alcance completo: no depende de la sucursal elegida en la barra)
export const getBranchesAdmin = () => request<BranchDetail[]>("/api/v1/admin/branches", false);
export const getMembers = () => request<MemberSummary[]>("/api/v1/admin/users", false);
export const getInvitations = () => request<InvitationSummary[]>("/api/v1/admin/invitations", false);
export const getRoles = () => request<RoleSummary[]>("/api/v1/admin/roles", false);
export const getPermissionCatalog = () => request<PermissionInfo[]>("/api/v1/admin/permissions", false);
export const getSchedules = () => request<ScheduleSummary[]>("/api/v1/admin/schedules", false);

// Catálogo
export const getUnits = () => request<UnitSummary[]>("/api/v1/catalog/units", false);
export const getCategories = () => request<CategorySummary[]>("/api/v1/catalog/categories", false);
export const getBrands = () => request<BrandSummary[]>("/api/v1/catalog/brands", false);
// Precios, impuestos e importaciones
export const getPriceLists = () => request<PriceListSummary[]>("/api/v1/pricing/lists", false);
export const getTaxCodes = () => request<TaxCodeSummary[]>("/api/v1/taxes/codes", false);
export const getTaxProfiles = () => request<TaxProfileSummary[]>("/api/v1/taxes/profiles", false);
export const getImportJobs = () => request<ImportJobSummary[]>("/api/v1/imports", false);
// Compras
export const getSuppliers = () => request<SupplierSummary[]>("/api/v1/purchasing/suppliers", false);
export const getPurchaseOrders = (qs = "") => request<PurchaseOrderSummary[]>(`/api/v1/purchasing/orders${qs ? `?${qs}` : ""}`, false);
export const getReceipts = () => request<GoodsReceiptSummary[]>("/api/v1/purchasing/receipts", false);

// Clientes, ventas y cotizaciones
export const getCustomers = () => request<CustomerSummary[]>("/api/v1/sales/customers", false);
export const getSalesSettings = () => request<SalesSettings>("/api/v1/sales/settings", false);
export const getSalesWarehouses = () => request<WarehouseSummary[]>("/api/v1/sales/warehouses", false);
export const getSales = (qs = "") => request<SaleSummary[]>(`/api/v1/sales/orders${qs ? `?${qs}` : ""}`, false);
export const getQuotes = (qs = "") => request<QuoteSummary[]>(`/api/v1/sales/quotes${qs ? `?${qs}` : ""}`, false);

// Inventario
export const getTransfers = (qs = "") => request<TransferSummary[]>(`/api/v1/inventory/transfers${qs ? `?${qs}` : ""}`, false);
export const getReceivables = () => request<ReceivablesReport>("/api/v1/finance/receivables", false);
export const getPayables = () => request<PayablesReport>("/api/v1/finance/payables", false);
export const getSupplierPayments = () => request<SupplierPaymentView[]>("/api/v1/finance/supplier-payments", false);
export const getCashRegisters = () => request<CashRegisterSummary[]>("/api/v1/cash/registers", false);
export const getCashSessions = (qs = "") => request<CashSessionSummary[]>(`/api/v1/cash/sessions${qs ? `?${qs}` : ""}`, false);
export const getMyCashSessions = () => request<CashSessionSummary[]>("/api/v1/cash/sessions/mine", false);
export const getCashSettings = () => request<CashSettings>("/api/v1/cash/settings", false);
export const getCashReport = () => request<{ total: { method: string; income: string; outflow: string; net: string }[] }>("/api/v1/cash/report", false);
export const getReservations = () => request<ReservationView[]>("/api/v1/inventory/reservations", false);
export const getCounts = () => request<CountSummary[]>("/api/v1/inventory/counts", false);
export const getWarehouses = () => request<WarehouseSummary[]>("/api/v1/inventory/warehouses", false);
export const getStock = (qs: string) => request<StockList>(`/api/v1/inventory/stock${qs ? `?${qs}` : ""}`, false);
export const getKardex = (qs: string) => request<KardexList>(`/api/v1/inventory/kardex?${qs}`, false);
export const getAdjustments = () => request<AdjustmentSummary[]>("/api/v1/inventory/adjustments", false);
export const getValuationPolicies = () => request<{ current: "FIFO" | "LIFO" | "AVERAGE"; policies: ValuationPolicySummary[] }>("/api/v1/inventory/valuation/policy", false);
export const getProduct = (id: string) => request<{ id: string; code: string; name: string; baseUnit: { code: string } }>(`/api/v1/catalog/products/${id}`, false);
export const getProducts = (qs: string) => request<ProductList>(`/api/v1/catalog/products${qs ? `?${qs}` : ""}`, false);

export const getApprovals = (scope: "mine" | "inbox" | "all") => request<ApprovalRequestView[]>(`/api/v1/approvals/requests?scope=${scope}`, false);
export const getApprovalWorkflows = () => request<ApprovalWorkflowView[]>("/api/v1/approvals/workflows", false);
export const getApprovalDelegations = () => request<ApprovalDelegationView[]>("/api/v1/approvals/delegations", false);
export const getDelegateCandidates = () => request<{ id: string; name: string }[]>("/api/v1/approvals/delegate-candidates", false);
export const getDocTemplates = () => request<DocumentTemplateView[]>("/api/v1/documents/templates", false);
export const getPrinters = () => request<PrinterView[]>("/api/v1/documents/printers", false);

/** Empresas y planes para la consola de plataforma (sesión propia). null si no hay sesión válida. */
async function platformGet<T>(path: string): Promise<T | null> {
  const token = (await cookies()).get(PT_COOKIE)?.value;
  if (!token) return null;
  const res = await fetch(`${API_URL}/api/v1/platform/${path}`, { cache: "no-store", headers: { authorization: `Bearer ${token}` } }).catch(() => null);
  return res?.ok ? ((await res.json()) as T) : null;
}
export const getPlatformTenants = () => platformGet<PlatformTenantView[]>("tenants");
export const getPlatformPlans = () => platformGet<PlatformPlanView[]>("plans");

export const getIntegrations = () => request<IntegrationView[]>("/api/v1/integrations", false);
export const getSalesSellers = () => request<{ id: string; name: string }[]>("/api/v1/sales/sellers", false);
export const getSale = (id: string) => request<SaleDetail>(`/api/v1/sales/orders/${id}`, false);
