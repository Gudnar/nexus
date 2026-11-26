"use client";

import type { BranchDetail, InvitationSummary, MemberSummary, RoleSummary, ScheduleSummary } from "@erp/contracts";
import { Loader2, MailPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { BranchAccessPicker, toAccessPayload, type AccessValue } from "@/components/branch-access-picker";
import { ChangePasswordButton } from "@/components/change-password";
import { Modal } from "@/components/modal";
import { btnPrimary, btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText, type ApiResult } from "@/lib/client-api";
import { STATUS_LABELS } from "@/lib/labels";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}

interface Props {
  members: MemberSummary[];
  invitations: InvitationSummary[];
  roles: RoleSummary[];
  branches: BranchDetail[];
  schedules: ScheduleSummary[];
  myPermissions: string[];
  canManage: boolean;
  canGrantAll: boolean;
}

const dateFmt = new Intl.DateTimeFormat("es-BO", { dateStyle: "medium", timeZone: "America/La_Paz" });

export function UsersManager({ members, invitations, roles, branches, schedules, myPermissions, canManage, canGrantAll }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<"users" | "invitations">("users");
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<MemberSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Solo se ofrecen roles que quien administra puede otorgar (la API lo exige igualmente).
  const mine = new Set(myPermissions);
  const assignable = roles.filter((r) => r.permissions.every((p) => mine.has(p)));

  async function act(key: string, call: () => Promise<ApiResult>, ok?: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    const r = await call();
    setBusy(null);
    if (r.ok) {
      if (ok) setNotice(ok);
      router.refresh();
    } else setError(errorText(r));
  }

  return (
    <>
      {error && <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-4 py-2.5 text-[13px] text-danger">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-lg bg-success-soft px-4 py-2.5 text-[13px] text-success">{notice}</p>}

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Vista" className="flex gap-1 rounded-lg bg-neutral-soft p-1">
            {([["users", `Usuarios (${members.length})`], ["invitations", `Invitaciones (${invitations.length})`]] as const).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={`rounded-md px-3.5 py-1.5 text-[13px] font-medium ${tab === id ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ChangePasswordButton />
            {canManage && (
              <button className={btnPrimary} onClick={() => setInviting(true)}>
                <MailPlus className="size-4" aria-hidden /> Invitar usuario
              </button>
            )}
          </div>
        </div>

        {tab === "users" ? (
          members.length === 0 ? (
            <EmptyState icon={Users} title="Sin usuarios" />
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="h-[42px] border-y border-line text-ink-2">
                    <th className="px-5 font-medium">Usuario</th>
                    <th className="px-3 font-medium">Rol</th>
                    <th className="px-3 font-medium">Sucursales</th>
                    <th className="px-3 font-medium">Estado</th>
                    {canManage && <th className="px-5 text-right font-medium">Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.membershipId} className="h-[60px] border-b border-line-strong/40 text-body last:border-0 hover:bg-surface-muted">
                      <td className="px-5">
                        <p className="font-medium text-ink">
                          {m.name} {m.isYou && <span className="ml-1 text-xs font-normal text-ink-3">(tú)</span>}
                        </p>
                        <p className="text-xs text-ink-2">{m.email}{m.username ? ` · @${m.username}` : ""}</p>
                      </td>
                      <td className="px-3">{m.role?.name ?? <span className="text-ink-3">Sin rol</span>}</td>
                      <td className="px-3">
                        {m.allBranches ? <StatusBadge tone="info">Todas</StatusBadge> : (
                          <span className="flex flex-wrap gap-1">{m.branches.map((b) => <StatusBadge key={b.branchId}>{b.code}</StatusBadge>)}</span>
                        )}
                      </td>
                      <td className="px-3">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge tone={m.status === "ACTIVE" ? "success" : "warning"}>{STATUS_LABELS[m.status]}</StatusBadge>
                          {m.mfaEnabled && <StatusBadge tone="info">MFA</StatusBadge>}
                          {m.schedule && <StatusBadge tone="warning">Horario: {m.schedule.name}</StatusBadge>}
                        </span>
                      </td>
                      {canManage && (
                        <td className="px-5">
                          <div className="flex justify-end gap-2">
                            {m.isYou ? (
                              <span className="text-xs text-ink-3">Tu acceso lo gestiona otra persona</span>
                            ) : (
                              <>
                                <button className={`${btnSecondary} h-8 px-3`} onClick={() => setEditing(m)}>Editar acceso</button>
                                <button className={`${btnSecondary} h-8 px-3`} disabled={busy === m.membershipId}
                                  onClick={() => act(m.membershipId, () => bff(`/bff/api/admin/users/${m.membershipId}`, "PATCH", { status: m.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }),
                                    m.status === "ACTIVE" ? `${m.name} fue suspendido y sus sesiones se cerraron.` : `${m.name} fue reactivado.`)}>
                                  {busy === m.membershipId && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                                  {m.status === "ACTIVE" ? "Suspender" : "Reactivar"}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : invitations.length === 0 ? (
          <EmptyState icon={MailPlus} title="No hay invitaciones pendientes" description="Las invitaciones aceptadas pasan a la lista de usuarios." />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="h-[42px] border-y border-line text-ink-2">
                  <th className="px-5 font-medium">Correo</th>
                  <th className="px-3 font-medium">Rol</th>
                  <th className="px-3 font-medium">Sucursales</th>
                  <th className="px-3 font-medium">Vence</th>
                  {canManage && <th className="px-5 text-right font-medium">Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {invitations.map((i) => (
                  <tr key={i.id} className="h-[56px] border-b border-line-strong/40 text-body last:border-0 hover:bg-surface-muted">
                    <td className="px-5 font-medium text-ink">{i.email}</td>
                    <td className="px-3">{i.role.name}</td>
                    <td className="px-3">{i.allBranches ? <StatusBadge tone="info">Todas</StatusBadge> : i.branchCodes.join(", ")}</td>
                    <td className="px-3">
                      {i.state === "EXPIRED" ? <StatusBadge tone="danger">Vencida</StatusBadge> : dateFmt.format(new Date(i.expiresAt))}
                    </td>
                    {canManage && (
                      <td className="px-5">
                        <div className="flex justify-end gap-2">
                          <button className={`${btnSecondary} h-8 px-3`} disabled={busy === i.id}
                            onClick={() => act(i.id, () => bff(`/bff/api/admin/invitations/${i.id}/resend`, "POST"), `Reenviamos la invitación a ${i.email}.`)}>
                            Reenviar
                          </button>
                          <button className={`${btnSecondary} h-8 px-3`} disabled={busy === i.id}
                            onClick={() => act(i.id, () => bff(`/bff/api/admin/invitations/${i.id}`, "DELETE"), "Invitación revocada.")}>
                            Revocar
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={inviting} onClose={() => setInviting(false)} title="Invitar usuario" size="lg">
        {inviting && (
          <InviteForm roles={assignable} branches={branches} canGrantAll={canGrantAll}
            onDone={() => { setInviting(false); setTab("invitations"); setNotice("Invitación enviada por correo."); router.refresh(); }}
            onCancel={() => setInviting(false)} />
        )}
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing ? `Acceso de ${editing.name}` : ""} size="lg">
        {editing && (
          <EditForm member={editing} roles={assignable} branches={branches} schedules={schedules} canGrantAll={canGrantAll}
            onDone={() => { setEditing(null); router.refresh(); }} onCancel={() => setEditing(null)} />
        )}
      </Modal>
    </>
  );
}

function initialAccess(m?: MemberSummary): AccessValue {
  return {
    allBranches: m?.allBranches ?? false,
    branches: Object.fromEntries((m?.branches ?? []).map((b) => [b.branchId, b.accessLevel])),
  };
}

function InviteForm({
  roles, branches, canGrantAll, onDone, onCancel,
}: { roles: RoleSummary[]; branches: BranchDetail[]; canGrantAll: boolean; onDone: () => void; onCancel: () => void }) {
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState(roles.find((r) => !r.isSystemTemplate || r.code !== "admin")?.id ?? roles[0]?.id ?? "");
  const [access, setAccess] = useState<AccessValue>(initialAccess());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = toAccessPayload(access);
    if (!payload.allBranches && payload.branches.length === 0) return setError("Elige al menos una sucursal o acceso a todas.");
    setBusy(true);
    const r = await bff("/bff/api/admin/invitations", "POST", { email, roleId, ...payload });
    setBusy(false);
    if (r.ok) return onDone();
    setError(r.status === 400 ? "Revisa el correo y los datos." : errorText(r));
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <p className="text-ink-2">Enviaremos un enlace por correo (vigente 7 días) para que la persona cree su cuenta o confirme la que ya tiene.</p>
      <Field label="Correo electrónico">
        <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoCapitalize="none" />
      </Field>
      <Field label="Rol">
        <select className={inputCls} value={roleId} onChange={(e) => setRoleId(e.target.value)} required>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Field>
      <BranchAccessPicker branches={branches} value={access} onChange={setAccess} canGrantAll={canGrantAll} />
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy || !roleId}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Enviar invitación</button>
      </div>
    </form>
  );
}

function EditForm({
  member, roles, branches, schedules, canGrantAll, onDone, onCancel,
}: { member: MemberSummary; roles: RoleSummary[]; branches: BranchDetail[]; schedules: ScheduleSummary[]; canGrantAll: boolean; onDone: () => void; onCancel: () => void }) {
  const [roleId, setRoleId] = useState(member.role?.id ?? "");
  const [scheduleId, setScheduleId] = useState(member.schedule?.id ?? "");
  const [access, setAccess] = useState<AccessValue>(initialAccess(member));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Si su rol actual no es asignable por mí, no puedo cambiarlo (se mantiene).
  const roleOptions = member.role && !roles.some((r) => r.id === member.role!.id) ? [{ id: member.role.id, name: member.role.name } as RoleSummary, ...roles] : roles;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = toAccessPayload(access);
    if (!payload.allBranches && payload.branches.length === 0) return setError("Elige al menos una sucursal o acceso a todas.");
    setBusy(true);
    const r = await bff(`/bff/api/admin/users/${member.membershipId}`, "PATCH", {
      ...(roleId && roleId !== member.role?.id ? { roleId } : {}), ...payload,
      ...(scheduleId !== (member.schedule?.id ?? "") ? { scheduleId: scheduleId || null } : {}),
    });
    setBusy(false);
    if (r.ok) return onDone();
    setError(errorText(r));
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <p className="text-ink-2">{member.email}</p>
      <Field label="Rol">
        <select className={inputCls} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          {roleOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Field>
      <Field label="Horario de acceso">
        <select className={inputCls} value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
          <option value="">Sin restricción horaria</option>
          {schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      <BranchAccessPicker branches={branches} value={access} onChange={setAccess} canGrantAll={canGrantAll} />
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Guardar cambios</button>
      </div>
    </form>
  );
}

