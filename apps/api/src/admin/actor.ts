import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Tx } from "@erp/db";
import type { RequestContext } from "../common/request-context";

export const forbid = (code: string, message: string) => new ForbiddenException({ code, message });
export const conflict = (code: string, message: string) => new ConflictException({ code, message });
export const badRequest = (code: string, message: string) => new BadRequestException({ code, message });
export const notFound = (what: string) => new NotFoundException({ code: "NOT_FOUND", message: `${what} no encontrado` });

/** Quien ejecuta la acción: permisos efectivos y alcance de sucursales que puede administrar. */
export interface Actor {
  userId: string;
  membershipId: string;
  allBranches: boolean;
  permissions: Set<string>;
  /** Sucursales sobre las que tiene nivel MANAGE (todas si `allBranches`). */
  manageBranchIds: Set<string>;
}

export async function loadActor(ctx: RequestContext, tx: Tx): Promise<Actor> {
  const m = await tx.membership.findUniqueOrThrow({
    where: { id: ctx.auth.membershipId },
    select: { allBranches: true, branchAccesses: { select: { branchId: true, accessLevel: true } } },
  });
  const manage = m.allBranches
    ? (await tx.branch.findMany({ select: { id: true } })).map((b) => b.id)
    : m.branchAccesses.filter((a) => a.accessLevel === "MANAGE").map((a) => a.branchId);
  return {
    userId: ctx.auth.userId,
    membershipId: ctx.auth.membershipId,
    allBranches: m.allBranches,
    permissions: await ctx.permissions(),
    manageBranchIds: new Set(manage),
  };
}

/** Permisos de un rol. */
export async function rolePermissionCodes(tx: Tx, roleId: string): Promise<Set<string>> {
  const rows = await tx.rolePermission.findMany({ where: { roleId }, select: { permission: { select: { code: true } } } });
  return new Set(rows.map((r) => r.permission.code));
}

/** Nadie puede otorgar permisos que no posee (evita escalada de privilegios). */
export function assertCanGrant(actor: Actor, wanted: Iterable<string>): void {
  const missing = [...wanted].filter((p) => !actor.permissions.has(p));
  if (missing.length) {
    throw forbid("PRIVILEGE_ESCALATION", `No puedes otorgar permisos que no tienes: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}`);
  }
}

/** Gestores activos de usuarios: sin ellos nadie podría administrar la empresa. */
export async function assertHasManager(tx: Tx): Promise<void> {
  const managers = await tx.membership.count({
    where: {
      status: "ACTIVE",
      user: { active: true },
      roles: { some: { role: { permissions: { some: { permission: { code: "users.manage" } } } } } },
    },
  });
  if (managers < 1) {
    throw conflict("LAST_MANAGER", "La empresa debe conservar al menos un usuario activo con permiso para administrar usuarios.");
  }
}

/** Un administrador limitado a ciertas sucursales solo puede asignar/ver dentro de ellas. */
export function assertBranchesAssignable(actor: Actor, branchIds: string[]): void {
  if (actor.allBranches) return;
  const outside = branchIds.filter((b) => !actor.manageBranchIds.has(b));
  if (outside.length) throw forbid("BRANCH_FORBIDDEN", "Solo puedes asignar sucursales que administras.");
}
