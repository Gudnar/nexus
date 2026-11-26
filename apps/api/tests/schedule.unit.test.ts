import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeOpening, evaluate, hhmmToMinutes as t, isValidTimezone, localParts, minutesToHHMM, nextOpening,
  type ExceptionDef, type RuleDef, type ScheduleDef,
} from "../src/access/schedule";

const LPZ = "America/La_Paz"; // UTC-4 todo el año
/** Instante a partir de fecha y hora LOCALES de La Paz. */
const at = (local: string) => new Date(`${local}:00-04:00`);
const def = (rules: RuleDef[], exceptions: ExceptionDef[] = [], timezone = LPZ): ScheduleDef => ({ timezone, rules, exceptions });
const weekdays = (start: string, end: string, days = [1, 2, 3, 4, 5]): RuleDef[] =>
  days.map((weekday) => ({ weekday, startMinute: t(start), endMinute: t(end) }));

// 2026-11-23 es lunes
describe("ventanas semanales", () => {
  const office = def(weekdays("08:00", "18:00"));

  it("el inicio es inclusivo y el fin exclusivo", () => {
    assert.equal(evaluate(office, at("2026-11-23T07:59")).allowed, false);
    assert.equal(evaluate(office, at("2026-11-23T08:00")).allowed, true);
    assert.equal(evaluate(office, at("2026-11-23T17:59")).allowed, true);
    assert.equal(evaluate(office, at("2026-11-23T18:00")).allowed, false);
  });

  it("solo los días configurados", () => {
    assert.equal(evaluate(office, at("2026-11-27T10:00")).allowed, true); // viernes
    assert.equal(evaluate(office, at("2026-11-28T10:00")).allowed, false); // sábado
    assert.equal(evaluate(office, at("2026-11-29T10:00")).allowed, false); // domingo
  });

  it("varias ventanas el mismo día (turno partido)", () => {
    const split = def([...weekdays("08:00", "12:00"), ...weekdays("14:00", "18:00")]);
    assert.equal(evaluate(split, at("2026-11-23T13:00")).allowed, false);
    assert.equal(evaluate(split, at("2026-11-23T14:30")).allowed, true);
  });

  it("un horario sin ventanas nunca permite el acceso", () => {
    const v = evaluate(def([]), at("2026-11-23T10:00"));
    assert.deepEqual(v, { allowed: false, reason: "NO_RULE" });
  });

  it("24:00 como fin cubre hasta el último minuto del día", () => {
    const allDay = def([{ weekday: 1, startMinute: 0, endMinute: 1440 }]);
    assert.equal(evaluate(allDay, at("2026-11-23T23:59")).allowed, true);
    assert.equal(evaluate(allDay, at("2026-11-24T00:00")).allowed, false); // martes
  });
});

describe("turnos que cruzan la medianoche", () => {
  // viernes 22:00 → sábado 06:00
  const night = def([{ weekday: 5, startMinute: t("22:00"), endMinute: t("06:00") }]);

  it("cubre la noche del viernes y la madrugada del sábado", () => {
    assert.equal(evaluate(night, at("2026-11-27T21:59")).allowed, false);
    assert.equal(evaluate(night, at("2026-11-27T22:00")).allowed, true);
    assert.equal(evaluate(night, at("2026-11-27T23:59")).allowed, true);
    assert.equal(evaluate(night, at("2026-11-28T00:00")).allowed, true);
    assert.equal(evaluate(night, at("2026-11-28T05:59")).allowed, true);
    assert.equal(evaluate(night, at("2026-11-28T06:00")).allowed, false);
  });

  it("la madrugada del viernes NO pertenece a la ventana del viernes", () => {
    assert.equal(evaluate(night, at("2026-11-27T03:00")).allowed, false);
  });

  it("el domingo cruza hacia el lunes", () => {
    const sun = def([{ weekday: 7, startMinute: t("20:00"), endMinute: t("02:00") }]);
    assert.equal(evaluate(sun, at("2026-11-30T01:00")).allowed, true); // lunes 01:00
    assert.equal(evaluate(sun, at("2026-11-30T03:00")).allowed, false);
  });
});

describe("zona horaria", () => {
  const office = def(weekdays("08:00", "18:00"));

  it("se evalúa en la hora local, no en UTC", () => {
    assert.equal(evaluate(office, new Date("2026-11-23T11:59:00Z")).allowed, false); // 07:59 en La Paz
    assert.equal(evaluate(office, new Date("2026-11-23T12:00:00Z")).allowed, true); // 08:00
    assert.equal(evaluate(office, new Date("2026-11-23T22:00:00Z")).allowed, false); // 18:00
  });

  it("el día cambia según la zona: lunes 22:00 UTC es martes en Madrid", () => {
    const parts = localParts(new Date("2026-11-23T23:30:00Z"), "Europe/Madrid");
    assert.equal(parts.weekday, 2);
    assert.equal(parts.date, "2026-11-24");
  });

  it("respeta el horario de verano de la zona", () => {
    const ny = def(weekdays("09:00", "17:00"), [], "America/New_York");
    assert.equal(evaluate(ny, new Date("2026-07-06T13:00:00Z")).allowed, true); // 09:00 EDT (UTC-4)
    assert.equal(evaluate(ny, new Date("2026-07-06T12:59:00Z")).allowed, false);
    assert.equal(evaluate(ny, new Date("2026-01-12T14:00:00Z")).allowed, true); // 09:00 EST (UTC-5)
    assert.equal(evaluate(ny, new Date("2026-01-12T13:59:00Z")).allowed, false);
  });

  it("valida nombres de zona", () => {
    assert.equal(isValidTimezone("America/La_Paz"), true);
    assert.equal(isValidTimezone("Mars/Olympus"), false);
  });
});

describe("excepciones", () => {
  const office = weekdays("08:00", "18:00");

  it("BLOCK de día completo cierra el acceso (feriado)", () => {
    const d = def(office, [{ date: "2026-11-23", type: "BLOCK", startMinute: null, endMinute: null }]);
    assert.deepEqual(evaluate(d, at("2026-11-23T10:00")), { allowed: false, reason: "BLOCK_EXCEPTION" });
    assert.equal(evaluate(d, at("2026-11-24T10:00")).allowed, true, "otros días no se ven afectados");
  });

  it("BLOCK parcial solo cierra su franja", () => {
    const d = def(office, [{ date: "2026-11-23", type: "BLOCK", startMinute: t("12:00"), endMinute: t("14:00") }]);
    assert.equal(evaluate(d, at("2026-11-23T11:59")).allowed, true);
    assert.equal(evaluate(d, at("2026-11-23T12:00")).allowed, false);
    assert.equal(evaluate(d, at("2026-11-23T14:00")).allowed, true);
  });

  it("ALLOW abre un acceso extraordinario fuera de las ventanas", () => {
    const d = def(office, [{ date: "2026-11-28", type: "ALLOW", startMinute: t("09:00"), endMinute: t("13:00") }]); // sábado
    assert.deepEqual(evaluate(d, at("2026-11-28T10:00")), { allowed: true, reason: "ALLOW_EXCEPTION" });
    assert.equal(evaluate(d, at("2026-11-28T13:00")).allowed, false);
  });

  it("BLOCK gana sobre ALLOW en el mismo momento", () => {
    const d = def(office, [
      { date: "2026-11-28", type: "ALLOW", startMinute: null, endMinute: null },
      { date: "2026-11-28", type: "BLOCK", startMinute: t("10:00"), endMinute: t("11:00") },
    ]);
    assert.equal(evaluate(d, at("2026-11-28T09:00")).allowed, true);
    assert.equal(evaluate(d, at("2026-11-28T10:30")).allowed, false);
  });

  it("la fecha de la excepción es local, no UTC", () => {
    // 23:00 del domingo en La Paz ya es lunes en UTC; el bloqueo del lunes NO debe aplicarse todavía
    const d = def(weekdays("00:00", "24:00", [1, 7]), [{ date: "2026-11-23", type: "BLOCK", startMinute: null, endMinute: null }]);
    assert.equal(evaluate(d, at("2026-11-22T23:00")).allowed, true);
    assert.equal(evaluate(d, at("2026-11-23T00:30")).allowed, false);
  });
});

describe("próxima apertura (mensaje al usuario)", () => {
  const office = def(weekdays("08:00", "18:00"));

  it("hoy, si todavía no abre", () => {
    assert.equal(describeOpening(nextOpening(office, at("2026-11-23T06:00")), LPZ), "hoy a las 08:00 (hora de America/La_Paz)");
  });

  it("mañana, después del cierre", () => {
    assert.equal(describeOpening(nextOpening(office, at("2026-11-23T19:00")), LPZ), "mañana a las 08:00 (hora de America/La_Paz)");
  });

  it("el lunes, durante el fin de semana", () => {
    assert.equal(describeOpening(nextOpening(office, at("2026-11-28T10:00")), LPZ), "el lunes a las 08:00 (hora de America/La_Paz)");
  });

  it("salta los días bloqueados", () => {
    const d: ScheduleDef = { ...office, exceptions: [{ date: "2026-11-24", type: "BLOCK", startMinute: null, endMinute: null }] };
    assert.equal(describeOpening(nextOpening(d, at("2026-11-23T19:00")), LPZ), "el miércoles a las 08:00 (hora de America/La_Paz)");
  });

  it("sin ventanas no hay próxima apertura", () => {
    assert.equal(nextOpening(def([]), at("2026-11-23T10:00")), null);
  });

  it("formatea minutos", () => {
    assert.equal(minutesToHHMM(t("07:05")), "07:05");
    assert.equal(minutesToHHMM(1440), "24:00");
  });
});
