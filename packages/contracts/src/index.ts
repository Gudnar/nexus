import { z } from "zod";

// ───────────── Autenticación ─────────────

/** Usuario (alias) o correo, en un mismo campo. Se normaliza a minúsculas. */
export const Identifier = z.string().trim().toLowerCase().min(3).max(254);

export const LoginRequest = z.object({
  identifier: Identifier,
  password: z.string().min(1).max(256),
  /** Slug del tenant; obligatorio solo si el usuario pertenece a más de uno. */
  tenant: z.string().trim().min(1).max(63).optional(),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const RefreshRequest = z.object({
  refreshToken: z.string().min(10).max(512),
});
export type RefreshRequest = z.infer<typeof RefreshRequest>;

export const TokenResponse = z.object({
  tokenType: z.literal("Bearer"),
  accessToken: z.string(),
  refreshToken: z.string(),
  /** Segundos de vigencia del access token. */
  expiresIn: z.number().int().positive(),
});
export type TokenResponse = z.infer<typeof TokenResponse>;

// ───────────── Contexto de sesión ─────────────

export const BranchSummary = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  isMain: z.boolean(),
  status: z.enum(["ACTIVE", "INACTIVE"]),
});
export type BranchSummary = z.infer<typeof BranchSummary>;

export const MeResponse = z.object({
  user: z.object({ id: z.string().uuid(), email: z.string(), username: z.string().nullable(), name: z.string() }),
  tenant: z.object({ id: z.string().uuid(), slug: z.string(), legalName: z.string() }),
  membershipId: z.string().uuid(),
  allBranches: z.boolean(),
  defaultBranchId: z.string().uuid().nullable(),
  permissions: z.array(z.string()),
  branches: z.array(BranchSummary),
});
export type MeResponse = z.infer<typeof MeResponse>;

/** Cabecera con la sucursal de trabajo: un UUID o "ALL" (solo consultas autorizadas). */
export const BRANCH_HEADER = "x-branch-id";

/** Error con formato Problem Details (RFC 7807). */
export const ProblemDetails = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  code: z.string().optional(),
  errors: z.unknown().optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetails>;

// ───────────── Panel consolidado (plan §2.3) ─────────────

export const DashboardQuery = z.object({
  /** Ventana de actividad, en días. */
  days: z.coerce.number().int().min(1).max(90).default(7),
});
export type DashboardQuery = z.infer<typeof DashboardQuery>;

/** Módulos del panel que se activan cuando existan en el sistema. */
export const PENDING_DASHBOARD_MODULES = [
  "sales", "purchases", "inventory", "cash", "receivables", "payables",
  "quotes", "approvals", "ecommerce", "channels",
] as const;

export const DashboardResponse = z.object({
  generatedAt: z.string(),
  windowDays: z.number().int(),
  /**
   * Alcance explícito del reporte (plan §2.3): nunca se mezclan sucursales sin decirlo.
   * ALL = todas las sucursales a las que el usuario tiene acceso (`restricted` indica si
   * son menos que todas las del tenant). BRANCH = una sola sucursal.
   */
  scope: z.object({
    mode: z.enum(["ALL", "BRANCH"]),
    restricted: z.boolean(),
    label: z.string(),
    branchIds: z.array(z.string().uuid()),
  }),
  /** Secciones realmente incluidas según los permisos del usuario. */
  visibleSections: z.array(z.string()),
  branches: z
    .array(BranchSummary.extend({ activeUsers: z.number().int() }))
    .nullable(),
  users: z
    .object({ active: z.number().int(), suspended: z.number().int(), invited: z.number().int() })
    .nullable(),
  activity: z
    .object({
      includesTenantLevelEvents: z.boolean(),
      actionCounts: z.array(z.object({ action: z.string(), count: z.number().int() })),
      recent: z.array(
        z.object({
          id: z.string().uuid(),
          occurredAt: z.string(),
          action: z.string(),
          entityType: z.string(),
          entityId: z.string().nullable(),
          branchId: z.string().uuid().nullable(),
          actorUserId: z.string().uuid().nullable(),
          actorName: z.string().nullable(),
        }),
      ),
    })
    .nullable(),
  system: z
    .object({ outbox: z.object({ pending: z.number().int(), failed: z.number().int(), dead: z.number().int() }) })
    .nullable(),
  pendingModules: z.array(z.string()),
});
export type DashboardResponse = z.infer<typeof DashboardResponse>;

// ───────────── MFA ─────────────

/** Código TOTP de 6 dígitos o código de recuperación (xxxxx-xxxxx). */
export const MfaCode = z.string().trim().min(6).max(16);

/** Respuesta de login cuando la cuenta tiene MFA: falta el segundo factor. */
export const MfaChallengeResponse = z.object({
  mfaRequired: z.literal(true),
  mfaToken: z.string(),
  /** Segundos de vigencia del desafío. */
  expiresIn: z.number().int().positive(),
});
export type MfaChallengeResponse = z.infer<typeof MfaChallengeResponse>;

export const MfaVerifyRequest = z.object({ mfaToken: z.string().min(10).max(2000), code: MfaCode });
export type MfaVerifyRequest = z.infer<typeof MfaVerifyRequest>;

export const MfaSetupRequest = z.object({ password: z.string().min(1).max(256) });
export const MfaSetupResponse = z.object({
  /** Secreto en base32 para ingreso manual. */
  secret: z.string(),
  otpauthUri: z.string(),
  /** SVG del código QR (se muestra como imagen, nunca como HTML). */
  qrSvg: z.string(),
});
export type MfaSetupResponse = z.infer<typeof MfaSetupResponse>;

export const MfaEnableRequest = z.object({ code: MfaCode });
export const MfaEnableResponse = z.object({ recoveryCodes: z.array(z.string()) });
export type MfaEnableResponse = z.infer<typeof MfaEnableResponse>;

export const MfaConfirmRequest = z.object({ password: z.string().min(1).max(256), code: MfaCode });

export const SecurityOverview = z.object({
  email: z.string(),
  username: z.string().nullable(),
  name: z.string(),
  emailVerified: z.boolean(),
  mfaEnabled: z.boolean(),
  mfaEnabledAt: z.string().nullable(),
  recoveryCodesRemaining: z.number().int(),
});
export type SecurityOverview = z.infer<typeof SecurityOverview>;

// ───────────── Cuenta y contraseña ─────────────

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_RE, 'Usa 3 a 32 caracteres: letras, números, punto, guion o guion bajo');

export const UpdateProfileRequest = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  /** null elimina el alias. */
  username: Username.nullable().optional(),
});
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>;

export const ChangePasswordRequest = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(256),
});

export const RECOVERY_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP'] as const;
export const RecoveryChannel = z.enum(RECOVERY_CHANNELS);
export type RecoveryChannel = z.infer<typeof RecoveryChannel>;

export const ForgotPasswordRequest = z.object({
  identifier: Identifier,
  channel: RecoveryChannel.default('EMAIL'),
});
export const ResetPasswordRequest = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(1).max(256),
  /** Obligatorio si la cuenta tiene MFA. */
  mfaCode: MfaCode.optional(),
});

// ───────────── Registro y configuración pública ─────────────

export const PublicConfig = z.object({
  registrationEnabled: z.boolean(),
  /** Canales de recuperación realmente disponibles en este despliegue. */
  recoveryChannels: z.array(RecoveryChannel),
  passwordMinLength: z.number().int(),
});
export type PublicConfig = z.infer<typeof PublicConfig>;

export const RegisterRequest = z.object({
  companyName: z.string().trim().min(2).max(160),
  taxId: z.string().trim().max(40).optional(),
  adminName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  username: Username.optional(),
  password: z.string().min(1).max(256),
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const VerifyTokenRequest = z.object({ token: z.string().min(20).max(200) });

// ───────────── Plataforma (administrador global) ─────────────

export const PlatformLoginRequest = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(256),
  /** Obligatorio si el administrador tiene TOTP configurado. */
  totp: MfaCode.optional(),
});
export const PlatformSettings = z.object({ registration: z.object({ enabled: z.boolean() }) });
export type PlatformSettings = z.infer<typeof PlatformSettings>;
export const SetRegistrationRequest = z.object({ enabled: z.boolean() });

// ───────────── Administración de la empresa ─────────────

const Uuid = z.string().uuid();
export const ACCESS_LEVELS = ["VIEW", "OPERATE", "MANAGE"] as const;
export const AccessLevel = z.enum(ACCESS_LEVELS);

export const BranchCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,11}$/, "Hasta 12 caracteres: letras, números, guion o guion bajo");

export const BranchInput = z.object({
  code: BranchCode,
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  /** Vacío = sin correo. */
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email().max(254)]).optional(),
});
export type BranchInput = z.infer<typeof BranchInput>;

/** `code` no se puede cambiar: los documentos lo referencian. `isMain: true` traslada la principal. */
export const BranchPatch = BranchInput.omit({ code: true }).partial().extend({
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  isMain: z.literal(true).optional(),
});
export type BranchPatch = z.infer<typeof BranchPatch>;

export const BranchDetail = BranchSummary.extend({
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  activeUsers: z.number().int(),
});
export type BranchDetail = z.infer<typeof BranchDetail>;

/** Acceso a sucursales: todas, o una lista con nivel por sucursal. */
export const BranchAccessInput = z.object({
  allBranches: z.boolean().default(false),
  branches: z.array(z.object({ branchId: Uuid, accessLevel: AccessLevel.default("OPERATE") })).max(200).default([]),
});

export const InviteUserRequest = BranchAccessInput.extend({
  email: z.string().trim().toLowerCase().email().max(254),
  roleId: Uuid,
}).refine((v) => v.allBranches || v.branches.length > 0, {
  message: "Indica al menos una sucursal o acceso a todas",
  path: ["branches"],
});
export type InviteUserRequest = z.infer<typeof InviteUserRequest>;

export const UpdateMemberRequest = z.object({
  roleId: Uuid.optional(),
  /** null = sin restricción horaria. */
  scheduleId: Uuid.nullable().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  allBranches: z.boolean().optional(),
  branches: z.array(z.object({ branchId: Uuid, accessLevel: AccessLevel.default("OPERATE") })).max(200).optional(),
});
export type UpdateMemberRequest = z.infer<typeof UpdateMemberRequest>;

export const MemberSummary = z.object({
  membershipId: Uuid,
  userId: Uuid,
  name: z.string(),
  email: z.string(),
  username: z.string().nullable(),
  status: z.enum(["INVITED", "ACTIVE", "SUSPENDED"]),
  role: z.object({ id: Uuid, code: z.string(), name: z.string() }).nullable(),
  allBranches: z.boolean(),
  branches: z.array(z.object({ branchId: Uuid, code: z.string(), accessLevel: AccessLevel })),
  mfaEnabled: z.boolean(),
  schedule: z.object({ id: Uuid, name: z.string() }).nullable(),
  isYou: z.boolean(),
});
export type MemberSummary = z.infer<typeof MemberSummary>;

export const InvitationSummary = z.object({
  id: Uuid,
  email: z.string(),
  role: z.object({ id: Uuid, name: z.string() }),
  allBranches: z.boolean(),
  branchCodes: z.array(z.string()),
  expiresAt: z.string(),
  createdAt: z.string(),
  state: z.enum(["PENDING", "EXPIRED"]),
});
export type InvitationSummary = z.infer<typeof InvitationSummary>;

export const RoleInput = z.object({
  name: z.string().trim().min(2).max(60),
  permissions: z.array(z.string().min(3).max(80)).max(200),
});
export type RoleInput = z.infer<typeof RoleInput>;
export const RolePatch = RoleInput.partial();
export type RolePatch = z.infer<typeof RolePatch>;

export const RoleSummary = z.object({
  id: Uuid,
  code: z.string(),
  name: z.string(),
  isSystemTemplate: z.boolean(),
  permissions: z.array(z.string()),
  members: z.number().int(),
});
export type RoleSummary = z.infer<typeof RoleSummary>;

export const PermissionInfo = z.object({ code: z.string(), module: z.string(), action: z.string() });
export type PermissionInfo = z.infer<typeof PermissionInfo>;

export const InvitationInfo = z.object({
  tenantName: z.string(),
  email: z.string(),
  roleName: z.string(),
  /** true: ya tiene cuenta, confirma con su contraseña; false: debe crear su cuenta. */
  accountExists: z.boolean(),
  expiresAt: z.string(),
});
export type InvitationInfo = z.infer<typeof InvitationInfo>;

export const AcceptInvitationRequest = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().min(2).max(120).optional(),
  username: Username.optional(),
  password: z.string().min(1).max(256),
});
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequest>;

// ───────────── Horarios de acceso (plan §5.5) ─────────────

/** Hora local "HH:MM" (24:00 solo como fin de ventana). */
export const HHMM = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Usa el formato HH:MM");

export const ScheduleRuleInput = z
  .object({ weekday: z.number().int().min(1).max(7), start: HHMM, end: HHMM })
  .refine((r) => r.start !== r.end && r.start !== '24:00', { message: 'La hora de inicio y fin deben ser distintas' });

export const ScheduleExceptionInput = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD"),
    type: z.enum(['BLOCK', 'ALLOW']),
    start: HHMM.optional(),
    end: HHMM.optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((e) => (e.start === undefined) === (e.end === undefined), { message: 'Indica inicio y fin, o ninguno (todo el día)' })
  .refine((e) => e.start === undefined || (e.start !== '24:00' && e.end! > e.start), { message: 'El fin debe ser posterior al inicio' });

export const ScheduleInput = z.object({
  name: z.string().trim().min(2).max(60),
  /** Zona IANA (p. ej. America/La_Paz). Vacío = la de la empresa. */
  timezone: z.string().trim().min(1).max(64).nullable().optional(),
  rules: z.array(ScheduleRuleInput).max(70),
  exceptions: z.array(ScheduleExceptionInput).max(400).default([]),
});
export type ScheduleInput = z.infer<typeof ScheduleInput>;
export const SchedulePatch = ScheduleInput.partial();
export type SchedulePatch = z.infer<typeof SchedulePatch>;

export const ScheduleSummary = z.object({
  id: Uuid,
  name: z.string(),
  timezone: z.string().nullable(),
  effectiveTimezone: z.string(),
  rules: z.array(z.object({ weekday: z.number().int(), start: z.string(), end: z.string() })),
  exceptions: z.array(
    z.object({ date: z.string(), type: z.enum(['BLOCK', 'ALLOW']), start: z.string().nullable(), end: z.string().nullable(), reason: z.string().nullable() }),
  ),
  members: z.number().int(),
});
export type ScheduleSummary = z.infer<typeof ScheduleSummary>;

// ───────────── Catálogo (Fase 3) ─────────────

export const CatalogStatus = z.enum(["ACTIVE", "INACTIVE"]);
export const ProductKind = z.enum(["GOODS", "SERVICE"]);

const MasterCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._-]{0,29}$/, "Hasta 30 caracteres: letras, números, punto, guion o guion bajo");

export const UnitInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,8}$/, "Hasta 8 letras o números"),
  name: z.string().trim().min(2).max(40),
  /** Decimales admitidos en cantidades de esta unidad (0 = enteros). */
  decimals: z.number().int().min(0).max(6),
});
export type UnitInput = z.infer<typeof UnitInput>;
export const UnitPatch = UnitInput.omit({ code: true }).partial().extend({ status: CatalogStatus.optional() });
export type UnitPatch = z.infer<typeof UnitPatch>;
export const UnitSummary = z.object({
  id: Uuid, code: z.string(), name: z.string(), decimals: z.number().int(), status: CatalogStatus, products: z.number().int(),
});
export type UnitSummary = z.infer<typeof UnitSummary>;

export const CategoryInput = z.object({
  code: MasterCode,
  name: z.string().trim().min(2).max(80),
  parentId: Uuid.nullable().optional(),
});
export type CategoryInput = z.infer<typeof CategoryInput>;
export const CategoryPatch = CategoryInput.omit({ code: true }).partial().extend({ status: CatalogStatus.optional() });
export type CategoryPatch = z.infer<typeof CategoryPatch>;
export const CategorySummary = z.object({
  id: Uuid, code: z.string(), name: z.string(), parentId: Uuid.nullable(), status: CatalogStatus, products: z.number().int(),
});
export type CategorySummary = z.infer<typeof CategorySummary>;

export const BrandInput = z.object({ name: z.string().trim().min(2).max(60) });
export type BrandInput = z.infer<typeof BrandInput>;
export const BrandPatch = BrandInput.partial().extend({ status: CatalogStatus.optional() });
export type BrandPatch = z.infer<typeof BrandPatch>;
export const BrandSummary = z.object({ id: Uuid, name: z.string(), status: CatalogStatus, products: z.number().int() });
export type BrandSummary = z.infer<typeof BrandSummary>;

export const Barcode = z.string().trim().regex(/^[A-Za-z0-9._-]{3,64}$/, "De 3 a 64 caracteres: letras, números, punto, guion o guion bajo");
const Factor = z
  .number()
  .positive("Debe ser mayor que cero")
  .max(1_000_000_000)
  .refine((f) => Math.abs(f * 1e6 - Math.round(f * 1e6)) < 1e-6, "Máximo 6 decimales");

const productFields = {
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).optional(),
  kind: ProductKind.default("GOODS"),
  categoryId: Uuid.nullable().optional(),
  brandId: Uuid.nullable().optional(),
  /** Perfil fiscal (capa 2): qué tributos aplican a este producto. */
  taxProfileId: Uuid.nullable().optional(),
  baseUnitId: Uuid,
  trackLots: z.boolean().default(false),
  trackExpiry: z.boolean().default(false),
  barcodes: z.array(z.object({ barcode: Barcode, unitId: Uuid.nullable().optional() })).max(20).default([]),
  /** 1 unidad `unitId` = `factor` unidades base. */
  conversions: z.array(z.object({ unitId: Uuid, factor: Factor })).max(10).default([]),
};

export const ProductInput = z
  .object({ /** Vacío = se genera el siguiente correlativo. */ code: MasterCode.optional().or(z.literal("").transform(() => undefined)), ...productFields })
  .refine((p) => !p.trackExpiry || p.trackLots, { message: "El control de vencimiento requiere control por lote", path: ["trackExpiry"] })
  .refine((p) => p.kind === "GOODS" || (!p.trackLots && !p.trackExpiry), { message: "Un servicio no lleva lote ni vencimiento", path: ["kind"] });
export type ProductInput = z.infer<typeof ProductInput>;

/** El código no cambia. La unidad base tampoco, una vez creado el producto. */
export const ProductPatch = z
  .object({ ...productFields, status: CatalogStatus })
  .omit({ baseUnitId: true })
  .partial();
export type ProductPatch = z.infer<typeof ProductPatch>;

export const ProductSummary = z.object({
  id: Uuid,
  code: z.string(),
  name: z.string(),
  kind: ProductKind,
  status: CatalogStatus,
  category: z.object({ id: Uuid, name: z.string() }).nullable(),
  brand: z.object({ id: Uuid, name: z.string() }).nullable(),
  taxProfile: z.object({ id: Uuid, code: z.string(), name: z.string() }).nullable(),
  baseUnit: z.object({ id: Uuid, code: z.string(), decimals: z.number().int() }),
  trackLots: z.boolean(),
  trackExpiry: z.boolean(),
  /** Foto principal (y su miniatura) si la tiene. */
  imageUrl: z.string().nullable().optional(),
  thumbUrl: z.string().nullable().optional(),
  /** Familia de variantes a la que pertenece y su descripción («M / Rojo»). */
  group: z.object({ id: Uuid, name: z.string() }).nullable().optional(),
  variantLabel: z.string().nullable().optional(),
});
export type ProductSummary = z.infer<typeof ProductSummary>;

export const ProductDetail = ProductSummary.extend({
  description: z.string().nullable(),
  barcodes: z.array(z.object({ barcode: z.string(), unitId: Uuid.nullable() })),
  conversions: z.array(z.object({ unitId: Uuid, unitCode: z.string(), factor: z.string() })),
});
export type ProductDetail = z.infer<typeof ProductDetail>;

export const ProductListQuery = z.object({
  q: z.string().trim().max(80).optional(),
  categoryId: Uuid.optional(),
  brandId: Uuid.optional(),
  kind: ProductKind.optional(),
  status: CatalogStatus.optional(),
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ProductListQuery = z.infer<typeof ProductListQuery>;

export const ProductList = z.object({ items: z.array(ProductSummary), nextCursor: z.string().nullable() });
export type ProductList = z.infer<typeof ProductList>;

// ───────────── Listas de precios (Fase 3) ─────────────

export const PriceMode = z.enum(["WITH_TAX", "WITHOUT_TAX"]);
export const ScalingMode = z.enum(["TIER_THRESHOLD", "PROGRESSIVE"]);
export const PriceListScope = z.enum(["TENANT", "BRANCH", "CHANNEL"]);
export const SalesChannel = z.enum(["POS", "ECOMMERCE", "MESSAGING"]);
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");

export const PriceListInput = z
  .object({
    code: MasterCode,
    name: z.string().trim().min(2).max(80),
    priceMode: PriceMode,
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Código de 3 letras (p. ej. BOB)").default("BOB"),
    scope: PriceListScope.default("TENANT"),
    branchId: Uuid.nullable().optional(),
    channel: SalesChannel.nullable().optional(),
    scalingMode: ScalingMode.default("TIER_THRESHOLD"),
    validFrom: DateOnly.nullable().optional(),
    validTo: DateOnly.nullable().optional(),
    priority: z.number().int().min(-1000).max(1000).default(0),
    roundingDecimals: z.number().int().min(0).max(4).default(2),
  })
  .refine((l) => (l.scope === "BRANCH") === !!l.branchId, { message: "Indica la sucursal (solo para listas por sucursal)", path: ["branchId"] })
  .refine((l) => (l.scope === "CHANNEL") === !!l.channel, { message: "Indica el canal (solo para listas por canal)", path: ["channel"] })
  .refine((l) => !l.validFrom || !l.validTo || l.validTo >= l.validFrom, { message: "La vigencia final no puede ser anterior a la inicial", path: ["validTo"] });
export type PriceListInput = z.infer<typeof PriceListInput>;

/** El código, el ámbito y la modalidad no cambian (la modalidad, si ya hay precios cargados). */
export const PriceListPatch = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  scalingMode: ScalingMode.optional(),
  validFrom: DateOnly.nullable().optional(),
  validTo: DateOnly.nullable().optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
  roundingDecimals: z.number().int().min(0).max(4).optional(),
  priceMode: PriceMode.optional(),
  status: CatalogStatus.optional(),
});
export type PriceListPatch = z.infer<typeof PriceListPatch>;

export const PriceListSummary = z.object({
  id: Uuid, code: z.string(), name: z.string(), priceMode: PriceMode, currency: z.string(), scope: PriceListScope,
  branch: z.object({ id: Uuid, code: z.string() }).nullable(), channel: SalesChannel.nullable(), scalingMode: ScalingMode,
  validFrom: z.string().nullable(), validTo: z.string().nullable(), priority: z.number().int(), roundingDecimals: z.number().int(),
  status: CatalogStatus, products: z.number().int(),
});
export type PriceListSummary = z.infer<typeof PriceListSummary>;

export const TierInput = z.object({
  minQuantity: z.number().positive(),
  maxQuantity: z.number().positive().nullable().optional(),
  unitPrice: z.number().min(0),
});
export const SetPricesRequest = z.object({ tiers: z.array(TierInput).min(1).max(20) });
export type SetPricesRequest = z.infer<typeof SetPricesRequest>;

export const ProductPriceRow = z.object({
  productId: Uuid, code: z.string(), name: z.string(), unit: z.string(), status: CatalogStatus,
  tiers: z.array(z.object({ minQuantity: z.string(), maxQuantity: z.string().nullable(), unitPrice: z.string() })),
});
export type ProductPriceRow = z.infer<typeof ProductPriceRow>;
export const PriceRowList = z.object({ items: z.array(ProductPriceRow), nextCursor: z.string().nullable() });
export type PriceRowList = z.infer<typeof PriceRowList>;

export const QuoteRequest = z.object({
  productId: Uuid,
  quantity: z.number().positive().max(1_000_000_000),
  /** Si se indica, solo se usa esa lista. Si no, se elige por sucursal/canal/general. */
  priceListId: Uuid.optional(),
  branchId: Uuid.optional(),
  channel: SalesChannel.optional(),
  /** Fecha de vigencia AAAA-MM-DD (hoy por defecto). */
  at: DateOnly.optional(),
});
export type QuoteRequest = z.infer<typeof QuoteRequest>;

export const QuoteResponse = z.object({
  product: z.object({ id: Uuid, code: z.string(), name: z.string() }),
  priceList: z.object({ id: Uuid, code: z.string(), name: z.string(), priceMode: PriceMode, scalingMode: ScalingMode, currency: z.string() }),
  /** Por qué se eligió esta lista. */
  resolvedBy: z.enum(["EXPLICIT", "BRANCH", "CHANNEL", "GENERAL"]),
  quantity: z.string(),
  unitPrice: z.string(),
  /** Importe de la línea tal como está en la lista (con o sin impuestos según la modalidad). */
  lineAmount: z.string(),
  breakdown: z.array(z.object({ tierMin: z.string(), quantity: z.string(), unitPrice: z.string(), amount: z.string() })),
  tax: z.object({
    priceMode: PriceMode, net: z.string(), taxTotal: z.string(), total: z.string(),
    taxes: z.array(z.object({ code: z.string(), rate: z.string(), base: z.string(), amount: z.string(), exempt: z.boolean(), exemptionReason: z.string().nullable() })),
  }),
});
export type QuoteResponse = z.infer<typeof QuoteResponse>;

// ───────────── Impuestos: capas 1 y 2 ─────────────

export const TaxRateInput = z.object({
  /** Porcentaje (13 = 13 %), hasta 6 decimales. */
  rate: z.number().min(0).max(100).refine((r) => Math.abs(r * 1e6 - Math.round(r * 1e6)) < 1e-6, "Máximo 6 decimales"),
  validFrom: DateOnly,
});
export type TaxRateInput = z.infer<typeof TaxRateInput>;

export const TaxCodeInput = z.object({
  code: MasterCode,
  name: z.string().trim().min(2).max(80),
  jurisdiction: z.string().trim().max(60).optional(),
  rate: TaxRateInput,
});
export type TaxCodeInput = z.infer<typeof TaxCodeInput>;
export const TaxCodePatch = z.object({ name: z.string().trim().min(2).max(80).optional(), jurisdiction: z.string().trim().max(60).nullable().optional(), status: CatalogStatus.optional() });
export type TaxCodePatch = z.infer<typeof TaxCodePatch>;
export const TaxCodeSummary = z.object({
  id: Uuid, code: z.string(), name: z.string(), jurisdiction: z.string().nullable(), status: CatalogStatus,
  /** Tasa vigente hoy (null si ninguna cubre la fecha). */
  currentRate: z.string().nullable(),
  rates: z.array(z.object({ rate: z.string(), validFrom: z.string(), validTo: z.string().nullable() })),
});
export type TaxCodeSummary = z.infer<typeof TaxCodeSummary>;

export const TaxRuleInput = z.object({
  taxCodeId: Uuid,
  priority: z.number().int().min(0).max(1000).default(0),
  exemptionReason: z.string().trim().min(3).max(200).nullable().optional(),
  validFrom: DateOnly.nullable().optional(),
  validTo: DateOnly.nullable().optional(),
});
export const TaxProfileInput = z.object({
  code: MasterCode,
  name: z.string().trim().min(2).max(80),
  appliesTo: z.enum(["PRODUCT", "CUSTOMER", "OPERATION"]).default("PRODUCT"),
  rules: z.array(TaxRuleInput).max(20).default([]),
});
export type TaxProfileInput = z.infer<typeof TaxProfileInput>;
export const TaxProfilePatch = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  status: CatalogStatus.optional(),
  rules: z.array(TaxRuleInput).max(20).optional(),
});
export type TaxProfilePatch = z.infer<typeof TaxProfilePatch>;
export const TaxProfileSummary = z.object({
  id: Uuid, code: z.string(), name: z.string(), appliesTo: z.enum(["PRODUCT", "CUSTOMER", "OPERATION"]), status: CatalogStatus, products: z.number().int(),
  rules: z.array(z.object({
    taxCodeId: Uuid, taxCode: z.string(), priority: z.number().int(), exemptionReason: z.string().nullable(),
    validFrom: z.string().nullable(), validTo: z.string().nullable(),
  })),
});
export type TaxProfileSummary = z.infer<typeof TaxProfileSummary>;

// ───────────── Importación y exportación Excel (Fase 3) ─────────────

export const ImportKind = z.enum(["PRODUCTS", "PRICES"]);
export type ImportKind = z.infer<typeof ImportKind>;

export const ImportPreviewRequest = z
  .object({
    kind: ImportKind,
    fileName: z.string().trim().min(1).max(200),
    /** Contenido del .xlsx en base64 (máx. 5 MB). */
    contentBase64: z.string().min(20).max(7_500_000),
    /** Obligatorio para importar precios: lista de destino. */
    priceListId: Uuid.optional(),
  })
  .refine((r) => r.kind !== "PRICES" || !!r.priceListId, { message: "Indica la lista de precios de destino", path: ["priceListId"] });
export type ImportPreviewRequest = z.infer<typeof ImportPreviewRequest>;

export const ImportConfirmRequest = z.object({ skipInvalid: z.boolean().default(false) });
export type ImportConfirmRequest = z.infer<typeof ImportConfirmRequest>;

export const ImportError = z.object({ row: z.number().int(), message: z.string() });
export const ImportPreview = z.object({
  jobId: Uuid,
  kind: ImportKind,
  status: z.enum(["PREVIEWED", "APPLIED", "FAILED"]),
  fileName: z.string(),
  totals: z.object({ rows: z.number().int(), valid: z.number().int(), errors: z.number().int(), create: z.number().int(), update: z.number().int() }),
  errors: z.array(ImportError),
  sample: z.array(z.object({ row: z.number().int(), action: z.string(), key: z.string(), summary: z.string() })),
});
export type ImportPreview = z.infer<typeof ImportPreview>;

export const ImportResult = z.object({ jobId: Uuid, created: z.number().int(), updated: z.number().int(), skipped: z.number().int() });
export type ImportResult = z.infer<typeof ImportResult>;

export const ImportJobSummary = z.object({
  id: Uuid, kind: ImportKind, status: z.enum(["PREVIEWED", "APPLIED", "FAILED"]), fileName: z.string(),
  totals: z.object({ rows: z.number().int(), valid: z.number().int(), errors: z.number().int(), create: z.number().int(), update: z.number().int() }),
  createdAt: z.string(), appliedAt: z.string().nullable(),
});
export type ImportJobSummary = z.infer<typeof ImportJobSummary>;

export const ExcelFile = z.object({ fileName: z.string(), contentBase64: z.string() });
export type ExcelFile = z.infer<typeof ExcelFile>;

// ───────────── Inventario (Fase 4a) ─────────────

export const ValuationMethod = z.enum(["FIFO", "LIFO", "AVERAGE"]);
export type ValuationMethod = z.infer<typeof ValuationMethod>;
export const MovementType = z.enum(["RECEIPT", "ISSUE", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "TRANSFER_OUT", "TRANSFER_IN", "REVALUATION"]);
export type MovementType = z.infer<typeof MovementType>;

export const WarehouseInput = z.object({ branchId: Uuid, code: MasterCode, name: z.string().trim().min(2).max(80) });
export type WarehouseInput = z.infer<typeof WarehouseInput>;
export const WarehousePatch = z.object({ name: z.string().trim().min(2).max(80).optional(), status: CatalogStatus.optional() });
export type WarehousePatch = z.infer<typeof WarehousePatch>;
export const WarehouseSummary = z.object({
  id: Uuid, code: z.string(), name: z.string(), kind: z.enum(["STORAGE", "TRANSIT"]), status: CatalogStatus,
  branch: z.object({ id: Uuid, code: z.string(), name: z.string() }),
});
export type WarehouseSummary = z.infer<typeof WarehouseSummary>;

export const LotInput = z.object({
  code: z.string().trim().min(1).max(40).optional(),
  manufacturedOn: DateOnly.nullable().optional(),
  expiresOn: DateOnly.nullable().optional(),
  externalRef: z.string().trim().max(60).nullable().optional(),
});
export type LotInput = z.infer<typeof LotInput>;

export const AdjustmentLineInput = z.object({
  productId: Uuid,
  /** Con signo: positiva suma stock, negativa lo descuenta. */
  quantity: z.number().refine((n) => n !== 0, "La cantidad no puede ser cero").refine((n) => Math.abs(n) <= 1_000_000_000, "Cantidad demasiado grande"),
  /** Obligatorio al sumar stock (define el costo del lote nuevo). Se ignora al descontar. */
  unitCost: z.number().min(0).max(1_000_000_000).optional(),
  /** Al descontar: lote concreto (si no, se elige según el método de valoración). */
  lotId: Uuid.optional(),
  /** Al sumar: datos del lote nuevo. */
  lot: LotInput.optional(),
});
export const AdjustmentRequest = z.object({
  warehouseId: Uuid,
  reason: z.string().trim().min(3).max(120),
  note: z.string().trim().max(500).optional(),
  lines: z.array(AdjustmentLineInput).min(1).max(50),
});
export type AdjustmentRequest = z.infer<typeof AdjustmentRequest>;

export const AdjustmentSummary = z.object({
  id: Uuid, code: z.string(), reason: z.string(), note: z.string().nullable(), createdAt: z.string(),
  warehouse: z.object({ id: Uuid, code: z.string(), name: z.string() }),
  lines: z.array(z.object({ productId: Uuid, productCode: z.string(), lotCode: z.string().nullable(), quantity: z.string(), unitCost: z.string() })),
});
export type AdjustmentSummary = z.infer<typeof AdjustmentSummary>;

export const StockQuery = z.object({
  warehouseId: Uuid.optional(),
  productId: Uuid.optional(),
  q: z.string().trim().max(80).optional(),
  cursor: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type StockQuery = z.infer<typeof StockQuery>;
export const StockRow = z.object({
  productId: Uuid, code: z.string(), name: z.string(), unit: z.string(), trackLots: z.boolean(),
  warehouse: z.object({ id: Uuid, code: z.string(), name: z.string() }),
  physicalQty: z.string(), reservedQty: z.string(), availableQty: z.string(), value: z.string(), averageCost: z.string(),
});
export type StockRow = z.infer<typeof StockRow>;
export const StockList = z.object({ items: z.array(StockRow), nextCursor: z.string().nullable() });
export type StockList = z.infer<typeof StockList>;
export const LotBalanceRow = z.object({
  lotId: Uuid, lotCode: z.string(), receivedAt: z.string(), expiresOn: z.string().nullable(), unitCost: z.string(), status: z.enum(["ACTIVE", "BLOCKED"]),
  warehouse: z.object({ id: Uuid, code: z.string() }), physicalQty: z.string(), reservedQty: z.string(), availableQty: z.string(),
});
export type LotBalanceRow = z.infer<typeof LotBalanceRow>;

export const KardexQuery = z.object({
  productId: Uuid,
  warehouseId: Uuid.optional(),
  lotId: Uuid.optional(),
  from: DateOnly.optional(),
  to: DateOnly.optional(),
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type KardexQuery = z.infer<typeof KardexQuery>;
export const KardexRow = z.object({
  id: Uuid, seq: z.string(), occurredAt: z.string(), type: MovementType,
  warehouse: z.object({ id: Uuid, code: z.string() }), lot: z.object({ id: Uuid, code: z.string() }).nullable(),
  quantity: z.string(), unitCost: z.string(), totalCost: z.string(),
  /** Saldo del almacén después del movimiento. */
  balanceAfter: z.string(),
  reasonCode: z.string().nullable(), note: z.string().nullable(), actorId: Uuid.nullable(), reversalOfId: Uuid.nullable(),
});
export type KardexRow = z.infer<typeof KardexRow>;
export const KardexList = z.object({ items: z.array(KardexRow), nextCursor: z.string().nullable() });
export type KardexList = z.infer<typeof KardexList>;

export const ReverseRequest = z.object({ reason: z.string().trim().min(3).max(200) });
export type ReverseRequest = z.infer<typeof ReverseRequest>;

export const ValuationPolicyInput = z.object({ productId: Uuid.nullable().optional(), method: ValuationMethod });
export type ValuationPolicyInput = z.infer<typeof ValuationPolicyInput>;
export const ValuationPolicySummary = z.object({
  id: Uuid, productId: Uuid.nullable(), productCode: z.string().nullable(), method: ValuationMethod, effectiveFrom: z.string(),
});
export type ValuationPolicySummary = z.infer<typeof ValuationPolicySummary>;

// ───────────── Compras (Fase 4b) ─────────────

export const PurchaseStatus = z.enum(["DRAFT", "ISSUED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"]);
export type PurchaseStatus = z.infer<typeof PurchaseStatus>;

const optText = (max: number) => z.string().trim().max(max).nullable().optional();

export const SupplierInput = z.object({
  code: MasterCode,
  name: z.string().trim().min(2).max(120),
  taxId: optText(30),
  contactName: optText(80),
  /** Cargo de la persona de contacto (p. ej. «Gerente de ventas»). */
  contactRole: optText(80),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email().max(120)]).nullable().optional(),
  phone: optText(30),
  address: optText(200),
  paymentTermsDays: z.number().int().min(0).max(365).default(0),
});
export type SupplierInput = z.infer<typeof SupplierInput>;
export const SupplierPatch = SupplierInput.omit({ code: true }).partial().extend({ status: CatalogStatus.optional() });
export type SupplierPatch = z.infer<typeof SupplierPatch>;
export const SupplierSummary = z.object({
  id: Uuid, code: z.string(), name: z.string(), taxId: z.string().nullable(), contactName: z.string().nullable(), contactRole: z.string().nullable(), email: z.string().nullable(),
  phone: z.string().nullable(), address: z.string().nullable(), paymentTermsDays: z.number().int(), status: CatalogStatus, orders: z.number().int(),
});
export type SupplierSummary = z.infer<typeof SupplierSummary>;

// Cuentas bancarias del proveedor, historial y boleta de depósito.
export const BankAccountType = z.enum(["CHECKING", "SAVINGS"]);
export type BankAccountType = z.infer<typeof BankAccountType>;
export const BankAccountInput = z.object({
  bankName: z.string().trim().min(2).max(80),
  accountNumber: z.string().trim().min(4).max(40).regex(/^[0-9A-Za-z][0-9A-Za-z .\-/]*$/, "El número de cuenta solo admite letras, números, espacios, punto, guion o barra."),
  accountType: BankAccountType.default("CHECKING"),
  currency: z.enum(["BOB", "USD"]).default("BOB"),
  holderName: z.string().trim().min(2).max(120),
  holderTaxId: optText(30),
  notes: optText(200),
  isDefault: z.boolean().default(false),
});
export type BankAccountInput = z.infer<typeof BankAccountInput>;
export const BankAccountPatch = BankAccountInput.partial().extend({ status: CatalogStatus.optional() });
export type BankAccountPatch = z.infer<typeof BankAccountPatch>;
export const BankAccountView = z.object({
  id: Uuid, supplierId: Uuid, bankName: z.string(), accountNumber: z.string(), accountType: BankAccountType, currency: z.string(), holderName: z.string(),
  holderTaxId: z.string().nullable(), notes: z.string().nullable(), isDefault: z.boolean(), status: CatalogStatus, createdAt: z.string(), updatedAt: z.string(),
});
export type BankAccountView = z.infer<typeof BankAccountView>;
export const SupplierHistoryEntry = z.object({
  id: Uuid, kind: z.string(), summary: z.string(), before: z.unknown().nullable(), after: z.unknown().nullable(), actor: z.string().nullable(), createdAt: z.string(),
});
export type SupplierHistoryEntry = z.infer<typeof SupplierHistoryEntry>;
/** Datos que se piden al imprimir la boleta de depósito (lo demás sale de la cuenta del proveedor). */
export const DepositVoucherParams = z.object({
  amount: z.coerce.number().positive().max(1_000_000_000).optional(),
  concept: z.string().trim().max(120).optional(),
});
export type DepositVoucherParams = z.infer<typeof DepositVoucherParams>;

export const PurchaseLineInput = z.object({
  productId: Uuid,
  quantity: z.number().positive().max(1_000_000_000),
  unitCost: z.number().min(0).max(1_000_000_000),
});
export const PurchaseOrderInput = z.object({
  supplierId: Uuid,
  warehouseId: Uuid,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Código de 3 letras (p. ej. BOB)").default("BOB"),
  expectedOn: DateOnly.nullable().optional(),
  note: optText(500),
  lines: z.array(PurchaseLineInput).min(1).max(100),
});
export type PurchaseOrderInput = z.infer<typeof PurchaseOrderInput>;
export const PurchaseOrderPatch = z.object({
  supplierId: Uuid.optional(),
  warehouseId: Uuid.optional(),
  expectedOn: DateOnly.nullable().optional(),
  note: optText(500),
  lines: z.array(PurchaseLineInput).min(1).max(100).optional(),
});
export type PurchaseOrderPatch = z.infer<typeof PurchaseOrderPatch>;

export const PurchaseOrderSummary = z.object({
  id: Uuid, code: z.string(), status: PurchaseStatus, currency: z.string(), expectedOn: z.string().nullable(), note: z.string().nullable(),
  createdAt: z.string(), issuedAt: z.string().nullable(), total: z.string(),
  supplier: z.object({ id: Uuid, code: z.string(), name: z.string() }), warehouse: z.object({ id: Uuid, code: z.string(), name: z.string() }),
});
export type PurchaseOrderSummary = z.infer<typeof PurchaseOrderSummary>;
export const PurchaseOrderDetail = PurchaseOrderSummary.extend({
  lines: z.array(z.object({
    id: Uuid, productId: Uuid, productCode: z.string(), productName: z.string(), unit: z.string(), trackLots: z.boolean(), trackExpiry: z.boolean(),
    quantity: z.string(), unitCost: z.string(), receivedQty: z.string(), pendingQty: z.string(),
  })),
  receipts: z.array(z.object({ id: Uuid, code: z.string(), status: z.enum(["POSTED", "VOIDED"]), createdAt: z.string() })),
});
export type PurchaseOrderDetail = z.infer<typeof PurchaseOrderDetail>;

export const ReceiptLineInput = z.object({
  /** Recepción contra una orden: línea de la orden (el producto y el costo salen de ella). */
  orderLineId: Uuid.optional(),
  /** Recepción directa (sin orden): producto y costo. */
  productId: Uuid.optional(),
  unitCost: z.number().min(0).max(1_000_000_000).optional(),
  quantity: z.number().positive().max(1_000_000_000),
  lot: LotInput.optional(),
});
export const GoodsReceiptInput = z
  .object({
    orderId: Uuid.optional(),
    supplierId: Uuid.optional(),
    warehouseId: Uuid.optional(),
    supplierRef: optText(60),
    note: optText(500),
    lines: z.array(ReceiptLineInput).min(1).max(100),
  })
  .refine((r) => !!r.orderId || (!!r.supplierId && !!r.warehouseId), { message: "Indica la orden, o el proveedor y el almacén", path: ["orderId"] })
  .refine((r) => r.lines.every((l) => (r.orderId ? !!l.orderLineId : !!l.productId && l.unitCost !== undefined)), { message: "Cada línea necesita la línea de la orden (con orden) o producto y costo (directa)", path: ["lines"] });
export type GoodsReceiptInput = z.infer<typeof GoodsReceiptInput>;

export const GoodsReceiptSummary = z.object({
  id: Uuid, code: z.string(), status: z.enum(["POSTED", "VOIDED"]), supplierRef: z.string().nullable(), note: z.string().nullable(),
  createdAt: z.string(), voidedAt: z.string().nullable(), voidReason: z.string().nullable(), total: z.string(),
  supplier: z.object({ id: Uuid, code: z.string(), name: z.string() }), warehouse: z.object({ id: Uuid, code: z.string(), name: z.string() }),
  order: z.object({ id: Uuid, code: z.string() }).nullable(),
  lines: z.array(z.object({ productCode: z.string(), productName: z.string(), lotCode: z.string(), quantity: z.string(), unitCost: z.string() })),
});
export type GoodsReceiptSummary = z.infer<typeof GoodsReceiptSummary>;

// ───────────── Transferencias y conteos físicos (Fase 4c) ─────────────

export const TransferStatus = z.enum(["DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"]);
export type TransferStatus = z.infer<typeof TransferStatus>;

export const TransferInput = z
  .object({
    fromWarehouseId: Uuid,
    toWarehouseId: Uuid,
    note: z.string().trim().max(500).nullable().optional(),
    lines: z.array(z.object({ productId: Uuid, quantity: z.number().positive().max(1_000_000_000) })).min(1).max(100),
  })
  .refine((t) => t.fromWarehouseId !== t.toWarehouseId, { message: "El origen y el destino deben ser distintos", path: ["toWarehouseId"] });
export type TransferInput = z.infer<typeof TransferInput>;

/** Cantidades recibidas por línea (sin indicar nada se recibe todo lo despachado). Lo que falte se da de baja como pérdida en tránsito. */
export const TransferReceiveRequest = z.object({
  lines: z.array(z.object({ lineId: Uuid, receivedQty: z.number().min(0) })).max(100).optional(),
  note: z.string().trim().max(300).optional(),
});
export type TransferReceiveRequest = z.infer<typeof TransferReceiveRequest>;

export const TransferSummary = z.object({
  id: Uuid, code: z.string(), status: TransferStatus, note: z.string().nullable(),
  from: z.object({ id: Uuid, code: z.string(), name: z.string() }), to: z.object({ id: Uuid, code: z.string(), name: z.string() }),
  createdAt: z.string(), dispatchedAt: z.string().nullable(), receivedAt: z.string().nullable(),
  lines: z.array(z.object({
    id: Uuid, productId: Uuid, productCode: z.string(), productName: z.string(), unit: z.string(), quantity: z.string(), receivedQty: z.string(),
    lots: z.array(z.object({ lotCode: z.string(), quantity: z.string(), receivedQty: z.string(), unitCost: z.string() })),
  })),
});
export type TransferSummary = z.infer<typeof TransferSummary>;

export const CountStatus = z.enum(["OPEN", "SUBMITTED", "APPLIED", "CANCELLED"]);
export type CountStatus = z.infer<typeof CountStatus>;
export const CountInput = z.object({
  warehouseId: Uuid,
  note: z.string().trim().max(300).nullable().optional(),
  /** Si se indica, solo se cuentan esos productos; si no, todo el almacén. */
  productIds: z.array(Uuid).max(500).optional(),
});
export type CountInput = z.infer<typeof CountInput>;
export const CountEntry = z.object({ lines: z.array(z.object({ lineId: Uuid, countedQty: z.number().min(0).nullable() })).min(1).max(2000) });
export type CountEntry = z.infer<typeof CountEntry>;
export const CountSummary = z.object({
  id: Uuid, code: z.string(), status: CountStatus, note: z.string().nullable(), createdAt: z.string(), appliedAt: z.string().nullable(),
  warehouse: z.object({ id: Uuid, code: z.string(), name: z.string() }),
  totals: z.object({ lines: z.number().int(), counted: z.number().int(), withDifference: z.number().int() }),
});
export type CountSummary = z.infer<typeof CountSummary>;
export const CountDetail = CountSummary.extend({
  lines: z.array(z.object({
    id: Uuid, productCode: z.string(), productName: z.string(), unit: z.string(), lotCode: z.string(), expiresOn: z.string().nullable(),
    expectedQty: z.string(), countedQty: z.string().nullable(), difference: z.string().nullable(), unitCost: z.string(),
  })),
  /** Valor de la diferencia neta (positivo = sobrante). */
  differenceValue: z.string(),
});
export type CountDetail = z.infer<typeof CountDetail>;

// ───────────── Clientes, cotizaciones y ventas (Fase 5a) ─────────────

export const PaymentMethod = z.enum(["CASH", "TRANSFER", "QR", "CARD", "CHEQUE"]);
export type PaymentMethod = z.infer<typeof PaymentMethod>;
export const SaleStatus = z.enum(["DRAFT", "CONFIRMED", "CANCELLED"]);
export type SaleStatus = z.infer<typeof SaleStatus>;
export const SalePaymentStatus = z.enum(["UNPAID", "PARTIAL", "PAID"]);
export type SalePaymentStatus = z.infer<typeof SalePaymentStatus>;
export const QuoteStatus = z.enum(["DRAFT", "SENT", "ACCEPTED", "REJECTED", "CANCELLED"]);
export type QuoteStatus = z.infer<typeof QuoteStatus>;

const optStr = (max: number) => z.string().trim().max(max).nullable().optional();

export const CustomerInput = z.object({
  /** Vacío = correlativo automático (C-000001…). */
  code: MasterCode.optional(),
  name: z.string().trim().min(2).max(120),
  taxId: optStr(30),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email().max(120)]).nullable().optional(),
  phone: optStr(30),
  address: optStr(200),
  defaultPriceListId: Uuid.nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).default(0),
  creditLimit: z.number().min(0).max(1_000_000_000).nullable().optional(),
});
export type CustomerInput = z.infer<typeof CustomerInput>;
export const CustomerPatch = CustomerInput.omit({ code: true }).partial().extend({ status: CatalogStatus.optional() });
export type CustomerPatch = z.infer<typeof CustomerPatch>;
export const CustomerSummary = z.object({
  id: Uuid, code: z.string(), name: z.string(), taxId: z.string().nullable(), email: z.string().nullable(), phone: z.string().nullable(), address: z.string().nullable(),
  defaultPriceList: z.object({ id: Uuid, code: z.string(), name: z.string() }).nullable(), paymentTermsDays: z.number().int(), creditLimit: z.string().nullable(),
  status: CatalogStatus,
  /** Ventas confirmadas aún sin cobrar. */
  outstanding: z.string(),
});
export type CustomerSummary = z.infer<typeof CustomerSummary>;

export const DocLineInput = z
  .object({
    productId: Uuid,
    quantity: z.number().positive().max(1_000_000_000),
    /** Requiere el permiso de descuentos. */
    discountPct: z.number().min(0).max(100).default(0),
    /** Precio unitario distinto al de la lista (en la misma modalidad que la lista). Requiere permiso y motivo. */
    unitPrice: z.number().min(0).max(1_000_000_000).optional(),
    overrideReason: z.string().trim().min(3).max(200).optional(),
  })
  .refine((l) => (l.unitPrice === undefined) === (l.overrideReason === undefined), { message: "Un precio cambiado a mano necesita su motivo (y viceversa)", path: ["overrideReason"] });
export type DocLineInput = z.infer<typeof DocLineInput>;

export const SaleInput = z.object({
  warehouseId: Uuid,
  customerId: Uuid.nullable().optional(),
  /** Si se indica, todas las líneas se cotizan con esa lista; si no, la del cliente o la que corresponda por sucursal y canal. */
  priceListId: Uuid.nullable().optional(),
  channel: SalesChannel.default("POS"),
  /** true = con impuestos (CF); false = sin impuestos (SF). */
  withTax: z.boolean().default(true),
  /** Nombre y NIT/CI para el comprobante. */
  billingName: optStr(120),
  billingTaxId: optStr(30),
  note: optStr(500),
  lines: z.array(DocLineInput).min(1).max(200),
});
export type SaleInput = z.infer<typeof SaleInput>;
export const SalePatch = z.object({
  warehouseId: Uuid.optional(),
  customerId: Uuid.nullable().optional(),
  priceListId: Uuid.nullable().optional(),
  withTax: z.boolean().optional(),
  billingName: optStr(120),
  billingTaxId: optStr(30),
  note: optStr(500),
  lines: z.array(DocLineInput).min(1).max(200).optional(),
});
export type SalePatch = z.infer<typeof SalePatch>;

export const PaymentInput = z.object({
  method: PaymentMethod,
  amount: z.number().positive().max(1_000_000_000),
  reference: optStr(80),
  /** Sesión de caja en la que se recibe (si hay una sola abierta a tu nombre en la sucursal, se elige sola). */
  cashSessionId: Uuid.optional(),
});
export type PaymentInput = z.infer<typeof PaymentInput>;

export const TaxBreakdown = z.object({ code: z.string(), rate: z.string(), base: z.string(), amount: z.string(), exempt: z.boolean(), exemptionReason: z.string().nullable() });
export const DocLineView = z.object({
  id: Uuid, productId: Uuid, productCode: z.string(), productName: z.string(), unit: z.string(), quantity: z.string(),
  priceListCode: z.string(), priceMode: PriceMode, listUnitPrice: z.string(), discountPct: z.string(),
  /** Precio realmente aplicado si se cambió a mano (nulo = el de la lista) y su motivo. */
  appliedUnitPrice: z.string().nullable(), overrideReason: z.string().nullable(),
  /** Venta: cantidad ya devuelta de esta línea. */
  returnedQty: z.string().optional(),
  netAmount: z.string(), taxAmount: z.string(), totalAmount: z.string(), taxes: z.array(TaxBreakdown),
  lots: z.array(z.object({ lotCode: z.string(), quantity: z.string(), unitCost: z.string() })),
  costTotal: z.string().nullable(),
  /** Categoría del producto con su ruta («FERRETERIA / LIJAS DE AGUA»); solo en el detalle de una venta. */
  category: z.string().nullable().optional(),
});
export type DocLineView = z.infer<typeof DocLineView>;

export const SaleSummary = z.object({
  id: Uuid, code: z.string().nullable(), status: SaleStatus, paymentStatus: SalePaymentStatus, currency: z.string(),
  customer: z.object({ id: Uuid, code: z.string(), name: z.string(), taxId: z.string().nullable().optional(), phone: z.string().nullable().optional() }).nullable(), warehouse: z.object({ id: Uuid, code: z.string(), name: z.string() }),
  total: z.string(), paidTotal: z.string(), balance: z.string(), createdAt: z.string(), confirmedAt: z.string().nullable(),
  /** Importe devuelto (notas de crédito) y dinero reintegrado. El saldo = total − devuelto − (cobrado − reintegrado). */
  returnedTotal: z.string(), refundedTotal: z.string(),
});
export type SaleSummary = z.infer<typeof SaleSummary>;
export const SaleDetail = SaleSummary.extend({
  note: z.string().nullable(), netTotal: z.string(), taxTotal: z.string(), discountTotal: z.string(), cancelReason: z.string().nullable(),
  withTax: z.boolean(), billingName: z.string().nullable(), billingTaxId: z.string().nullable(), dueDate: z.string().nullable(), warehouseId: Uuid, branchId: Uuid,
  quote: z.object({ id: Uuid, code: z.string() }).nullable(),
  lines: z.array(DocLineView),
  payments: z.array(z.object({ id: Uuid, method: PaymentMethod, amount: z.string(), reference: z.string().nullable(), receivedAt: z.string(), by: z.string().nullable().optional() })),
  /** Quién vendió y en qué sucursal (para el detalle de la venta). */
  seller: z.string().nullable().optional(), branchName: z.string().nullable().optional(),
  returns: z.array(z.object({ id: Uuid, code: z.string(), reason: z.string(), total: z.string(), refundTotal: z.string(), createdAt: z.string() })),
});
export type SaleDetail = z.infer<typeof SaleDetail>;

export const QuoteInput = z
  .object({
    branchId: Uuid,
    customerId: Uuid.nullable().optional(),
    prospectName: optStr(120),
    validUntil: DateOnly,
    priceListId: Uuid.nullable().optional(),
    note: optStr(500),
    lines: z.array(DocLineInput).min(1).max(200),
  })
  .refine((q) => !!q.customerId || !!q.prospectName?.trim(), { message: "Indica el cliente o el nombre del prospecto", path: ["customerId"] });
export type QuoteInput = z.infer<typeof QuoteInput>;
export const QuotePatch = z.object({
  customerId: Uuid.nullable().optional(), prospectName: optStr(120), validUntil: DateOnly.optional(), priceListId: Uuid.nullable().optional(),
  note: optStr(500), lines: z.array(DocLineInput).min(1).max(200).optional(),
});
export type QuotePatch = z.infer<typeof QuotePatch>;
export const QuoteConvertRequest = z.object({ warehouseId: Uuid });
export type QuoteConvertRequest = z.infer<typeof QuoteConvertRequest>;

export const QuoteSummary = z.object({
  id: Uuid, code: z.string(), status: QuoteStatus, currency: z.string(), validUntil: z.string(), expired: z.boolean(),
  customer: z.object({ id: Uuid, code: z.string(), name: z.string() }).nullable(), prospectName: z.string().nullable(),
  total: z.string(), createdAt: z.string(), convertedSaleId: Uuid.nullable(),
});
export type QuoteSummary = z.infer<typeof QuoteSummary>;
export const QuoteDetail = QuoteSummary.extend({
  note: z.string().nullable(), netTotal: z.string(), taxTotal: z.string(), lines: z.array(DocLineView),
  /** Reserva de stock vigente (o la última) de esta cotización. */
  reservation: z.object({ id: Uuid, code: z.string(), status: z.enum(["ACTIVE", "RELEASED", "CONSUMED", "EXPIRED"]), expiresAt: z.string() }).nullable(),
});
export type QuoteDetail = z.infer<typeof QuoteDetail>;

/** Cobros al confirmar la venta (pago mixto). Lo que no se cobra queda a crédito (exige cliente). */
export const SaleConfirmRequest = z.object({
  payments: z.array(PaymentInput).max(10).default([]),
  /** Fecha límite de pago de lo que quede a crédito (si no, según el plazo del cliente). */
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD").optional(),
});
export type SaleConfirmRequest = z.infer<typeof SaleConfirmRequest>;
export const SaleVoidRequest = z.object({ reason: z.string().trim().min(3).max(300) });
export type SaleVoidRequest = z.infer<typeof SaleVoidRequest>;

/** Devolución parcial o total de una venta confirmada (nota de crédito interna). */
export const SaleReturnInput = z.object({
  reason: z.string().trim().min(3).max(300),
  lines: z.array(z.object({ saleLineId: Uuid, quantity: z.number().positive().max(1_000_000_000) })).min(1).max(200),
  /** Cómo se reintegra el dinero si corresponde (obligatorio cuando se devuelve más de lo que quedaba por cobrar). */
  refund: z.object({ method: PaymentMethod, reference: z.string().trim().max(80).nullable().optional(), cashSessionId: Uuid.optional() }).optional(),
});
export type SaleReturnInput = z.infer<typeof SaleReturnInput>;
export const SaleReturnView = z.object({
  id: Uuid, code: z.string(), saleId: Uuid, saleCode: z.string(), reason: z.string(), createdAt: z.string(),
  netTotal: z.string(), taxTotal: z.string(), total: z.string(), refundTotal: z.string(),
  lines: z.array(z.object({ productCode: z.string(), productName: z.string(), quantity: z.string(), netAmount: z.string(), taxAmount: z.string(), totalAmount: z.string() })),
});
export type SaleReturnView = z.infer<typeof SaleReturnView>;

// ───────────── Reservas de stock (Fase 5c) ─────────────

export const ReservationStatus = z.enum(["ACTIVE", "RELEASED", "CONSUMED", "EXPIRED"]);
export type ReservationStatus = z.infer<typeof ReservationStatus>;
export const ReservationInput = z.object({
  warehouseId: Uuid,
  lines: z.array(z.object({ productId: Uuid, quantity: z.number().positive().max(1_000_000_000) })).min(1).max(100),
  /** Horas de vigencia (por defecto 48). Al vencer, lo apartado vuelve a estar disponible. */
  hours: z.number().int().min(1).max(720).default(48),
  note: z.string().trim().max(300).nullable().optional(),
});
export type ReservationInput = z.infer<typeof ReservationInput>;
export const QuoteReserveRequest = z.object({ warehouseId: Uuid, hours: z.number().int().min(1).max(720).default(48) });
export type QuoteReserveRequest = z.infer<typeof QuoteReserveRequest>;
export const ReservationView = z.object({
  id: Uuid, code: z.string(), status: ReservationStatus, expiresAt: z.string(), createdAt: z.string(), closedAt: z.string().nullable(), note: z.string().nullable(),
  sourceType: z.string().nullable(), sourceId: Uuid.nullable(), warehouse: z.object({ id: Uuid, code: z.string(), name: z.string() }),
  lines: z.array(z.object({ productCode: z.string(), productName: z.string(), lotCode: z.string(), quantity: z.string() })),
});
export type ReservationView = z.infer<typeof ReservationView>;

// ───────────── Cajas, turnos y arqueos (Fase 6) ─────────────

/** Denominaciones de efectivo admitidas (bolivianos): billetes y monedas. */
export const CASH_DENOMINATIONS = ["200", "100", "50", "20", "10", "5", "2", "1", "0.5"] as const;
export const Denominations = z
  .record(z.string(), z.number().int().min(0).max(1_000_000))
  .refine((d) => Object.keys(d).every((k) => (CASH_DENOMINATIONS as readonly string[]).includes(k)), { message: "Denominación no válida (200, 100, 50, 20, 10, 5, 2, 1 o 0.5)" });
export type Denominations = z.infer<typeof Denominations>;

export const CashRegisterInput = z.object({ branchId: Uuid, code: MasterCode, name: z.string().trim().min(2).max(80), kind: z.enum(["BOX", "VAULT"]).default("BOX") });
export type CashRegisterInput = z.infer<typeof CashRegisterInput>;
export const CashRegisterPatch = z.object({ name: z.string().trim().min(2).max(80).optional(), status: CatalogStatus.optional() });
export type CashRegisterPatch = z.infer<typeof CashRegisterPatch>;
export const CashRegisterSummary = z.object({
  id: Uuid, code: z.string(), name: z.string(), kind: z.enum(["BOX", "VAULT"]), status: CatalogStatus,
  branch: z.object({ id: Uuid, code: z.string(), name: z.string() }),
  /** Sesión abierta o en cierre en este momento. */
  activeSession: z.object({ id: Uuid, code: z.string(), status: z.enum(["OPEN", "CLOSING"]), responsible: z.string() }).nullable(),
});
export type CashRegisterSummary = z.infer<typeof CashRegisterSummary>;

export const CashOpenInput = z.object({
  registerId: Uuid,
  /** Efectivo inicial contado por denominación. */
  denominations: Denominations.default({}),
  note: z.string().trim().max(300).nullable().optional(),
});
export type CashOpenInput = z.infer<typeof CashOpenInput>;
export const CashParticipantInput = z.object({ userId: Uuid });
export type CashParticipantInput = z.infer<typeof CashParticipantInput>;
export const CashMovementInput = z.object({
  type: z.enum(["INCOME", "EXPENSE", "WITHDRAWAL"]),
  method: PaymentMethod.default("CASH"),
  amount: z.number().positive().max(1_000_000_000),
  note: z.string().trim().min(3).max(300),
});
export type CashMovementInput = z.infer<typeof CashMovementInput>;
export const CashTransferInput = z.object({ toSessionId: Uuid, amount: z.number().positive().max(1_000_000_000), note: z.string().trim().max(300).nullable().optional() });
export type CashTransferInput = z.infer<typeof CashTransferInput>;
export const CashCountInput = z.object({ denominations: Denominations, note: z.string().trim().max(300).nullable().optional() });
export type CashCountInput = z.infer<typeof CashCountInput>;
export const CashCloseInput = z.object({ denominations: Denominations, justification: z.string().trim().min(3).max(300).nullable().optional() });
export type CashCloseInput = z.infer<typeof CashCloseInput>;
export const CashDecisionInput = z.object({ approve: z.boolean(), note: z.string().trim().min(3).max(300) });
export type CashDecisionInput = z.infer<typeof CashDecisionInput>;
export const CashReasonInput = z.object({ reason: z.string().trim().min(3).max(300) });
export type CashReasonInput = z.infer<typeof CashReasonInput>;
/** Dónde se cobra: en el propio punto de venta, o solo en caja (el punto de venta solo guarda y el cajero cobra). */
export const CollectMode = z.enum(["AT_POS", "AT_CASHIER"]);
export type CollectMode = z.infer<typeof CollectMode>;
export const SalesSettings = z.object({ collectMode: CollectMode });
export type SalesSettings = z.infer<typeof SalesSettings>;
export const CashSettings = z.object({ differenceTolerance: z.number().min(0).max(1_000_000) });
export type CashSettings = z.infer<typeof CashSettings>;

export const CashSessionSummary = z.object({
  id: Uuid, code: z.string(), status: z.enum(["OPEN", "CLOSING", "CLOSED"]),
  register: z.object({ id: Uuid, code: z.string(), name: z.string(), kind: z.enum(["BOX", "VAULT"]) }),
  branchId: Uuid, responsible: z.object({ id: Uuid, name: z.string() }),
  openedAt: z.string(), closedAt: z.string().nullable(), openingCash: z.string(), reopenedCount: z.number().int(),
  /** Efectivo que debería haber en caja ahora (calculado por el sistema). */
  expectedCash: z.string(),
});
export type CashSessionSummary = z.infer<typeof CashSessionSummary>;
export const CashMovementView = z.object({
  id: Uuid, seq: z.string(), type: z.enum(["OPENING", "SALE_PAYMENT", "SUPPLIER_PAYMENT", "REFUND", "INCOME", "EXPENSE", "WITHDRAWAL", "TRANSFER_IN", "TRANSFER_OUT", "REVERSAL"]),
  method: PaymentMethod, amount: z.string(), note: z.string().nullable(), sourceType: z.string().nullable(), reversalOfId: Uuid.nullable(), actor: z.string().nullable(), createdAt: z.string(),
});
export type CashMovementView = z.infer<typeof CashMovementView>;
export const CashSessionDetail = CashSessionSummary.extend({
  openNote: z.string().nullable(),
  totals: z.array(z.object({ method: PaymentMethod, income: z.string(), outflow: z.string(), net: z.string() })),
  participants: z.array(z.object({ userId: Uuid, name: z.string() })),
  movements: z.array(CashMovementView),
  counts: z.array(z.object({ id: Uuid, isClosing: z.boolean(), expectedCash: z.string(), countedCash: z.string(), difference: z.string(), countedAt: z.string(), note: z.string().nullable() })),
  differences: z.array(z.object({ id: Uuid, amount: z.string(), justification: z.string(), status: z.enum(["PENDING", "APPROVED", "REJECTED"]), decisionNote: z.string().nullable(), decidedAt: z.string().nullable() })),
  closings: z.array(z.object({ version: z.number().int(), closedAt: z.string() })),
});
export type CashSessionDetail = z.infer<typeof CashSessionDetail>;

// ───────────── Finanzas operativas (Fase 6b) ─────────────

export const AGING_BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90plus"] as const;
export const AgingBuckets = z.object({ current: z.string(), d1_30: z.string(), d31_60: z.string(), d61_90: z.string(), d90plus: z.string() });
export type AgingBuckets = z.infer<typeof AgingBuckets>;

export const ReceivablesReport = z.object({
  asOf: z.string(),
  totals: AgingBuckets.extend({ outstanding: z.string(), overdue: z.string() }),
  customers: z.array(z.object({
    customerId: Uuid, code: z.string(), name: z.string(), creditLimit: z.string().nullable(), outstanding: z.string(), overdue: z.string(), oldestDue: z.string().nullable(), documents: z.number().int(), buckets: AgingBuckets,
  })),
});
export type ReceivablesReport = z.infer<typeof ReceivablesReport>;
export const ReceivableRow = z.object({ saleId: Uuid, code: z.string(), confirmedAt: z.string(), dueDate: z.string(), daysOverdue: z.number().int(), total: z.string(), balance: z.string(), currency: z.string() });
export type ReceivableRow = z.infer<typeof ReceivableRow>;

export const PayablesReport = z.object({
  asOf: z.string(),
  totals: AgingBuckets.extend({ outstanding: z.string(), overdue: z.string() }),
  suppliers: z.array(z.object({
    supplierId: Uuid, code: z.string(), name: z.string(), outstanding: z.string(), overdue: z.string(), oldestDue: z.string().nullable(), documents: z.number().int(), buckets: AgingBuckets,
  })),
});
export type PayablesReport = z.infer<typeof PayablesReport>;
export const PayableRow = z.object({ id: Uuid, receiptCode: z.string(), orderCode: z.string().nullable(), supplierRef: z.string().nullable(), createdAt: z.string(), dueDate: z.string(), daysOverdue: z.number().int(), total: z.string(), paid: z.string(), balance: z.string(), status: z.enum(["OPEN", "PAID", "VOID"]), currency: z.string() });
export type PayableRow = z.infer<typeof PayableRow>;

export const SupplierPaymentInput = z.object({
  supplierId: Uuid,
  method: PaymentMethod,
  amount: z.number().positive().max(1_000_000_000),
  reference: z.string().trim().max(80).nullable().optional(),
  /** Sucursal desde la que se paga (define la caja si el pago es en efectivo). Por defecto, la de la recepción más antigua. */
  branchId: Uuid.optional(),
  cashSessionId: Uuid.optional(),
  /** A qué deudas se aplica. Sin indicarlo, se paga primero lo que vence antes. La suma debe ser igual al importe. */
  allocations: z.array(z.object({ payableId: Uuid, amount: z.number().positive() })).max(100).optional(),
});
export type SupplierPaymentInput = z.infer<typeof SupplierPaymentInput>;
export const SupplierPaymentView = z.object({
  id: Uuid, code: z.string(), method: PaymentMethod, amount: z.string(), reference: z.string().nullable(), paidAt: z.string(),
  supplier: z.object({ id: Uuid, code: z.string(), name: z.string() }),
  allocations: z.array(z.object({ payableId: Uuid, receiptCode: z.string(), amount: z.string() })),
});
export type SupplierPaymentView = z.infer<typeof SupplierPaymentView>;

// ───────────── Aprobaciones (Fase 7) ─────────────

/** Tipos de evento que pueden pasar por aprobación. Los que tienen acción asociada se ejecutan al aprobar. */
export const APPROVAL_EVENTS = ["SALE_VOID", "SALE_DISCOUNT", "SALE_RETURN", "INVENTORY_ADJUSTMENT", "CASH_DIFFERENCE", "CASH_REOPEN", "PURCHASE_HIGH"] as const;
export const ApprovalEventType = z.enum(APPROVAL_EVENTS);
export type ApprovalEventType = z.infer<typeof ApprovalEventType>;
export const ApprovalStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED", "EXECUTED"]);
export type ApprovalStatusValue = z.infer<typeof ApprovalStatusSchema>;

export const ApprovalStep = z.object({
  name: z.string().trim().min(1).max(80),
  /** Quién puede decidir este paso: cualquier miembro de estos roles o estos usuarios (con el permiso approvals.decide). */
  roleIds: z.array(Uuid).max(20).default([]),
  userIds: z.array(Uuid).max(20).default([]),
  /** Horas para decidir; vencido, se amplía a `escalateTo`. 0/ausente = sin plazo. */
  dueHours: z.number().int().min(1).max(24 * 60).optional(),
  escalateTo: z.object({ roleIds: z.array(Uuid).max(20).default([]), userIds: z.array(Uuid).max(20).default([]) }).optional(),
}).refine((s) => s.roleIds.length + s.userIds.length > 0, { message: "Cada nivel necesita al menos un rol o usuario aprobador." });
export type ApprovalStep = z.infer<typeof ApprovalStep>;

export const ApprovalConfig = z.object({
  /** Solo se pide aprobación si el importe llega a este mínimo (sin mínimo = siempre). */
  minAmount: z.number().min(0).optional(),
  /** Quien solicita no puede aprobar su propia solicitud. */
  forbidSelfApproval: z.boolean().default(true),
  steps: z.array(ApprovalStep).min(1).max(5),
});
export type ApprovalConfig = z.infer<typeof ApprovalConfig>;

export const ApprovalWorkflowInput = z.object({ enabled: z.boolean(), config: ApprovalConfig });
export type ApprovalWorkflowInput = z.infer<typeof ApprovalWorkflowInput>;
export const ApprovalWorkflowView = z.object({
  eventType: ApprovalEventType, label: z.string(), executable: z.boolean(), enabled: z.boolean(), version: z.number().int(),
  config: ApprovalConfig.nullable(),
});
export type ApprovalWorkflowView = z.infer<typeof ApprovalWorkflowView>;

export const ApprovalRequestInput = z.object({
  eventType: ApprovalEventType,
  subjectId: Uuid.optional(),
  reason: z.string().trim().min(3).max(500),
  amount: z.number().min(0).optional(),
  /** Datos adicionales de lo pedido (p. ej. el descuento). Nunca secretos. */
  data: z.record(z.string(), z.union([z.string().max(300), z.number(), z.boolean()])).optional(),
});
export type ApprovalRequestInput = z.infer<typeof ApprovalRequestInput>;
export const ApprovalDecisionInput = z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().trim().max(500).optional() })
  .refine((d) => d.decision === "APPROVE" || (d.note && d.note.length >= 3), { message: "Rechazar requiere indicar el motivo.", path: ["note"] });
export type ApprovalDecisionInput = z.infer<typeof ApprovalDecisionInput>;

export const ApprovalRequestView = z.object({
  id: Uuid, code: z.string(), eventType: z.string(), eventLabel: z.string(), title: z.string(), reason: z.string(),
  amount: z.string().nullable(), status: ApprovalStatusSchema, currentStep: z.number().int(), totalSteps: z.number().int(),
  stepName: z.string().nullable(), subjectId: Uuid.nullable(), subjectType: z.string(),
  requestedBy: z.object({ id: Uuid, name: z.string() }), dueAt: z.string().nullable(), escalated: z.boolean(),
  createdAt: z.string(), resolvedAt: z.string().nullable(),
  /** El usuario actual puede decidir el paso en curso (directo, por delegación o por escalamiento). */
  canDecide: z.boolean(),
  decisions: z.array(z.object({ step: z.number().int(), decision: z.enum(["APPROVE", "REJECT"]), note: z.string().nullable(), by: z.string(), onBehalfOf: z.string().nullable(), at: z.string() })),
  executionError: z.string().nullable().optional(),
});
export type ApprovalRequestView = z.infer<typeof ApprovalRequestView>;

export const ApprovalDelegationInput = z.object({
  delegateUserId: Uuid, eventType: ApprovalEventType.optional(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).refine((d) => d.validTo >= d.validFrom, { message: "La fecha final no puede ser anterior a la inicial.", path: ["validTo"] });
export type ApprovalDelegationInput = z.infer<typeof ApprovalDelegationInput>;
export const ApprovalDelegationView = z.object({
  id: Uuid, delegator: z.object({ id: Uuid, name: z.string() }), delegate: z.object({ id: Uuid, name: z.string() }),
  eventType: z.string().nullable(), validFrom: z.string(), validTo: z.string(), revoked: z.boolean(), active: z.boolean(),
});
export type ApprovalDelegationView = z.infer<typeof ApprovalDelegationView>;

export const NotificationView = z.object({
  id: Uuid, type: z.string(), title: z.string(), body: z.string().nullable(), link: z.string().nullable(),
  severity: z.string(), read: z.boolean(), createdAt: z.string(), refType: z.string().nullable(), refId: z.string().nullable(),
});
export type NotificationView = z.infer<typeof NotificationView>;

// ───────────── Documentos e impresión (Fase 7c) ─────────────

export const DOCUMENT_TYPES = ["SALE_RECEIPT", "QUOTE", "PURCHASE_ORDER", "SUPPLIER_DEPOSIT"] as const;
export const DocumentType = z.enum(DOCUMENT_TYPES);
export type DocumentType = z.infer<typeof DocumentType>;
export const DocPaper = z.enum(["THERMAL_58", "THERMAL_80", "LETTER", "LEGAL"]);
export type DocPaper = z.infer<typeof DocPaper>;

export const DocumentConfig = z.object({
  paper: DocPaper,
  marginMm: z.number().min(0).max(30).default(4),
  fontSizePt: z.number().min(7).max(14).default(9),
  copies: z.number().int().min(1).max(5).default(1),
  /** Líneas bajo el nombre de la empresa (dirección, teléfono…). */
  headerLines: z.array(z.string().trim().max(120)).max(5).default([]),
  footerText: z.string().trim().max(300).default(""),
  legalText: z.string().trim().max(500).default(""),
  show: z.object({
    customer: z.boolean().default(true),
    unitPrice: z.boolean().default(true),
    discount: z.boolean().default(true),
    taxes: z.boolean().default(true),
    payments: z.boolean().default(true),
    notes: z.boolean().default(true),
  }).default({ customer: true, unitPrice: true, discount: true, taxes: true, payments: true, notes: true }),
});
export type DocumentConfig = z.infer<typeof DocumentConfig>;

export const DocumentTemplateView = z.object({
  docType: DocumentType, label: z.string(), version: z.number().int(), customized: z.boolean(), config: DocumentConfig,
});
export type DocumentTemplateView = z.infer<typeof DocumentTemplateView>;

export const RenderedDocument = z.object({ title: z.string(), paper: DocPaper, copies: z.number().int(), html: z.string() });
export type RenderedDocument = z.infer<typeof RenderedDocument>;

export const PRINTER_CONNECTIONS = ["BROWSER", "NETWORK", "USB", "SERIAL", "SYSTEM"] as const;
export const PrinterConnection = z.enum(PRINTER_CONNECTIONS);
export const PRINTER_CODEPAGES = ["CP858", "CP850", "CP437", "WPC1252", "UTF8"] as const;
export const PrinterCodepage = z.enum(PRINTER_CODEPAGES);
export const PrinterFields = {
  name: z.string().trim().min(2).max(80),
  /** Tipo de equipo (informativo). */
  kind: z.enum(["BROWSER", "THERMAL", "LASER", "OTHER"]),
  paper: DocPaper,
  /** Cómo llega el documento a la impresora. */
  connection: PrinterConnection.default("BROWSER"),
  /** HTML = documento con formato (diálogo del navegador); TEXT = texto plano / ESC-POS para impresoras de tickets. */
  mode: z.enum(["HTML", "TEXT"]).default("HTML"),
  /** Solo conexión por red: dirección IP de la red local y puerto (normalmente 9100). */
  host: z.string().trim().max(60).nullable().optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  /** Caracteres por línea en modo texto (32 = 58 mm, 42 o 48 = 80 mm según la fuente). */
  charsPerLine: z.number().int().min(24).max(96).default(42),
  codepage: PrinterCodepage.default("CP858"),
  cutMode: z.enum(["NONE", "PARTIAL", "FULL"]).default("FULL"),
  /** Abrir el cajón de dinero conectado a la impresora al imprimir un recibo. */
  openDrawer: z.boolean().default(false),
  feedLines: z.number().int().min(0).max(12).default(3),
  branchId: Uuid.nullable().optional(),
  cashRegisterId: Uuid.nullable().optional(),
  isDefault: z.boolean().default(false),
};
export const PrinterInput = z.object(PrinterFields).superRefine((p, ctx) => {
  if (p.connection === "NETWORK") {
    if (!p.host) ctx.addIssue({ code: "custom", path: ["host"], message: "Indica la dirección IP de la impresora." });
    if (!p.port) ctx.addIssue({ code: "custom", path: ["port"], message: "Indica el puerto (normalmente 9100)." });
  }
});
export type PrinterInput = z.infer<typeof PrinterInput>;
export const PrinterView = z.object({
  id: Uuid, name: z.string(), kind: z.string(), paper: DocPaper, connection: PrinterConnection, mode: z.enum(["HTML", "TEXT"]),
  host: z.string().nullable(), port: z.number().int().nullable(), charsPerLine: z.number().int(), codepage: PrinterCodepage,
  cutMode: z.enum(["NONE", "PARTIAL", "FULL"]), openDrawer: z.boolean(), feedLines: z.number().int(),
  branchId: Uuid.nullable(), cashRegisterId: Uuid.nullable(), cashRegisterName: z.string().nullable(), isDefault: z.boolean(), active: z.boolean(),
});
export type PrinterView = z.infer<typeof PrinterView>;

/** Resultado de imprimir en modo texto: lo entregado por el servidor (red) o los bytes que envía el navegador (USB/serie). */
export const TextPrintResult = z.object({
  printerId: Uuid, connection: PrinterConnection, delivered: z.boolean(), bytes: z.number().int(),
  /** ESC/POS en base64, para que el navegador lo envíe por USB o puerto serie. */
  dataBase64: z.string(), text: z.string(),
});
export type TextPrintResult = z.infer<typeof TextPrintResult>;

// ───────────── Consola de plataforma: empresas (clientes) ─────────────

export const TenantStatusSchema = z.enum(["TRIAL", "ACTIVE", "SUSPENDED", "CANCELLED"]);
export type TenantStatusValue = z.infer<typeof TenantStatusSchema>;

export const PlatformPlanView = z.object({ code: z.string(), name: z.string(), limits: z.record(z.string(), z.number()) });
export type PlatformPlanView = z.infer<typeof PlatformPlanView>;

export const PlatformTenantView = z.object({
  id: Uuid, slug: z.string(), legalName: z.string(), taxId: z.string().nullable(), status: TenantStatusSchema,
  plan: z.object({ code: z.string(), name: z.string() }).nullable(), createdAt: z.string(),
  users: z.number().int(), branches: z.number().int(),
});
export type PlatformTenantView = z.infer<typeof PlatformTenantView>;

export const CreateTenantRequest = z.object({
  companyName: z.string().trim().min(2).max(120),
  taxId: z.string().trim().max(30).optional(),
  planCode: z.string().trim().min(1).max(40),
  status: z.enum(["TRIAL", "ACTIVE"]).default("TRIAL"),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.string().trim().toLowerCase().email().max(200),
  adminUsername: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/, "Usuario: 3 a 32 caracteres (a-z, 0-9, punto, guion).").optional(),
});
export type CreateTenantRequest = z.infer<typeof CreateTenantRequest>;

export const UpdateTenantRequest = z.object({
  status: z.enum(["TRIAL", "ACTIVE", "SUSPENDED"]).optional(),
  planCode: z.string().trim().min(1).max(40).optional(),
}).refine((v) => v.status !== undefined || v.planCode !== undefined, { message: "Indica qué cambiar." });
export type UpdateTenantRequest = z.infer<typeof UpdateTenantRequest>;

export const CreateTenantResult = z.object({
  tenant: PlatformTenantView,
  /** Enlace de un solo uso para que el administrador fije su contraseña. Nulo si ya tenía cuenta (entra con la suya). */
  setupUrl: z.string().nullable(),
  adminAlreadyExisted: z.boolean(),
  emailSent: z.boolean(),
});
export type CreateTenantResult = z.infer<typeof CreateTenantResult>;

// ───────────── Edición masiva de precios (hoja tipo Excel) ─────────────

export const PriceGridRow = z.object({
  productId: Uuid, code: z.string(), name: z.string(), unit: z.string(), categoryId: Uuid.nullable(), category: z.string().nullable(),
  /** Escalas actuales en la lista (vacío = el producto aún no tiene precio en ella). El máximo de cada tramo es el mínimo del siguiente. */
  tiers: z.array(z.object({ minQuantity: z.string(), unitPrice: z.string() })),
});
export type PriceGridRow = z.infer<typeof PriceGridRow>;
export const PriceGrid = z.object({
  items: z.array(PriceGridRow), truncated: z.boolean(),
  priceMode: z.enum(["WITH_TAX", "WITHOUT_TAX"]), scalingMode: ScalingMode, currency: z.string(),
});
export type PriceGrid = z.infer<typeof PriceGrid>;

/** Cambios de varios productos a la vez: cada uno trae TODAS sus escalas (reemplazan las actuales). Todo o nada. */
export const BulkPricesRequest = z.object({
  items: z.array(z.object({
    productId: Uuid,
    tiers: z.array(z.object({ minQuantity: z.number().positive(), unitPrice: z.number().min(0) })).min(1).max(20),
  })).min(1).max(500),
});
export type BulkPricesRequest = z.infer<typeof BulkPricesRequest>;
export const BulkPricesResult = z.object({ updated: z.number().int(), unchanged: z.number().int() });
export type BulkPricesResult = z.infer<typeof BulkPricesResult>;

// ───────────── Integraciones, fotos de producto y variantes ─────────────

export const IntegrationProvider = z.enum(["CLOUDINARY"]);
export type IntegrationProvider = z.infer<typeof IntegrationProvider>;

export const CloudinaryInput = z.object({
  cloudName: z.string().trim().regex(/^[A-Za-z0-9_-]{2,60}$/, "Nombre de la nube: letras, números, guion o guion bajo."),
  apiKey: z.string().trim().regex(/^\d{6,30}$/, "La API key de Cloudinary son solo números."),
  /** Sin indicarlo se conserva el guardado. Nunca se devuelve. */
  apiSecret: z.string().trim().min(10, "El API secret es más largo.").max(100).optional(),
  /** Carpeta de Cloudinary donde se suben las fotos. */
  folder: z.string().trim().regex(/^[A-Za-z0-9_/-]{1,80}$/, "Carpeta: letras, números, guion, guion bajo o barra.").default("nexus/productos"),
  enabled: z.boolean().default(true),
});
export type CloudinaryInput = z.infer<typeof CloudinaryInput>;

export const IntegrationView = z.object({
  provider: IntegrationProvider, label: z.string(), description: z.string(),
  /** Hay datos guardados. */
  configured: z.boolean(), enabled: z.boolean(),
  config: z.object({ cloudName: z.string(), apiKey: z.string(), folder: z.string() }).nullable(),
  secretSet: z.boolean(), updatedAt: z.string().nullable(),
});
export type IntegrationView = z.infer<typeof IntegrationView>;
export const IntegrationTestResult = z.object({ ok: z.boolean(), message: z.string() });
export type IntegrationTestResult = z.infer<typeof IntegrationTestResult>;

/** Firma para que el navegador suba la foto directo a Cloudinary sin conocer el secreto. */
export const ImageUploadSignature = z.object({
  uploadUrl: z.string(), cloudName: z.string(), apiKey: z.string(), timestamp: z.number().int(), folder: z.string(), signature: z.string(),
  maxBytes: z.number().int(),
});
export type ImageUploadSignature = z.infer<typeof ImageUploadSignature>;

export const ProductImageInput = z.object({
  url: z.string().url().max(500),
  publicId: z.string().trim().min(3).max(200),
  bytes: z.number().int().min(0).max(50_000_000).optional(),
  width: z.number().int().min(1).max(20000).optional(),
  height: z.number().int().min(1).max(20000).optional(),
});
export type ProductImageInput = z.infer<typeof ProductImageInput>;
export const ProductImageView = z.object({
  id: Uuid, url: z.string(), thumbUrl: z.string(), publicId: z.string(), isPrimary: z.boolean(), position: z.number().int(),
  bytes: z.number().int().nullable(), width: z.number().int().nullable(), height: z.number().int().nullable(),
});
export type ProductImageView = z.infer<typeof ProductImageView>;

const VariantOption = z.object({
  name: z.string().trim().min(1).max(30),
  values: z.array(z.string().trim().min(1).max(30)).min(1).max(20),
});
export const ProductGroupInput = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional(),
  /** Prefijo de los códigos de las variantes (p. ej. POL → POL-S-ROJ). */
  baseCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._]{0,13}$/, "Hasta 14 caracteres: letras, números o punto."),
  options: z.array(VariantOption).min(1).max(3),
  baseUnitId: Uuid,
  categoryId: Uuid.nullable().optional(),
  brandId: Uuid.nullable().optional(),
  taxProfileId: Uuid.nullable().optional(),
  trackLots: z.boolean().default(false),
  trackExpiry: z.boolean().default(false),
}).superRefine((g, ctx) => {
  const names = g.options.map((o) => o.name.toLowerCase());
  if (new Set(names).size !== names.length) ctx.addIssue({ code: "custom", path: ["options"], message: "Dos opciones tienen el mismo nombre." });
  g.options.forEach((o, i) => { if (new Set(o.values.map((v) => v.toLowerCase())).size !== o.values.length) ctx.addIssue({ code: "custom", path: ["options", i, "values"], message: `«${o.name}» tiene valores repetidos.` }); });
  if (g.options.reduce((n, o) => n * o.values.length, 1) > 100) ctx.addIssue({ code: "custom", path: ["options"], message: "Máximo 100 variantes por producto." });
});
export type ProductGroupInput = z.infer<typeof ProductGroupInput>;
export const AddVariantInput = z.object({ values: z.record(z.string(), z.string().trim().min(1).max(30)) });
export type AddVariantInput = z.infer<typeof AddVariantInput>;
export const ProductGroupView = z.object({
  id: Uuid, name: z.string(), description: z.string().nullable(), options: z.array(VariantOption),
  variants: z.array(z.object({
    id: Uuid, code: z.string(), name: z.string(), status: CatalogStatus, variantLabel: z.string(), values: z.record(z.string(), z.string()),
    imageUrl: z.string().nullable(), thumbUrl: z.string().nullable(),
  })),
});
export type ProductGroupView = z.infer<typeof ProductGroupView>;

// ───────────── Fotos subidas al servidor (cuando no hay Cloudinary) ─────────────

export const ImageStorageInfo = z.object({
  /** CLOUDINARY: las fotos van a la nube; SERVER: se guardan en el servidor de NEXUS. */
  mode: z.enum(["CLOUDINARY", "SERVER"]), maxImages: z.number().int(), maxBytes: z.number().int(),
});
export type ImageStorageInfo = z.infer<typeof ImageStorageInfo>;
export const ImageFileUpload = z.object({
  fileName: z.string().trim().max(200).default("foto"),
  contentBase64: z.string().min(20).max(7_500_000),
});
export type ImageFileUpload = z.infer<typeof ImageFileUpload>;

// ───────────── Consulta e historial de ventas ─────────────

const OptDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD").optional();
const Flag = z.union([z.boolean(), z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1")]).optional();
export const SaleSearchQuery = z.object({
  /** Número de documento (parte del código, p. ej. «100» encuentra V-000100). */
  code: z.string().trim().max(30).optional(),
  dateFrom: OptDate, dateTo: OptDate,
  customerId: Uuid.optional(),
  /** NIT o CI del cliente (parte). */
  taxId: z.string().trim().max(30).optional(),
  branchId: Uuid.optional(),
  sellerId: Uuid.optional(),
  status: SaleStatus.optional(),
  paymentStatus: SalePaymentStatus.optional(),
  channel: SalesChannel.optional(),
  /** Solo ventas confirmadas con saldo pendiente. */
  onlyDebtors: Flag,
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(5000).default(50),
}).refine((q) => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo, { message: "La fecha «desde» no puede ser posterior a «hasta».", path: ["dateTo"] });
export type SaleSearchQuery = z.infer<typeof SaleSearchQuery>;

export const SaleSearchRow = z.object({
  id: Uuid, code: z.string().nullable(), status: SaleStatus, paymentStatus: SalePaymentStatus, channel: SalesChannel,
  /** Fecha de la venta: la de confirmación, o la de creación si sigue en borrador. */
  date: z.string(),
  customer: z.object({ id: Uuid, name: z.string(), taxId: z.string().nullable() }).nullable(),
  branch: z.object({ id: Uuid, name: z.string() }), seller: z.string().nullable(), currency: z.string(),
  total: z.string(), paid: z.string(), returned: z.string(), balance: z.string(),
  dueDate: z.string().nullable(), overdueDays: z.number().int(),
});
export type SaleSearchRow = z.infer<typeof SaleSearchRow>;
export const SaleSearchResult = z.object({
  items: z.array(SaleSearchRow), total: z.number().int(), page: z.number().int(), pageSize: z.number().int(),
  /** Sobre todo lo encontrado (no solo la página): ventas con saldo, deuda total y clientes que deben. */
  summary: z.object({ pendingSales: z.number().int(), customersWithBalance: z.number().int(), totalOutstanding: z.string() }),
});
export type SaleSearchResult = z.infer<typeof SaleSearchResult>;

// ───────────── Punto de venta ─────────────

/** Cálculo de una venta sin guardarla: precios por cantidad, descuentos e impuestos. */
export const SalePreviewRequest = z.object({
  warehouseId: Uuid,
  customerId: Uuid.nullable().optional(),
  priceListId: Uuid.nullable().optional(),
  withTax: z.boolean().default(true),
  lines: z.array(DocLineInput).min(1).max(200),
});
export type SalePreviewRequest = z.infer<typeof SalePreviewRequest>;
export const SalePreviewResult = z.object({
  currency: z.string(),
  lines: z.array(z.object({
    productId: Uuid, quantity: z.string(), unitPrice: z.string(), listUnitPrice: z.string(), discountPct: z.string(), priceListCode: z.string(),
    /** Tramo que se aplicó («1-5», «6+»), para mostrarlo en la línea. */
    tier: z.string().nullable(),
    netAmount: z.string(), taxAmount: z.string(), totalAmount: z.string(),
  })),
  totals: z.object({ net: z.string(), tax: z.string(), discount: z.string(), total: z.string() }),
});
export type SalePreviewResult = z.infer<typeof SalePreviewResult>;

export const PosProductQuery = z.object({
  q: z.string().trim().min(1).max(80),
  /** Dónde buscar (separado por comas): description, code, barcode, supplier. */
  fields: z.string().default("description,code,barcode"),
  warehouseId: Uuid,
  customerId: Uuid.optional(),
  priceListId: Uuid.optional(),
  limit: z.coerce.number().int().min(1).max(30).default(15),
});
export type PosProductQuery = z.infer<typeof PosProductQuery>;
export const PosProductRow = z.object({
  id: Uuid, code: z.string(), name: z.string(), category: z.string().nullable(), brand: z.string().nullable(), unit: z.string(), decimals: z.number().int(),
  kind: z.enum(["GOODS", "SERVICE"]), thumbUrl: z.string().nullable(), variantLabel: z.string().nullable(),
  /** Disponible en el almacén elegido y en todos. Nulo en servicios. */
  stockHere: z.string().nullable(), stockTotal: z.string().nullable(),
  suppliers: z.array(z.string()),
  price: z.object({
    listId: Uuid, listCode: z.string(), priceMode: z.enum(["WITH_TAX", "WITHOUT_TAX"]), scalingMode: ScalingMode, currency: z.string(),
    tiers: z.array(z.object({ min: z.string(), max: z.string().nullable(), price: z.string() })),
  }).nullable(),
});
export type PosProductRow = z.infer<typeof PosProductRow>;
