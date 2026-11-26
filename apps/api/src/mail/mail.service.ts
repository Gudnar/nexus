import { Inject, Injectable, Logger } from "@nestjs/common";
import nodemailer from "nodemailer";
import { AppConfig } from "../config";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailTransport {
  send(msg: MailMessage): Promise<void>;
}

/** Transporte de desarrollo/pruebas: no envía nada, deja el mensaje en un buzón en memoria. */
@Injectable()
export class DevMailbox implements MailTransport {
  private readonly logger = new Logger("DevMailbox");
  readonly messages: (MailMessage & { sentAt: string })[] = [];

  async send(msg: MailMessage): Promise<void> {
    this.messages.unshift({ ...msg, sentAt: new Date().toISOString() });
    this.messages.length = Math.min(this.messages.length, 50);
    this.logger.log(`Correo simulado a ${msg.to}: ${msg.subject}`);
  }

  clear(): void {
    this.messages.length = 0;
  }
}

class SmtpTransport implements MailTransport {
  private readonly t;
  constructor(url: string, private readonly from: string) {
    this.t = nodemailer.createTransport(url);
  }
  async send(msg: MailMessage): Promise<void> {
    await this.t.sendMail({ from: this.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, body: string, cta?: { label: string; url: string }): string {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f2f5ff;font-family:Arial,sans-serif;color:#0f1b4d">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;padding:32px;max-width:100%">
<tr><td><p style="margin:0 0 4px;font-size:13px;color:#2d5be3;font-weight:bold">NEXUS ERP</p>
<h1 style="margin:0 0 16px;font-size:22px">${esc(title)}</h1>
<div style="font-size:15px;line-height:1.55;color:#343849">${body}</div>
${cta ? `<p style="margin:24px 0"><a href="${esc(cta.url)}" style="background:#2d5be3;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold;display:inline-block">${esc(cta.label)}</a></p>
<p style="font-size:12px;color:#73788c">Si el botón no funciona, copia este enlace en tu navegador:<br>${esc(cta.url)}</p>` : ""}
</td></tr></table></td></tr></table></body></html>`;
}

@Injectable()
export class MailService {
  private readonly transport: MailTransport;

  constructor(
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(DevMailbox) private readonly mailbox: DevMailbox,
  ) {
    this.transport =
      config.mailTransport === "smtp" && config.smtpUrl ? new SmtpTransport(config.smtpUrl, config.mailFrom) : mailbox;
  }

  /** true si los correos salen realmente (SMTP); false si quedan en el buzón de desarrollo. */
  get isReal(): boolean {
    return this.transport !== this.mailbox;
  }

  private send(to: string, subject: string, title: string, lines: string[], cta?: { label: string; url: string }) {
    return this.transport.send({
      to, subject,
      text: [title, "", ...lines, ...(cta ? ["", `${cta.label}: ${cta.url}`] : [])].join("\n"),
      html: layout(title, lines.map((l) => `<p style="margin:0 0 12px">${esc(l)}</p>`).join(""), cta),
    });
  }

  sendRegistrationVerification(to: string, name: string, url: string, hours: number) {
    return this.send(to, "Confirma tu correo — NEXUS ERP", "Confirma tu correo", [
      `Hola ${name}, recibimos una solicitud para crear una empresa en NEXUS ERP con este correo.`,
      `El enlace vence en ${hours} horas. Si no fuiste tú, ignora este mensaje.`,
    ], { label: "Confirmar correo y crear mi cuenta", url });
  }

  sendInvitation(to: string, tenantName: string, inviter: string, roleName: string, url: string, days: number) {
    return this.send(to, `Te invitaron a ${tenantName} — NEXUS ERP`, `Te invitaron a ${tenantName}`, [
      `${inviter} te invitó a unirte a ${tenantName} en NEXUS ERP con el rol «${roleName}».`,
      `La invitación vence en ${days} días. Si no la esperabas, ignora este mensaje.`,
    ], { label: "Aceptar invitación", url });
  }

  sendCompanyCreated(to: string, name: string, company: string, url: string, hours: number) {
    return this.send(to, `Tu empresa ${company} está lista — NEXUS ERP`, "Tu empresa está lista", [
      `Hola ${name}, creamos la empresa «${company}» en NEXUS ERP y tú eres su administrador.`,
      `Crea tu contraseña con el siguiente enlace (vence en ${hours} horas y solo sirve una vez).`,
    ], { label: "Crear mi contraseña", url });
  }

  sendCompanyAdded(to: string, name: string, company: string, loginUrl: string) {
    return this.send(to, `Eres administrador de ${company} — NEXUS ERP`, "Nueva empresa en tu cuenta", [
      `Hola ${name}, ahora eres administrador de «${company}». Entra con tu cuenta de siempre y elige la empresa.`,
    ], { label: "Entrar", url: loginUrl });
  }

  sendAlreadyRegistered(to: string, loginUrl: string, resetUrl: string) {
    return this.send(to, "Ya tienes una cuenta — NEXUS ERP", "Ya tienes una cuenta", [
      "Alguien intentó registrar una empresa con este correo, pero ya existe una cuenta asociada.",
      `Si fuiste tú, inicia sesión en ${loginUrl}. Si olvidaste la contraseña, puedes restablecerla.`,
    ], { label: "Restablecer contraseña", url: resetUrl });
  }

  sendPasswordReset(to: string, name: string, url: string, minutes: number) {
    return this.send(to, "Restablece tu contraseña — NEXUS ERP", "Restablece tu contraseña", [
      `Hola ${name}, recibimos una solicitud para restablecer tu contraseña.`,
      `El enlace vence en ${minutes} minutos y solo puede usarse una vez. Si no la solicitaste, ignora este mensaje: tu contraseña no cambiará.`,
    ], { label: "Crear nueva contraseña", url });
  }

  sendPasswordChanged(to: string, name: string) {
    return this.send(to, "Tu contraseña fue cambiada — NEXUS ERP", "Tu contraseña fue cambiada", [
      `Hola ${name}, tu contraseña acaba de cambiar y se cerraron tus sesiones abiertas.`,
      "Si no fuiste tú, restablécela de inmediato y contacta al administrador de tu empresa.",
    ]);
  }

  sendMfaChanged(to: string, name: string, enabled: boolean) {
    return this.send(to, `MFA ${enabled ? "activado" : "desactivado"} — NEXUS ERP`, `MFA ${enabled ? "activado" : "desactivado"}`, [
      `Hola ${name}, la verificación en dos pasos de tu cuenta fue ${enabled ? "activada" : "desactivada"}.`,
      "Si no fuiste tú, cambia tu contraseña de inmediato.",
    ]);
  }
}
