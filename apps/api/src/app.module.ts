import { Controller, Get, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AccountController } from "./account/account.controller";
import { AccountService } from "./account/account.service";
import { MfaService } from "./account/mfa.service";
import { RecoveryChannels, RecoveryService } from "./account/recovery.service";
import { AdminBranchesController, AdminMembersController, AdminRolesController, AdminSchedulesController, PublicInvitationsController } from "./admin/admin.controller";
import { SchedulesAdminService } from "./admin/schedules-admin.service";
import { AccessScheduleService } from "./access/access-schedule.service";
import { Clock } from "./access/clock";
import { BranchesAdminService } from "./admin/branches-admin.service";
import { InvitationAcceptService } from "./admin/invitation-accept.service";
import { MembersAdminService } from "./admin/members-admin.service";
import { RolesAdminService } from "./admin/roles-admin.service";
import { CatalogController } from "./catalog/catalog.controller";
import { MastersService } from "./catalog/masters.service";
import { ProductsService } from "./catalog/products.service";
import { PricingController, TaxesController } from "./pricing/pricing.controller";
import { PricingService } from "./pricing/pricing.service";
import { TaxesService } from "./pricing/taxes.service";
import { ExcelBodyLimit } from "./excel/limits";
import { ExportsController, ImportsController } from "./excel/excel.controller";
import { ExportsService } from "./excel/exports.service";
import { ImportsService } from "./excel/imports.service";
import { InventoryController } from "./inventory/inventory.controller";
import { InventoryService } from "./inventory/inventory.service";
import { StockEngine } from "./inventory/stock-engine";
import { PurchasingController } from "./purchasing/purchasing.controller";
import { PurchasingService } from "./purchasing/purchasing.service";
import { FinanceController } from "./finance/finance.controller";
import { FinanceService } from "./finance/finance.service";
import { DocumentsController } from "./documents/documents.controller";
import { DocumentsService } from "./documents/documents.service";
import { MediaController } from "./media/media.controller";
import { IntegrationsController } from "./integrations/integrations.controller";
import { IntegrationsService } from "./integrations/integrations.service";
import { ProductGroupsService } from "./catalog/product-groups.service";
import { ProductImagesService } from "./catalog/product-images.service";
import { ApprovalsController } from "./approvals/approvals.controller";
import { ApprovalsService } from "./approvals/approvals.service";
import { NotificationsService } from "./approvals/notifications.service";
import { CashController } from "./cash/cash.controller";
import { CashService } from "./cash/cash.service";
import { CountsService } from "./inventory/counts.service";
import { ReservationsService } from "./inventory/reservations.service";
import { TransfersController } from "./inventory/transfers.controller";
import { TransfersService } from "./inventory/transfers.service";
import { ReturnsService } from "./sales/returns.service";
import { CustomersService } from "./sales/customers.service";
import { QuotesService } from "./sales/quotes.service";
import { SalesController } from "./sales/sales.controller";
import { PosService } from "./sales/pos.service";
import { SalesQueryService } from "./sales/sales-query.service";
import { SalesService } from "./sales/sales.service";
import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { PasswordService } from "./auth/password.service";
import { TokenService } from "./auth/token.service";
import { BranchesController } from "./branches.controller";
import { Public } from "./common/decorators";
import { AuthGuard, PermissionsGuard } from "./common/guards";
import { ProblemDetailsFilter } from "./common/problem-details.filter";
import { AppConfig } from "./config";
import { dbProvider, platformDbProvider, workerDbProvider } from "./db";
import { OutboxDispatcher, OutboxHandlers } from "./outbox/outbox-dispatcher";
import { DevMailbox, MailService } from "./mail/mail.service";
import { PlatformAuthService, PlatformSettingsService } from "./platform/platform.service";
import { PlatformTenantsService } from "./platform/tenants.service";
import { PlatformController, PlatformGuard } from "./platform/platform.controller";
import { DevController, PublicController } from "./public/public.controller";
import { RegistrationService } from "./public/registration.service";
import { RateLimiter } from "./security/rate-limiter";
import { SecondFactorService } from "./security/second-factor.service";
import { DashboardController } from "./dashboard/dashboard.controller";
import { DashboardService } from "./dashboard/dashboard.service";
import { MeController } from "./me.controller";

@Controller("health")
class HealthController {
  @Public()
  @Get()
  health() {
    return { status: "ok" };
  }
}

@Module({
  controllers: [
    HealthController, AuthController, MeController, AccountController, BranchesController, DashboardController,
    PublicController, DevController, PlatformController, CatalogController,
    PricingController, TaxesController, ImportsController, ExportsController, InventoryController, TransfersController, PurchasingController, SalesController, CashController, FinanceController, ApprovalsController, DocumentsController, IntegrationsController, MediaController,
    AdminBranchesController, AdminMembersController, AdminRolesController, AdminSchedulesController, PublicInvitationsController,
  ],
  providers: [
    { provide: AppConfig, useFactory: () => new AppConfig() },
    dbProvider,
    platformDbProvider,
    workerDbProvider,
    OutboxHandlers,
    OutboxDispatcher,
    RateLimiter,
    DevMailbox,
    MailService,
    SecondFactorService,
    RecoveryChannels,
    RecoveryService,
    AccountService,
    MfaService,
    PlatformSettingsService,
    PlatformTenantsService,
    PlatformAuthService,
    PlatformGuard,
    RegistrationService,
    BranchesAdminService,
    MembersAdminService,
    RolesAdminService,
    InvitationAcceptService,
    MastersService,
    ProductsService,
    TaxesService,
    PricingService,
    ImportsService,
    ExportsService,
    StockEngine,
    InventoryService,
    PurchasingService,
    TransfersService,
    CountsService,
    CashService,
    FinanceService,
    ApprovalsService,
    IntegrationsService,
    ProductGroupsService,
    ProductImagesService,
    DocumentsService,
    NotificationsService,
    ReservationsService,
    CustomersService,
    ReturnsService,
    SalesService,
    SalesQueryService,
    PosService,
    QuotesService,
    SchedulesAdminService,
    AccessScheduleService,
    Clock,
    PasswordService,
    TokenService,
    AuthService,
    DashboardService,
    // Orden: primero autenticación, luego permisos.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
  exports: [PasswordService, RateLimiter, DevMailbox, Clock, OutboxDispatcher, OutboxHandlers],
})
export class AppModule {}
