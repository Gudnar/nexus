import { Injectable } from "@nestjs/common";
import type { NotificationView } from "@erp/contracts";
import { uuidv7, type Tx } from "@erp/db";
import type { RequestContext } from "../common/request-context";

export interface NotifyInput {
  type: string; title: string; body?: string | null; link?: string | null; severity?: "INFO" | "WARN" | "CRITICAL"; refType?: string; refId?: string;
}

/** Avisos internos por usuario (canal "en la aplicación"). Los demás canales se alimentan del outbox. */
@Injectable()
export class NotificationsService {
  /** Crea el aviso para cada usuario (sin repetir). Se llama dentro de la transacción del hecho que lo origina. */
  async notify(tx: Tx, tenantId: string, userIds: Iterable<string>, n: NotifyInput): Promise<number> {
    const ids = [...new Set(userIds)];
    if (!ids.length) return 0;
    await tx.notification.createMany({
      data: ids.map((userId) => ({
        id: uuidv7(), tenantId, userId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null,
        severity: n.severity ?? "INFO", refType: n.refType ?? null, refId: n.refId ?? null,
      })),
    });
    return ids.length;
  }

  async list(ctx: RequestContext, onlyUnread: boolean): Promise<{ items: NotificationView[]; unread: number }> {
    return ctx.run(async (tx) => {
      const where = { userId: ctx.auth.userId };
      const [rows, unread] = await Promise.all([
        tx.notification.findMany({ where: onlyUnread ? { ...where, readAt: null } : where, orderBy: { createdAt: "desc" }, take: 50 }),
        tx.notification.count({ where: { ...where, readAt: null } }),
      ]);
      return {
        unread,
        items: rows.map((r) => ({ id: r.id, type: r.type, title: r.title, body: r.body, link: r.link, severity: r.severity, read: !!r.readAt, createdAt: r.createdAt.toISOString(), refType: r.refType, refId: r.refId })),
      };
    });
  }

  async markRead(ctx: RequestContext, id: string | null): Promise<{ marked: number }> {
    return ctx.run(async (tx) => {
      const r = await tx.notification.updateMany({ where: { userId: ctx.auth.userId, readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });
      return { marked: r.count };
    });
  }
}
