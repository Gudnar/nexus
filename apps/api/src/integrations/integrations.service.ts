import { Inject, Injectable } from "@nestjs/common";
import type { CloudinaryInput, IntegrationTestResult, IntegrationView } from "@erp/contracts";
import { Prisma, uuidv7, writeAudit } from "@erp/db";
import { badRequest, conflict } from "../admin/actor";
import type { RequestContext } from "../common/request-context";
import { AppConfig } from "../config";
import { SecretBox } from "../security/crypto";
import { ping, type CloudCreds } from "./cloudinary.client";

const CLOUDINARY = "CLOUDINARY";
type Cfg = { cloudName: string; apiKey: string; folder: string };

/** Integraciones con servicios externos. Los secretos se guardan cifrados y no se devuelven nunca. */
@Injectable()
export class IntegrationsService {
  private readonly box: SecretBox;
  /** Se puede reemplazar en pruebas para no salir a Internet. */
  fetchFn: typeof fetch = (...a) => fetch(...a);
  constructor(@Inject(AppConfig) config: AppConfig) {
    this.box = new SecretBox(`${config.mfaEncryptionKey}:integrations`);
  }

  private row(ctx: RequestContext) {
    return ctx.run((tx) => tx.tenantIntegration.findUnique({ where: { tenantId_provider: { tenantId: ctx.auth.tenantId, provider: CLOUDINARY } } }));
  }

  async list(ctx: RequestContext): Promise<IntegrationView[]> {
    const row = await this.row(ctx);
    const cfg = row?.config as Cfg | undefined;
    return [{
      provider: "CLOUDINARY", label: "Cloudinary", description: "Servidor de imágenes: guarda y entrega las fotos de tus productos desde la nube.",
      configured: !!row, enabled: !!row?.enabled, config: cfg?.cloudName ? { cloudName: cfg.cloudName, apiKey: cfg.apiKey, folder: cfg.folder } : null,
      secretSet: !!row?.secretEnc, updatedAt: row?.updatedAt.toISOString() ?? null,
    }];
  }

  async saveCloudinary(ctx: RequestContext, input: CloudinaryInput): Promise<IntegrationView> {
    await ctx.run(async (tx) => {
      const cur = await tx.tenantIntegration.findUnique({ where: { tenantId_provider: { tenantId: ctx.auth.tenantId, provider: CLOUDINARY } } });
      if (!cur?.secretEnc && !input.apiSecret) throw badRequest("SECRET_REQUIRED", "Indica el API secret de Cloudinary.");
      const config = { cloudName: input.cloudName, apiKey: input.apiKey, folder: input.folder.replace(/^\/+|\/+$/g, "") };
      const secretEnc = input.apiSecret ? this.box.encrypt(input.apiSecret) : cur!.secretEnc;
      if (cur) await tx.tenantIntegration.update({ where: { id: cur.id }, data: { enabled: input.enabled, config, secretEnc, updatedById: ctx.auth.userId } });
      else await tx.tenantIntegration.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, provider: CLOUDINARY, enabled: input.enabled, config, secretEnc, updatedById: ctx.auth.userId } });
      // Solo se audita el cambio, nunca el secreto.
      await writeAudit(tx, ctx.auth.tenantId, { action: "integration.saved", entityType: "tenant_integration", entityId: cur?.id ?? uuidv7(), actorUserId: ctx.auth.userId, after: { provider: CLOUDINARY, cloudName: config.cloudName, enabled: input.enabled, secretChanged: !!input.apiSecret } as Prisma.InputJsonValue });
    });
    return (await this.list(ctx))[0]!;
  }

  /** Credenciales descifradas para uso interno (firmar subidas, borrar fotos). Nulas si no está activa. */
  async creds(ctx: RequestContext): Promise<(CloudCreds & { folder: string }) | null> {
    const row = await this.row(ctx);
    const cfg = row?.config as Cfg | undefined;
    if (!row?.enabled || !row.secretEnc || !cfg?.cloudName) return null;
    return { cloudName: cfg.cloudName, apiKey: cfg.apiKey, apiSecret: this.box.decrypt(row.secretEnc), folder: cfg.folder };
  }

  async testCloudinary(ctx: RequestContext): Promise<IntegrationTestResult> {
    const row = await this.row(ctx);
    const cfg = row?.config as Cfg | undefined;
    if (!row?.secretEnc || !cfg?.cloudName) throw conflict("NOT_CONFIGURED", "Primero guarda los datos de Cloudinary.");
    return ping({ cloudName: cfg.cloudName, apiKey: cfg.apiKey, apiSecret: this.box.decrypt(row.secretEnc) }, this.fetchFn);
  }
}
