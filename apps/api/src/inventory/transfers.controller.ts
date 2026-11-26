import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ReservationInput, ReservationStatus, CountEntry, CountInput, CountStatus, TransferInput, TransferReceiveRequest, TransferStatus } from "@erp/contracts";
import { z } from "zod";
import { Ctx, RequirePermission } from "../common/decorators";
import type { RequestContext } from "../common/request-context";
import { ZodPipe } from "../common/zod.pipe";
import { CountsService } from "./counts.service";
import { ReservationsService } from "./reservations.service";
import { TransfersService } from "./transfers.service";

const uuid = new ParseUUIDPipe();
const TransferQuery = z.object({ status: TransferStatus.optional() });
const CountQuery = z.object({ status: CountStatus.optional() });

/**
 * Transferencias (inventory.read para ver · inventory.transfer para operar) y conteos físicos (contar y enviar:
 * inventory.adjust.request · aplicar o devolver: inventory.adjust.approve). El alcance por sucursal lo valida el servicio.
 */
@Controller("api/v1/inventory")
export class TransfersController {
  constructor(
    @Inject(TransfersService) private readonly transfers: TransfersService,
    @Inject(CountsService) private readonly counts: CountsService,
    @Inject(ReservationsService) private readonly reservations: ReservationsService,
  ) {}

  @Get("reservations") @RequirePermission("inventory.read")
  listReservations(@Ctx() ctx: RequestContext, @Query(new ZodPipe(z.object({ status: ReservationStatus.optional() }))) q: { status?: z.infer<typeof ReservationStatus> }) { return this.reservations.list(ctx, q.status); }
  @Get("reservations/:id") @RequirePermission("inventory.read")
  getReservation(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.reservations.get(ctx, id); }
  @Post("reservations") @RequirePermission("inventory.reserve")
  reserve(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ReservationInput)) b: ReservationInput) { return this.reservations.create(ctx, b); }
  @Post("reservations/:id/release") @HttpCode(200) @RequirePermission("inventory.reserve")
  release(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.reservations.release(ctx, id); }

  @Get("transfers") @RequirePermission("inventory.read")
  listTransfers(@Ctx() ctx: RequestContext, @Query(new ZodPipe(TransferQuery)) q: z.infer<typeof TransferQuery>) { return this.transfers.list(ctx, q.status); }
  @Get("transfers/:id") @RequirePermission("inventory.read")
  getTransfer(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.transfers.get(ctx, id); }
  @Post("transfers") @RequirePermission("inventory.transfer")
  createTransfer(@Ctx() ctx: RequestContext, @Body(new ZodPipe(TransferInput)) b: TransferInput) { return this.transfers.create(ctx, b); }
  @Post("transfers/:id/dispatch") @HttpCode(200) @RequirePermission("inventory.transfer")
  dispatch(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.transfers.dispatch(ctx, id); }
  @Post("transfers/:id/receive") @HttpCode(200) @RequirePermission("inventory.transfer")
  receive(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(TransferReceiveRequest)) b: TransferReceiveRequest) { return this.transfers.receive(ctx, id, b); }
  @Post("transfers/:id/cancel") @HttpCode(200) @RequirePermission("inventory.transfer")
  cancelTransfer(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.transfers.cancel(ctx, id); }

  @Get("counts") @RequirePermission("inventory.read")
  listCounts(@Ctx() ctx: RequestContext, @Query(new ZodPipe(CountQuery)) q: z.infer<typeof CountQuery>) { return this.counts.list(ctx, q.status); }
  @Get("counts/:id") @RequirePermission("inventory.read")
  getCount(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.counts.get(ctx, id); }
  @Post("counts") @RequirePermission("inventory.adjust.request")
  openCount(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CountInput)) b: CountInput) { return this.counts.create(ctx, b); }
  @Put("counts/:id/lines") @RequirePermission("inventory.adjust.request")
  enter(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(CountEntry)) b: CountEntry) { return this.counts.enter(ctx, id, b); }
  @Post("counts/:id/submit") @HttpCode(200) @RequirePermission("inventory.adjust.request")
  submit(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.counts.submit(ctx, id); }
  @Post("counts/:id/cancel") @HttpCode(200) @RequirePermission("inventory.adjust.request")
  cancelCount(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.counts.cancel(ctx, id); }
  @Post("counts/:id/reopen") @HttpCode(200) @RequirePermission("inventory.adjust.approve")
  reopen(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.counts.reopen(ctx, id); }
  @Post("counts/:id/apply") @HttpCode(200) @RequirePermission("inventory.adjust.approve")
  apply(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.counts.apply(ctx, id); }
}
