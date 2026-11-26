import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { AcceptInvitationRequest, InvitationInfo } from "@erp/contracts";
import { assertUuid, uuidv7, withTenant, writeAudit } from "@erp/db";
import { AuthService, type ClientMeta } from "../auth/auth.service";
import { PasswordService } from "../auth/password.service";
import { DB, type Db } from "../db";
import { sha256 } from "../security/crypto";
import { assertPasswordPolicy } from "../security/password-policy";
import { RateLimiter } from "../security/rate-limiter";
import { badRequest, conflict } from "./actor";

const invalid = () => badRequest("INVALID_TOKEN", "La invitación no es válida o ya venció.");

/** Aceptación pública de invitaciones. El token lleva el tenant para fijar el contexto RLS. */
@Injectable()
export class InvitationAcceptService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  private parse(token: string): { tenantId: string; hash: string } {
    const [tenantId, secret, ...rest] = token.split(".");
    if (!tenantId || !secret || rest.length) throw invalid();
    try {
      assertUuid(tenantId, "tenant");
    } catch {
      throw invalid();
    }
    return { tenantId, hash: sha256(secret) };
  }

  async info(token: string, meta: ClientMeta): Promise<InvitationInfo> {
    this.limiter.consume(`invite-info:ip:${meta.ip ?? "?"}`, 30, 15 * 60_000);
    const { tenantId, hash } = this.parse(token);
    const inv = await withTenant(this.db, tenantId, (tx) =>
      tx.invitation.findFirst({
        where: { tokenHash: hash, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { email: true, expiresAt: true, role: { select: { name: true } } },
      }),
    );
    if (!inv) throw invalid();
    const [tenant, user] = await Promise.all([
      this.db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { legalName: true } }),
      this.db.user.findUnique({ where: { email: inv.email }, select: { id: true } }),
    ]);
    return { tenantName: tenant.legalName, email: inv.email, roleName: inv.role.name, accountExists: !!user, expiresAt: inv.expiresAt.toISOString() };
  }

  /** Cuenta nueva: se crea con los datos dados. Cuenta existente: se confirma con su contraseña. */
  async accept(input: AcceptInvitationRequest, meta: ClientMeta): Promise<{ tenant: string; email: string }> {
    this.limiter.consume(`invite-accept:ip:${meta.ip ?? "?"}`, 10, 15 * 60_000);
    const { tenantId, hash } = this.parse(input.token);

    const preview = await withTenant(this.db, tenantId, (tx) =>
      tx.invitation.findFirst({
        where: { tokenHash: hash, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { email: true },
      }),
    );
    if (!preview) throw invalid();
    const existing = await this.db.user.findUnique({ where: { email: preview.email } });

    let passwordHash: string | undefined;
    if (existing) {
      this.limiter.consume(`invite-pw:${existing.id}`, 5, 5 * 60_000);
      if (!existing.active || (existing.lockedUntil && existing.lockedUntil > new Date())) throw new UnauthorizedException({ code: "INVALID_CREDENTIALS", message: "Credenciales inválidas" });
      if (!(await this.passwords.verify(existing.passwordHash, input.password))) {
        await this.auth.registerFailure(existing.id);
        throw new UnauthorizedException({ code: "INVALID_CREDENTIALS", message: "Contraseña incorrecta" });
      }
    } else {
      if (!input.name) throw badRequest("NAME_REQUIRED", "Indica tu nombre.");
      assertPasswordPolicy(input.password, { email: preview.email, username: input.username });
      if (input.username && (await this.db.user.findUnique({ where: { username: input.username }, select: { id: true } }))) {
        throw conflict("USERNAME_TAKEN", "Ese usuario ya está en uso.");
      }
      passwordHash = await this.passwords.hash(input.password);
    }

    const tenantSlug = (await this.db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true } })).slug;

    await withTenant(this.db, tenantId, async (tx) => {
      // Consumo atómico: una invitación sirve una sola vez.
      const inv = await tx.invitation.findFirst({
        where: { tokenHash: hash, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        include: { branches: true },
      });
      if (!inv) throw invalid();
      const claimed = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
      if (claimed.count !== 1) throw invalid();

      const userId = existing?.id ?? uuidv7();
      if (!existing) {
        await tx.user.create({
          data: {
            id: userId, email: inv.email, name: input.name!, username: input.username ?? null,
            passwordHash: passwordHash!, emailVerifiedAt: new Date(), // el correo ya se probó al recibir la invitación
          },
        });
      }
      if (await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } }, select: { id: true } })) {
        throw conflict("ALREADY_MEMBER", "Ya perteneces a esta empresa.");
      }
      const membershipId = uuidv7();
      await tx.membership.create({
        data: {
          id: membershipId, tenantId, userId, allBranches: inv.allBranches,
          defaultBranchId: inv.allBranches ? ((await tx.branch.findFirst({ where: { isMain: true }, select: { id: true } }))?.id ?? null) : (inv.branches[0]?.branchId ?? null),
        },
      });
      await tx.userRole.create({ data: { tenantId, membershipId, roleId: inv.roleId } });
      if (inv.branches.length) {
        await tx.userBranchAccess.createMany({
          data: inv.branches.map((b) => ({ tenantId, membershipId, branchId: b.branchId, accessLevel: b.accessLevel })),
        });
      }
      await writeAudit(tx, tenantId, {
        action: "user.invitation_accepted", entityType: "membership", entityId: membershipId, actorUserId: userId,
        ip: meta.ip, after: { email: inv.email, newAccount: !existing },
      });
    });
    return { tenant: tenantSlug, email: preview.email };
  }
}
