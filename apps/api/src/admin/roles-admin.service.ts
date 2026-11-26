import { Injectable } from "@nestjs/common";
import type { PermissionInfo, RoleInput, RolePatch, RoleSummary } from "@erp/contracts";
import { uuidv7, writeAudit, type Tx } from "@erp/db";
import type { RequestContext } from "../common/request-context";
import {
  assertCanGrant, assertHasManager, badRequest, conflict, loadActor, notFound, rolePermissionCodes,
} from "./actor";

/** El rol Administrador no puede perder lo necesario para administrar la empresa. */
const ADMIN_PROTECTED = ["users.manage", "roles.manage"];

function slug(name: string): string {
  return (
    name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "rol"
  );
}

@Injectable()
export class RolesAdminService {
  permissions(ctx: RequestContext): Promise<PermissionInfo[]> {
    return ctx.run((tx) =>
      tx.permission.findMany({ orderBy: [{ module: "asc" }, { code: "asc" }], select: { code: true, module: true, action: true } }),
    );
  }

  list(ctx: RequestContext): Promise<RoleSummary[]> {
    return ctx.run(async (tx) => {
      const rows = await tx.role.findMany({
        orderBy: [{ isSystemTemplate: "desc" }, { name: "asc" }],
        select: {
          id: true, code: true, name: true, isSystemTemplate: true,
          permissions: { select: { permission: { select: { code: true } } } },
          _count: { select: { userRoles: true } },
        },
      });
      return rows.map((r) => ({
        id: r.id, code: r.code, name: r.name, isSystemTemplate: r.isSystemTemplate,
        permissions: r.permissions.map((p) => p.permission.code).sort(), members: r._count.userRoles,
      }));
    });
  }

  create(ctx: RequestContext, input: RoleInput): Promise<RoleSummary> {
    return ctx.run(async (tx) => {
      const actor = await loadActor(ctx, tx);
      const perms = await this.validatePermissions(tx, input.permissions);
      assertCanGrant(actor, perms);

      let code = slug(input.name);
      for (let i = 2; await tx.role.findUnique({ where: { tenantId_code: { tenantId: ctx.auth.tenantId, code } }, select: { id: true } }); i++) {
        code = `${slug(input.name).slice(0, 36)}_${i}`;
      }
      const id = uuidv7();
      await tx.role.create({ data: { id, tenantId: ctx.auth.tenantId, code, name: input.name, isSystemTemplate: false } });
      await this.setPermissions(tx, ctx.auth.tenantId, id, perms);
      await writeAudit(tx, ctx.auth.tenantId, {
        action: "role.created", entityType: "role", entityId: id, actorUserId: ctx.auth.userId, after: { name: input.name, permissions: perms.length },
      });
      return { id, code, name: input.name, isSystemTemplate: false, permissions: [...perms].sort(), members: 0 };
    });
  }

  update(ctx: RequestContext, id: string, patch: RolePatch): Promise<RoleSummary> {
    return ctx.run(async (tx) => {
      const actor = await loadActor(ctx, tx);
      const role = await tx.role.findUnique({ where: { id }, select: { id: true, code: true, name: true, isSystemTemplate: true } });
      if (!role) throw notFound("Rol");
      const current = await rolePermissionCodes(tx, id);
      // No se puede editar un rol más poderoso que uno mismo.
      assertCanGrant(actor, current);

      let next = [...current];
      if (patch.permissions) {
        next = await this.validatePermissions(tx, patch.permissions);
        assertCanGrant(actor, next);
        if (role.isSystemTemplate && role.code === "admin") {
          const lost = ADMIN_PROTECTED.filter((p) => !next.includes(p));
          if (lost.length) throw conflict("PROTECTED_ROLE", `El rol Administrador debe conservar: ${lost.join(", ")}.`);
        }
        await this.setPermissions(tx, ctx.auth.tenantId, id, next);
      }
      if (patch.name !== undefined) await tx.role.update({ where: { id }, data: { name: patch.name } });

      await assertHasManager(tx);
      await writeAudit(tx, ctx.auth.tenantId, {
        action: "role.updated", entityType: "role", entityId: id, actorUserId: ctx.auth.userId,
        before: { name: role.name, permissions: current.size }, after: { name: patch.name ?? role.name, permissions: next.length },
      });
      const members = await tx.userRole.count({ where: { roleId: id } });
      return { id, code: role.code, name: patch.name ?? role.name, isSystemTemplate: role.isSystemTemplate, permissions: [...next].sort(), members };
    });
  }

  remove(ctx: RequestContext, id: string): Promise<void> {
    return ctx.run(async (tx) => {
      const actor = await loadActor(ctx, tx);
      const role = await tx.role.findUnique({ where: { id }, select: { id: true, name: true, isSystemTemplate: true } });
      if (!role) throw notFound("Rol");
      if (role.isSystemTemplate) throw conflict("SYSTEM_ROLE", "Los roles base no se pueden eliminar; puedes editarlos.");
      assertCanGrant(actor, await rolePermissionCodes(tx, id));
      if ((await tx.userRole.count({ where: { roleId: id } })) > 0) throw conflict("ROLE_IN_USE", "Hay usuarios con este rol. Cámbiales el rol primero.");
      if ((await tx.invitation.count({ where: { roleId: id } })) > 0) throw conflict("ROLE_IN_USE", "Hay invitaciones con este rol.");
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.role.delete({ where: { id } });
      await writeAudit(tx, ctx.auth.tenantId, {
        action: "role.deleted", entityType: "role", entityId: id, actorUserId: ctx.auth.userId, before: { name: role.name },
      });
    });
  }

  private async validatePermissions(tx: Tx, codes: string[]): Promise<string[]> {
    const unique = [...new Set(codes)];
    const known = new Set((await tx.permission.findMany({ where: { code: { in: unique } }, select: { code: true } })).map((p) => p.code));
    const unknown = unique.filter((c) => !known.has(c));
    if (unknown.length) throw badRequest("UNKNOWN_PERMISSION", `Permisos desconocidos: ${unknown.join(", ")}`);
    return unique;
  }

  private async setPermissions(tx: Tx, tenantId: string, roleId: string, codes: string[]): Promise<void> {
    const rows = await tx.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
    await tx.rolePermission.deleteMany({ where: { roleId } });
    if (rows.length) await tx.rolePermission.createMany({ data: rows.map((p) => ({ tenantId, roleId, permissionId: p.id })) });
  }
}
