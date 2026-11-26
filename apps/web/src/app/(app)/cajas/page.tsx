import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getCashRegisters, getCashReport, getCashSessions, getCashSettings, getBranchesAdmin, getMe, getMembers, getMyCashSessions } from "@/lib/api";
import { CashManager } from "./cash-manager";

export const metadata: Metadata = { title: "Cajas y turnos" };

export default async function CashPage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("cash.read")) redirect("/dashboard");
  const [registers, sessions, mine, settings, report, members, branches] = await Promise.all([
    getCashRegisters(), getCashSessions(), perms.has("cash.open_session") ? getMyCashSessions() : Promise.resolve([]), getCashSettings(), getCashReport(),
    perms.has("users.read") ? getMembers() : Promise.resolve([]), perms.has("branches.read") ? getBranchesAdmin() : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader title="Cajas y turnos" description="Abre tu turno con el fondo contado, registra ingresos y gastos, y ciérralo con el arqueo. El efectivo esperado lo calcula el sistema." />
      <CashManager
        registers={registers} sessions={sessions} mine={mine} tolerance={settings.differenceTolerance} total={report.total}
        members={members.filter((m) => m.status === "ACTIVE").map((m) => ({ userId: m.userId, name: m.name }))}
        branches={branches.filter((b) => b.status === "ACTIVE").map((b) => ({ id: b.id, name: b.name }))}
        can={{ operate: perms.has("cash.open_session"), close: perms.has("cash.close_session"), manage: perms.has("cash.manage"), approve: perms.has("cash.approve_difference"), reopen: perms.has("cash.reopen_session") }}
      />
    </>
  );
}
