/**
 * Evaluación de horarios de acceso (plan §5.5). Funciones puras: sin base de datos ni reloj
 * global, para poder probarlas con cualquier instante y zona horaria.
 *
 * Reglas:
 *  - Una ventana semanal es [inicio, fin): el inicio es inclusivo y el fin exclusivo.
 *  - Si `fin <= inicio` la ventana cruza la medianoche: abarca desde `inicio` del día indicado
 *    hasta `fin` del día siguiente (el tramo posterior a la medianoche pertenece a la ventana
 *    del día anterior).
 *  - Las excepciones se miden en FECHA LOCAL. BLOCK gana sobre ALLOW; ALLOW gana sobre las
 *    ventanas; sin excepciones aplica la ventana semanal.
 *  - Un horario sin ventanas no permite nunca el acceso (por defecto cerrado).
 */

export interface RuleDef {
  /** 1 = lunes … 7 = domingo */
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface ExceptionDef {
  /** Fecha local AAAA-MM-DD */
  date: string;
  type: "BLOCK" | "ALLOW";
  /** null = todo el día */
  startMinute: number | null;
  endMinute: number | null;
}

export interface ScheduleDef {
  timezone: string;
  rules: RuleDef[];
  exceptions: ExceptionDef[];
}

export type Verdict =
  | { allowed: true; reason: "RULE" | "ALLOW_EXCEPTION" }
  | { allowed: false; reason: "NO_RULE" | "BLOCK_EXCEPTION" };

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export interface LocalParts {
  date: string;
  weekday: number;
  minute: number;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Fecha, día de semana y minuto del día de `instant` en la zona `timezone`. */
export function localParts(instant: Date, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: WEEKDAYS[get("weekday")]!,
    minute: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

const prevWeekday = (w: number) => (w === 1 ? 7 : w - 1);

/** ¿Cae el minuto `m` en la ventana de `rule` que empieza en el día `today`? (incluye el tramo de ayer). */
function ruleCovers(rule: RuleDef, today: number, m: number): boolean {
  const overnight = rule.endMinute <= rule.startMinute;
  if (!overnight) return rule.weekday === today && m >= rule.startMinute && m < rule.endMinute;
  if (rule.weekday === today && m >= rule.startMinute) return true; // tramo antes de medianoche
  return rule.weekday === prevWeekday(today) && m < rule.endMinute; // tramo después de medianoche
}

const covers = (e: ExceptionDef, m: number) =>
  e.startMinute === null || e.endMinute === null || (m >= e.startMinute && m < e.endMinute);

export function evaluate(def: ScheduleDef, instant: Date): Verdict {
  const now = localParts(instant, def.timezone);
  const todays = def.exceptions.filter((e) => e.date === now.date && covers(e, now.minute));
  if (todays.some((e) => e.type === "BLOCK")) return { allowed: false, reason: "BLOCK_EXCEPTION" };
  if (todays.some((e) => e.type === "ALLOW")) return { allowed: true, reason: "ALLOW_EXCEPTION" };
  if (def.rules.some((r) => ruleCovers(r, now.weekday, now.minute))) return { allowed: true, reason: "RULE" };
  return { allowed: false, reason: "NO_RULE" };
}

export interface Opening {
  /** 0 = hoy, 1 = mañana, … */
  daysAhead: number;
  weekday: number;
  minute: number;
}

/**
 * Próximo inicio de ventana (hasta 7 días). Orientativo para el mensaje al usuario: respeta los
 * bloqueos de día completo y las ventanas ALLOW, pero no evalúa bloqueos parciales.
 */
export function nextOpening(def: ScheduleDef, instant: Date): Opening | null {
  const now = localParts(instant, def.timezone);
  const [y, mo, d] = now.date.split("-").map(Number) as [number, number, number];
  let best: Opening | null = null;
  for (let ahead = 0; ahead <= 7; ahead++) {
    const day = new Date(Date.UTC(y, mo - 1, d + ahead));
    const iso = day.toISOString().slice(0, 10);
    const weekday = ((now.weekday - 1 + ahead) % 7) + 1;
    const dayEx = def.exceptions.filter((e) => e.date === iso);
    const blockedAllDay = dayEx.some((e) => e.type === "BLOCK" && e.startMinute === null);
    const starts = [
      ...(blockedAllDay ? [] : def.rules.filter((r) => r.weekday === weekday).map((r) => r.startMinute)),
      ...dayEx.filter((e) => e.type === "ALLOW").map((e) => e.startMinute ?? 0),
    ].filter((m) => ahead > 0 || m > now.minute);
    for (const minute of starts) {
      if (!best || ahead < best.daysAhead || (ahead === best.daysAhead && minute < best.minute)) best = { daysAhead: ahead, weekday, minute };
    }
    if (best && best.daysAhead === ahead) break;
  }
  return best;
}

export const minutesToHHMM = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const hhmmToMinutes = (s: string): number => {
  const [h, m] = s.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

export const WEEKDAY_NAMES = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

/** Texto para el usuario: «lunes a las 08:00 (hora de America/La_Paz)». */
export function describeOpening(o: Opening | null, timezone: string): string {
  if (!o) return "No hay un horario de acceso próximo configurado";
  const when = o.daysAhead === 0 ? "hoy" : o.daysAhead === 1 ? "mañana" : `el ${WEEKDAY_NAMES[o.weekday]}`;
  return `${when} a las ${minutesToHHMM(o.minute)} (hora de ${timezone})`;
}
