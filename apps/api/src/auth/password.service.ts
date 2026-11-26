import { Injectable } from "@nestjs/common";
import { hash, verify } from "@node-rs/argon2";

/** argon2id con parámetros mínimos OWASP (19 MiB, 2 iteraciones, 1 hilo). */
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  private dummy?: Promise<string>;

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false; // hash malformado o marcador de prueba
    }
  }

  /** Iguala el tiempo de respuesta cuando el usuario no existe o está bloqueado. */
  async verifyDummy(password: string): Promise<void> {
    this.dummy ??= hash("dummy-password-for-timing", OPTIONS);
    await this.verify(await this.dummy, password);
  }
}
