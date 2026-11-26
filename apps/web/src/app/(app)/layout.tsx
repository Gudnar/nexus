import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { getMe } from "@/lib/api";
import { visibleNav } from "@/lib/nav";
import { BRANCH_COOKIE } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  const branch = (await cookies()).get(BRANCH_COOKIE)?.value;

  return (
    <AppShell
      groups={visibleNav(me.permissions)}
      tenantName={me.tenant.legalName}
      currentBranch={branch}
      branches={me.branches.map((b) => ({ id: b.id, code: b.code, name: b.name }))}
      canViewAll={me.branches.length > 1}
      user={{ name: me.user.name, email: me.user.email }}
    >
      {children}
    </AppShell>
  );
}
