import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import {
  CashCloseInput, CashCountInput, CashDecisionInput, CashMovementInput, CashOpenInput, CashParticipantInput, CashReasonInput, CashRegisterInput, CashRegisterPatch, CashSettings, CashTransferInput,
} from "@erp/contracts";
import { z } from "zod";
import { Ctx, RequirePermission } from "../common/decorators";
import type { RequestContext } from "../common/request-context";
import { ZodPipe } from "../common/zod.pipe";
import { CashService } from "./cash.service";

const uuid = new ParseUUIDPipe();
const SessionsQuery = z.object({ status: z.enum(["OPEN", "CLOSING", "CLOSED"]).optional(), registerId: z.string().uuid().optional() });
const ReportQuery = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/**
 * Cajas y turnos. Ver: cash.read · abrir turno, mover y contar: cash.open_session · cerrar: cash.close_session · decidir diferencias:
 * cash.approve_difference · reabrir: cash.reopen_session · administrar cajas y ajustes: cash.manage.
 */
@Controller("api/v1/cash")
export class CashController {
  constructor(@Inject(CashService) private readonly cash: CashService) {}

  @Get("registers") @RequirePermission("cash.read")
  registers(@Ctx() ctx: RequestContext) { return this.cash.listRegisters(ctx); }
  @Post("registers") @RequirePermission("cash.manage")
  createRegister(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CashRegisterInput)) b: CashRegisterInput) { return this.cash.createRegister(ctx, b); }
  @Patch("registers/:id") @RequirePermission("cash.manage")
  updateRegister(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(CashRegisterPatch)) b: CashRegisterPatch) { return this.cash.updateRegister(ctx, id, b); }

  @Get("settings") @RequirePermission("cash.read")
  settings(@Ctx() ctx: RequestContext) { return this.cash.getSettings(ctx); }
  @Put("settings") @RequirePermission("cash.manage")
  setSettings(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CashSettings)) b: CashSettings) { return this.cash.setSettings(ctx, b); }

  @Get("sessions") @RequirePermission("cash.read")
  sessions(@Ctx() ctx: RequestContext, @Query(new ZodPipe(SessionsQuery)) q: z.infer<typeof SessionsQuery>) { return this.cash.list(ctx, q); }
  @Get("sessions/mine") @RequirePermission("cash.open_session")
  mine(@Ctx() ctx: RequestContext) { return this.cash.mine(ctx); }
  @Get("sessions/:id") @RequirePermission("cash.read")
  session(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.cash.get(ctx, id); }
  @Post("sessions") @RequirePermission("cash.open_session")
  open(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CashOpenInput)) b: CashOpenInput) { return this.cash.open(ctx, b); }
  @Post("sessions/:id/participants") @HttpCode(200) @RequirePermission("cash.open_session")
  participant(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(CashParticipantInput)) b: CashParticipantInput) { return this.cash.addParticipant(ctx, id, b.userId); }
  @Post("sessions/:id/movements") @HttpCode(200) @RequirePermission("cash.open_session")
  movement(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(CashMovementInput)) b: CashMovementInput) { return this.cash.movement(ctx, id, b); }
  @Post("sessions/:id/transfer") @HttpCode(200) @RequirePermission("cash.open_session")
  transfer(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(CashTransferInput)) b: CashTransferInput) { return this.cash.transfer(ctx, id, b); }
  @Post("sessions/:id/count") @HttpCode(200) @RequirePermission("cash.open_session")
  count(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(CashCountInput)) b: CashCountInput) { return this.cash.count(ctx, id, b); }
  @Post("sessions/:id/close") @HttpCode(200) @RequirePermission("cash.close_session")
  close(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(CashCloseInput)) b: CashCloseInput) { return this.cash.close(ctx, id, b); }
  @Post("sessions/:id/decision") @HttpCode(200) @RequirePermission("cash.approve_difference")
  decide(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(CashDecisionInput)) b: CashDecisionInput) { return this.cash.decide(ctx, id, b); }
  @Post("sessions/:id/reopen") @HttpCode(200) @RequirePermission("cash.reopen_session")
  reopen(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(CashReasonInput)) b: CashReasonInput) { return this.cash.reopen(ctx, id, b.reason); }
  @Post("movements/:id/reverse") @HttpCode(200) @RequirePermission("cash.close_session")
  reverse(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(CashReasonInput)) b: CashReasonInput) { return this.cash.reverse(ctx, id, b.reason); }

  @Get("report") @RequirePermission("cash.read")
  report(@Ctx() ctx: RequestContext, @Query(new ZodPipe(ReportQuery)) q: z.infer<typeof ReportQuery>) { return this.cash.report(ctx, q); }
}
