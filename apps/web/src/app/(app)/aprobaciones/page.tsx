import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getApprovalDelegations, getApprovalWorkflows, getApprovals, getDelegateCandidates, getMe, getRoles } from "@/lib/api";
import { ApprovalsManager } from "./approvals-manager";

export const metadata: Metadata = { title: "Aprobaciones" };

export default async function ApprovalsPage() {
  const me = await getMe();
  const perms = new Set(me.permissions);
  if (!perms.has("approvals.read")) redirect("/dashboard");
  const canDecide = perms.has("approvals.decide");
  const canManage = perms.has("approvals.manage");
  const [mine, inbox, all, delegations, candidates, workflows, roles] = await Promise.all([
    getApprovals("mine"),
    canDecide ? getApprovals("inbox") : Promise.resolve([]),
    canDecide || canManage ? getApprovals("all") : Promise.resolve([]),
    getApprovalDelegations(),
    canDecide ? getDelegateCandidates() : Promise.resolve([]),
    getApprovalWorkflows(),
    canManage ? getRoles().catch(() => []) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader title="Aprobaciones" description="Operaciones sensibles que necesitan la autorización de otra persona: quién las pide, quién las decide y con qué regla." />
      <ApprovalsManager
        mine={mine} inbox={inbox} all={all} delegations={delegations} candidates={candidates} workflows={workflows}
        roles={roles.map((r) => ({ id: r.id, name: r.name }))} canDecide={canDecide} canManage={canManage}
      />
    </>
  );
}
