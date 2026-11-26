export * from "@prisma/client";

export { assertUuid, createDb, runTenantJob, withTenant, withUserContext, type Db, type Tx } from "./context";
export { uuidv7 } from "./uuid7";
export { writeAudit, type AuditInput } from "./audit";
export { enqueueEvent, type DomainEventInput } from "./outbox";
export { nextSequenceNumber } from "./sequence";
export {
  ALL_BRANCHES,
  BranchAccessDenied,
  resolveBranchScope,
  type BranchRequest,
  type BranchScope,
} from "./branch-scope";
export {
  DEFAULT_UNITS,
  PERMISSION_CODES,
  ROLE_TEMPLATES,
  parsePermission,
  type PermissionCode,
  type RoleTemplate,
} from "./permissions-catalog";
export {
  addMember,
  provisionTenant,
  syncPermissionCatalog,
  syncTenantDefaults,
  type AddMemberInput,
  type ProvisionedTenant,
  type ProvisionTenantInput,
} from "./provision";
