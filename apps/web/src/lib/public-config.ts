import type { PublicConfig } from "@erp/contracts";
import { API_URL } from "./session";

const FALLBACK: PublicConfig = { registrationEnabled: false, recoveryChannels: ["EMAIL"], passwordMinLength: 10 };

/** Configuración visible antes de autenticarse. Si la API no responde, asume lo más restrictivo. */
export async function getPublicConfig(): Promise<PublicConfig> {
  try {
    const res = await fetch(`${API_URL}/api/v1/public/config`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as PublicConfig) : FALLBACK;
  } catch {
    return FALLBACK;
  }
}
