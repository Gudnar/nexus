import { Injectable } from "@nestjs/common";

/** Reloj inyectable: las pruebas de horarios fijan el instante sin tocar la hora del sistema. */
@Injectable()
export class Clock {
  private fixed: Date | null = null;

  now(): Date {
    return this.fixed ?? new Date();
  }

  /** Solo para pruebas. `null` vuelve a la hora real. */
  set(instant: Date | null): void {
    this.fixed = instant;
  }
}
