import { writeAudit } from "./audit";
import { type Db, withTenant } from "./context";
import { enqueueEvent } from "./outbox";
import { DEFAULT_UNITS, PERMISSION_CODES, parsePermission, ROLE_TEMPLATES } from "./permissions-catalog";
import { uuidv7 } from "./uuid7";

/**
 * Operaciones de PLATAFORMA. Requieren el cliente con rol propietario/plataforma
 * (`DIRECT_URL`), nunca el rol de aplicación: escriben en tablas globales (permission,
 * tenant, app_user). Las filas tenant-scoped se crean igualmente bajo `withTenant`,
 * porque con FORCE RLS el propietario también queda sujeto a las políticas.
 */

/** Idempotente: sincroniza el catálogo global de permisos. */
export async function syncPermissionCatalog(owner: Db): Promise<void> {
  for (const code of PERMISSION_CODES) {
    const p = parsePermission(code);
    await owner.permission.upsert({
      where: { code },
      update: { module: p.module, resource: p.resource, action: p.action },
      create: { id: uuidv7(), code, module: p.module, resource: p.resource, action: p.action },
    });
  }
}

export interface ProvisionTenantInput {
  slug: string;
  legalName: string;
  taxId?: string;
  mainBranch: { code: string; name: string };
  admin: { email: string; name: string; passwordHash: string; username?: string; emailVerified?: boolean };
  /** Por defecto ACTIVE; el registro autoservicio usa TRIAL. */
  status?: "TRIAL" | "ACTIVE";
  planCode?: string;
}

export interface ProvisionedTenant {
  tenantId: string;
  branchId: string;
  userId: string;
  membershipId: string;
  roleIds: Record<string, string>;
}

/**
 * Alta de un tenant: tenant, sucursal principal, roles plantilla con sus permisos,
 * administrador general (todas las sucursales), secuencia base, auditoría y evento.
 */
export async function provisionTenant(owner: Db, input: ProvisionTenantInput): Promise<ProvisionedTenant> {
  await syncPermissionCatalog(owner);
  const permissions = await owner.permission.findMany({ select: { id: true, code: true } });
  const permId = new Map(permissions.map((p) => [p.code, p.id]));

  const tenantId = uuidv7();
  const plan = input.planCode ? await owner.plan.findUnique({ where: { code: input.planCode }, select: { id: true } }) : null;
  await owner.tenant.create({
    data: {
      id: tenantId, slug: input.slug, legalName: input.legalName, taxId: input.taxId ?? null,
      status: input.status ?? "ACTIVE", planId: plan?.id ?? null,
    },
  });

  const user = await owner.user.upsert({
    where: { email: input.admin.email },
    update: {},
    create: {
      id: uuidv7(), email: input.admin.email, name: input.admin.name, passwordHash: input.admin.passwordHash,
      username: input.admin.username ?? null, emailVerifiedAt: input.admin.emailVerified ? new Date() : null,
    },
    select: { id: true },
  });

  return withTenant(owner, tenantId, async (tx) => {
    const branchId = uuidv7();
    await tx.branch.create({
      data: { id: branchId, tenantId, code: input.mainBranch.code, name: input.mainBranch.name, isMain: true },
    });

    const roleIds: Record<string, string> = {};
    for (const tpl of ROLE_TEMPLATES) {
      const roleId = uuidv7();
      roleIds[tpl.code] = roleId;
      await tx.role.create({ data: { id: roleId, tenantId, code: tpl.code, name: tpl.name, isSystemTemplate: true } });
      const codes = tpl.permissions.includes("*") ? [...PERMISSION_CODES] : tpl.permissions;
      await tx.rolePermission.createMany({
        data: codes.map((c) => ({ tenantId, roleId, permissionId: permId.get(c)! })),
      });
    }

    const membershipId = uuidv7();
    await tx.membership.create({
      data: { id: membershipId, tenantId, userId: user.id, allBranches: true, defaultBranchId: branchId },
    });
    await tx.userRole.create({ data: { tenantId, membershipId, roleId: roleIds["admin"]! } });

    await tx.unitOfMeasure.createMany({
      data: DEFAULT_UNITS.map((u) => ({ id: uuidv7(), tenantId, ...u })),
    });

    await tx.sequence.create({
      data: { id: uuidv7(), tenantId, branchId: null, documentType: "SALE", prefix: "V-", padding: 6 },
    });

    await writeAudit(tx, tenantId, {
      action: "tenant.provisioned",
      entityType: "tenant",
      entityId: tenantId,
      actorUserId: user.id,
      after: { slug: input.slug, mainBranchId: branchId },
    });
    await enqueueEvent(tx, tenantId, {
      eventType: "TenantProvisioned",
      aggregateType: "tenant",
      aggregateId: tenantId,
      payload: { slug: input.slug },
      idempotencyKey: `tenant-provisioned:${tenantId}`,
    });

    return { tenantId, branchId, userId: user.id, membershipId, roleIds };
  });
}

export interface AddMemberInput {
  tenantId: string;
  email: string;
  name: string;
  passwordHash: string;
  roleCode: string;
  /** "ALL" = administrador de todas las sucursales; si no, lista de sucursales. */
  branches: "ALL" | { branchId: string; accessLevel?: "VIEW" | "OPERATE" | "MANAGE" }[];
}

/** Alta de un usuario en un tenant ya existente. */
export async function addMember(owner: Db, input: AddMemberInput): Promise<{ userId: string; membershipId: string }> {
  const user = await owner.user.upsert({
    where: { email: input.email },
    update: {},
    create: { id: uuidv7(), email: input.email, name: input.name, passwordHash: input.passwordHash },
    select: { id: true },
  });
  return withTenant(owner, input.tenantId, async (tx) => {
    const role = await tx.role.findUniqueOrThrow({
      where: { tenantId_code: { tenantId: input.tenantId, code: input.roleCode } },
      select: { id: true },
    });
    const membershipId = uuidv7();
    await tx.membership.create({
      data: { id: membershipId, tenantId: input.tenantId, userId: user.id, allBranches: input.branches === "ALL" },
    });
    await tx.userRole.create({ data: { tenantId: input.tenantId, membershipId, roleId: role.id } });
    if (input.branches !== "ALL") {
      await tx.userBranchAccess.createMany({
        data: input.branches.map((b) => ({
          tenantId: input.tenantId,
          membershipId,
          branchId: b.branchId,
          accessLevel: b.accessLevel ?? "OPERATE",
        })),
      });
    }
    return { userId: user.id, membershipId };
  });
}

/**
 * Pone al día empresas ya existentes tras una versión nueva (idempotente y solo aditivo):
 *  - sincroniza el catálogo global de permisos;
 *  - el rol Administrador recibe TODOS los permisos (los demás roles no se tocan: quien administra
 *    la empresa decide qué roles reciben los permisos nuevos);
 *  - crea las unidades de medida por defecto si la empresa no tiene ninguna.
 */
export async function syncTenantDefaults(owner: Db): Promise<{ tenants: number; adminGrants: number; unitsCreated: number }> {
  await syncPermissionCatalog(owner);
  const permissions = await owner.permission.findMany({ select: { id: true } });
  const tenants = await owner.tenant.findMany({ select: { id: true } });
  let adminGrants = 0;
  let unitsCreated = 0;
  for (const t of tenants) {
    await withTenant(owner, t.id, async (tx) => {
      const admin = await tx.role.findUnique({ where: { tenantId_code: { tenantId: t.id, code: "admin" } }, select: { id: true } });
      if (admin) {
        const res = await tx.rolePermission.createMany({
          data: permissions.map((p) => ({ tenantId: t.id, roleId: admin.id, permissionId: p.id })),
          skipDuplicates: true,
        });
        adminGrants += res.count;
      }
      if ((await tx.unitOfMeasure.count()) === 0) {
        await tx.unitOfMeasure.createMany({ data: DEFAULT_UNITS.map((u) => ({ id: uuidv7(), tenantId: t.id, ...u })) });
        unitsCreated += DEFAULT_UNITS.length;
      }
    });
  }
  return { tenants: tenants.length, adminGrants, unitsCreated };
}
