import type { BranchAccessLevel } from "@prisma/client";
import { assertUuid, type Tx } from "./context";

export class BranchAccessDenied extends Error {
  constructor(message = "Sin acceso a la sucursal solicitada") {
    super(message);
    this.name = "BranchAccessDenied";
  }
}

export const ALL_BRANCHES = "ALL" as const;
export type BranchRequest = string | typeof ALL_BRANCHES;

export interface BranchScope {
  /** true cuando la consulta cubre todas las sucursales a las que el usuario tiene acceso. */
  all: boolean;
  /** Sucursales efectivas (ya validadas contra el acceso del usuario). */
  branchIds: string[];
}

const LEVEL_ORDER: Record<BranchAccessLevel, number> = { VIEW: 0, OPERATE: 1, MANAGE: 2 };

/**
 * Valida la sucursal solicitada contra el acceso de la membresía (ADR-001, punto 8).
 * - `branchId` concreto: debe existir en el tenant y la membresía debe tener acceso con
 *   al menos `minLevel` (o `allBranches`).
 * - `"ALL"`: solo si `allowAll` (consultas de lectura autorizadas). Con `allBranches`
 *   devuelve todas las sucursales activas; si no, las sucursales con acceso.
 * Debe ejecutarse dentro de `withTenant`.
 */
export async function resolveBranchScope(
  tx: Tx,
  membershipId: string,
  requested: BranchRequest,
  opts: { minLevel?: BranchAccessLevel; allowAll?: boolean } = {},
): Promise<BranchScope> {
  assertUuid(membershipId, "membershipId");
  const minLevel = opts.minLevel ?? "OPERATE";

  const membership = await tx.membership.findUnique({
    where: { id: membershipId },
    select: { status: true, allBranches: true },
  });
  if (!membership || membership.status !== "ACTIVE") {
    throw new BranchAccessDenied("Membresía inexistente o inactiva");
  }

  if (requested === ALL_BRANCHES) {
    if (!opts.allowAll) throw new BranchAccessDenied("Consulta de todas las sucursales no autorizada");
    if (membership.allBranches) {
      const branches = await tx.branch.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
      return { all: true, branchIds: branches.map((b) => b.id) };
    }
    const accesses = await tx.userBranchAccess.findMany({
      where: { membershipId },
      select: { branchId: true, accessLevel: true },
    });
    const ids = accesses
      .filter((a) => LEVEL_ORDER[a.accessLevel] >= LEVEL_ORDER[minLevel])
      .map((a) => a.branchId);
    return { all: true, branchIds: ids };
  }

  assertUuid(requested, "branchId");
  const branch = await tx.branch.findUnique({ where: { id: requested }, select: { id: true, status: true } });
  if (!branch) throw new BranchAccessDenied("Sucursal inexistente");
  if (membership.allBranches) return { all: false, branchIds: [branch.id] };

  const access = await tx.userBranchAccess.findUnique({
    where: { tenantId_membershipId_branchId: { tenantId: await currentTenant(tx), membershipId, branchId: requested } },
    select: { accessLevel: true },
  });
  if (!access || LEVEL_ORDER[access.accessLevel] < LEVEL_ORDER[minLevel]) {
    throw new BranchAccessDenied();
  }
  return { all: false, branchIds: [branch.id] };
}

async function currentTenant(tx: Tx): Promise<string> {
  const rows = await tx.$queryRaw<{ t: string }[]>`SELECT current_setting('app.tenant_id', true) AS t`;
  const t = rows[0]?.t;
  assertUuid(t, "app.tenant_id");
  return t;
}
