import { BadRequestException } from "@nestjs/common";

export const PASSWORD_MIN_LENGTH = 10;
const MAX = 128;

// Lista corta de contraseñas triviales; la comprobación fuerte (listas filtradas) es
// una mejora posterior. Se compara sin distinguir mayúsculas.
const COMMON = new Set([
  "password123", "contraseña123", "1234567890", "qwertyuiop", "administrador", "bienvenido1",
  "password1234", "letmein1234", "iloveyou123", "abc1234567", "0123456789", "passw0rd123",
]);

/** Devuelve los motivos por los que la contraseña no es aceptable (vacío = válida). */
export function passwordIssues(password: string, ctx: { email?: string; username?: string | null } = {}): string[] {
  const issues: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) issues.push(`Debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  if (password.length > MAX) issues.push(`No puede superar ${MAX} caracteres.`);
  if (new Set(password).size < 5) issues.push("Usa más variedad de caracteres.");
  if (COMMON.has(password.toLowerCase())) issues.push("Es una contraseña demasiado común.");
  const lower = password.toLowerCase();
  const local = ctx.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) issues.push("No debe contener tu correo.");
  if (ctx.username && ctx.username.length >= 3 && lower.includes(ctx.username.toLowerCase())) {
    issues.push("No debe contener tu usuario.");
  }
  return issues;
}

export function assertPasswordPolicy(password: string, ctx: { email?: string; username?: string | null } = {}): void {
  const issues = passwordIssues(password, ctx);
  if (issues.length) {
    throw new BadRequestException({
      code: "WEAK_PASSWORD",
      message: "La contraseña no cumple la política de seguridad.",
      errors: issues,
    });
  }
}
