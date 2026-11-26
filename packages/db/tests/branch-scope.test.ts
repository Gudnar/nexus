import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { BranchAccessDenied, resolveBranchScope, withTenant } from "../src";
import { app, closeAll, owner, seedWorld, type World } from "./helpers";

let w: World;
before(async () => {
  w = await seedWorld();
});
after(closeAll);

const scope = (
  membershipId: string,
  requested: string,
  opts?: Parameters<typeof resolveBranchScope>[3],
) => withTenant(app, w.tenantA, (tx) => resolveBranchScope(tx, membershipId, requested, opts));

describe("alcance por sucursal (hito §30, puntos 6 y 8)", () => {
  it("administrador general: cualquier sucursal y 'ALL' con todas las activas", async () => {
    assert.deepEqual((await scope(w.memberships.adminA, w.a.branch3)).branchIds, [w.a.branch3]);
    const all = await scope(w.memberships.adminA, "ALL", { allowAll: true });
    assert.equal(all.all, true);
    assert.deepEqual(new Set(all.branchIds), new Set([w.a.branch1, w.a.branch2, w.a.branch3]));
  });

  it("multi-sucursal: opera en A1 y A2, no en A3", async () => {
    await scope(w.memberships.multi, w.a.branch1);
    await scope(w.memberships.multi, w.a.branch2);
    await assert.rejects(scope(w.memberships.multi, w.a.branch3), BranchAccessDenied);
    const all = await scope(w.memberships.multi, "ALL", { allowAll: true });
    assert.deepEqual(new Set(all.branchIds), new Set([w.a.branch1, w.a.branch2]));
  });

  it("usuario de sucursal única no puede operar en otra", async () => {
    await scope(w.memberships.single, w.a.branch1);
    await assert.rejects(scope(w.memberships.single, w.a.branch2), BranchAccessDenied);
    await assert.rejects(scope(w.memberships.single, w.a.branch3), BranchAccessDenied);
  });

  it("'ALL' exige autorización explícita aunque haya acceso", async () => {
    await assert.rejects(scope(w.memberships.adminA, "ALL"), BranchAccessDenied);
    await assert.rejects(scope(w.memberships.single, "ALL"), BranchAccessDenied);
    const ok = await scope(w.memberships.single, "ALL", { allowAll: true });
    assert.deepEqual(ok.branchIds, [w.a.branch1]);
  });

  it("respeta el nivel mínimo de acceso", async () => {
    await assert.rejects(scope(w.memberships.single, w.a.branch1, { minLevel: "MANAGE" }), BranchAccessDenied);
    await withTenant(owner, w.tenantA, (tx) =>
      tx.userBranchAccess.update({
        where: { tenantId_membershipId_branchId: { tenantId: w.tenantA, membershipId: w.memberships.single, branchId: w.a.branch1 } },
        data: { accessLevel: "MANAGE" },
      }),
    );
    await scope(w.memberships.single, w.a.branch1, { minLevel: "MANAGE" });
  });

  it("una sucursal de otro tenant no existe para el usuario (ni siquiera el administrador)", async () => {
    await assert.rejects(scope(w.memberships.adminA, w.b.branch1), BranchAccessDenied);
  });

  it("una membresía suspendida no tiene acceso", async () => {
    await withTenant(owner, w.tenantA, (tx) =>
      tx.membership.update({ where: { id: w.memberships.multi }, data: { status: "SUSPENDED" } }),
    );
    await assert.rejects(scope(w.memberships.multi, w.a.branch1), BranchAccessDenied);
  });
});
