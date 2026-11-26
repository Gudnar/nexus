import { Activity, Boxes, Building2, Clock3, ShoppingCart, Users } from "lucide-react";
import type { Metadata } from "next";
import { DateRangeSelect } from "@/components/date-range-select";
import { Card, CardHeader, EmptyState, MetricCard, PageHeader, ProgressList, StatusBadge } from "@/components/ui";
import { getDashboard } from "@/lib/api";

export const metadata: Metadata = { title: "Resumen" };

const ACTIONS: Record<string, string> = {
  "auth.login": "Inicios de sesión",
  "tenant.provisioned": "Alta de empresa",
  "auth.password_reset": "Contraseña restablecida",
  "user.invited": "Usuario invitado",
  "user.invitation_accepted": "Invitación aceptada",
  "user.invitation_revoked": "Invitación revocada",
  "user.invitation_resent": "Invitación reenviada",
  "user.access_updated": "Acceso de usuario cambiado",
  "user.suspended": "Usuario suspendido",
  "user.reactivated": "Usuario reactivado",
  "role.created": "Rol creado",
  "role.updated": "Rol modificado",
  "role.deleted": "Rol eliminado",
  "branch.created": "Sucursal creada",
  "branch.updated": "Sucursal modificada",
  "branch.made_main": "Sucursal principal cambiada",
  "branch.deactivated": "Sucursal desactivada",
  "branch.activated": "Sucursal activada",
};
const MODULES: Record<string, string> = {
  sales: "Ventas", purchases: "Compras", inventory: "Inventario", cash: "Cajas",
  receivables: "Cuentas por cobrar", payables: "Cuentas por pagar", quotes: "Cotizaciones",
  approvals: "Aprobaciones", ecommerce: "Tienda online", channels: "Omnicanal",
};
const when = new Intl.DateTimeFormat("es-BO", { dateStyle: "short", timeStyle: "short", timeZone: "America/La_Paz" });
const num = new Intl.NumberFormat("es-BO");

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const raw = Number((await searchParams).days);
  const days = [7, 30, 90].includes(raw) ? raw : 30;
  const d = await getDashboard(days);

  const events = d.activity?.actionCounts.reduce((s, c) => s + c.count, 0);
  const noAccess = "Sin acceso";

  return (
    <>
      <PageHeader
        title="Resumen"
        description="Vista general de tu empresa"
        actions={<DateRangeSelect value={days} />}
      >
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand-hover">
          <Building2 className="size-3.5" aria-hidden /> Alcance: {d.scope.label}
          {d.scope.restricted && <span className="font-normal text-ink-2">· solo las sucursales con acceso</span>}
        </p>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={d.scope.mode === "BRANCH" ? "Sucursal" : "Sucursales"}
          value={num.format(d.scope.branchIds.length)}
          hint="En el alcance actual"
          icon={Building2}
        />
        <MetricCard
          label="Usuarios activos"
          value={d.users ? num.format(d.users.active) : noAccess}
          hint={d.users ? `${d.users.suspended} suspendidos · ${d.users.invited} invitados` : "Requiere permiso de usuarios"}
          icon={Users}
          unavailable={!d.users}
        />
        <MetricCard
          label={`Eventos (${days} días)`}
          value={events === undefined ? noAccess : num.format(events)}
          hint={d.activity ? "Acciones auditadas" : "Requiere permiso de auditoría"}
          icon={Activity}
          unavailable={!d.activity}
        />
        <MetricCard
          label="Eventos por despachar"
          value={d.system ? num.format(d.system.outbox.pending) : noAccess}
          hint={d.system ? `${d.system.outbox.failed} con error · ${d.system.outbox.dead} descartados` : "Requiere permiso de auditoría"}
          icon={Clock3}
          unavailable={!d.system}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHeader title="Resumen de ventas" />
          <EmptyState
            icon={ShoppingCart}
            title="El módulo de ventas aún no está disponible"
            description="Cuando se active, aquí verás la evolución de tus ventas por periodo."
          />
        </Card>
        <Card className="xl:col-span-4">
          <CardHeader title="Actividad por acción" />
          {d.activity ? (
            d.activity.actionCounts.length ? (
              <ProgressList items={d.activity.actionCounts.map((c) => ({ label: ACTIONS[c.action] ?? c.action, value: c.count }))} />
            ) : (
              <EmptyState icon={Activity} title="Sin actividad" description="No hay eventos en este periodo." />
            )
          ) : (
            <EmptyState icon={Activity} title="Sin acceso" description="Tu rol no incluye la lectura de auditoría." />
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHeader title="Sucursales" />
          {d.branches ? (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="h-[42px] border-y border-line text-ink-2">
                    <th className="px-5 font-medium">Código</th>
                    <th className="px-3 font-medium">Nombre</th>
                    <th className="px-3 font-medium">Estado</th>
                    <th className="px-5 text-right font-medium">Usuarios activos</th>
                  </tr>
                </thead>
                <tbody>
                  {d.branches.map((b) => (
                    <tr key={b.id} className="h-[52px] border-b border-[#ecEef2] text-body last:border-0 hover:bg-surface-muted">
                      <td className="px-5 font-medium text-ink">{b.code}</td>
                      <td className="px-3">
                        {b.name}
                        {b.isMain && <span className="ml-2 text-xs text-ink-3">Principal</span>}
                      </td>
                      <td className="px-3">
                        <StatusBadge tone={b.status === "ACTIVE" ? "success" : "neutral"}>
                          {b.status === "ACTIVE" ? "Activa" : "Inactiva"}
                        </StatusBadge>
                      </td>
                      <td className="px-5 text-right tabular-nums">{b.activeUsers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Building2} title="Sin acceso" description="Tu rol no incluye la lectura de sucursales." />
          )}
        </Card>

        <Card className="xl:col-span-4">
          <CardHeader title="Actividad reciente" />
          {d.activity ? (
            d.activity.recent.length ? (
              <ul className="space-y-4">
                {d.activity.recent.slice(0, 8).map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate text-[13px] text-ink">
                        <span className="font-medium">{e.actorName ?? "Sistema"}</span> · {ACTIONS[e.action] ?? e.action}
                      </p>
                      <p className="text-xs text-ink-3">{when.format(new Date(e.occurredAt))}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={Activity} title="Sin actividad reciente" description={d.activity.includesTenantLevelEvents ? undefined : "Los eventos de nivel empresa solo los ve quien accede a todas las sucursales."} />
            )
          ) : (
            <EmptyState icon={Activity} title="Sin acceso" description="Tu rol no incluye la lectura de auditoría." />
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Próximos módulos" />
        <div className="flex flex-wrap items-center gap-2">
          <Boxes className="size-4 text-ink-3" aria-hidden />
          {d.pendingModules.map((m) => (
            <StatusBadge key={m}>{MODULES[m] ?? m}</StatusBadge>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-3">Se mostrarán en este panel cuando estén disponibles.</p>
      </Card>
    </>
  );
}
