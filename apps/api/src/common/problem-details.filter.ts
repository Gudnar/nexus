import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { ProblemDetails } from "@erp/contracts";
import { BranchAccessDenied } from "@erp/db";
import type { FastifyReply } from "fastify";

const TITLES: Record<number, string> = {
  400: "Solicitud inválida", 401: "No autenticado", 403: "Prohibido", 404: "No encontrado",
  409: "Conflicto", 422: "Entidad no procesable", 429: "Demasiadas solicitudes", 500: "Error interno",
};

/** Errores con formato Problem Details (RFC 7807). Nunca filtra detalles internos. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Errors");

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    let status = 500;
    const body: ProblemDetails = { type: "about:blank", title: TITLES[500]!, status };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      const obj = typeof res === "string" ? { message: res } : (res as Record<string, unknown>);
      Object.assign(body, {
        status,
        title: TITLES[status] ?? exception.name,
        detail: typeof obj["message"] === "string" ? obj["message"] : undefined,
        code: obj["code"],
        errors: obj["errors"] ?? obj["tenants"],
      });
    } else if (exception instanceof BranchAccessDenied) {
      status = 403;
      Object.assign(body, { status, title: TITLES[403], detail: exception.message, code: "BRANCH_FORBIDDEN" });
    } else {
      const code = (exception as { code?: string })?.code;
      if (code === "P2002" || code === "P2003") {
        status = 409;
        Object.assign(body, { status, title: TITLES[409], code: "CONFLICT" });
      } else {
        this.logger.error(exception instanceof Error ? exception.stack : String(exception));
      }
    }
    void reply.status(status).type("application/problem+json").send(body);
  }
}
