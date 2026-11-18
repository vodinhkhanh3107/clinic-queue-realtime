import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { QueuesService } from './queues.service.js';
import { CurrentUser, RequirePermissions } from '../common/decorators/auth.decorator.js';
import { CancelQueueDto, DoctorCallNextDto, PatientTakeNumberDto, ReceptionCreateQueueDto, UpdatePriorityDto } from './dto/queue.dto.js';
import { QueueStatus } from '../common/const/constant.js';
@Controller()
export class QueuesController {
  constructor(private readonly queuesService: QueuesService) {}

  // --- Danh mục Phòng khám (mục 9.2) ---
  @Get('rooms')
  getActiveRooms() {
    return this.queuesService.getActiveRooms();
  }

  // --- Bệnh nhân tự lấy số ---
  @RequirePermissions('queue.take.self')
  @Post('queues/take-number')
  patientTakeNumber(
    @CurrentUser('id') userId: number,
    @Body() dto: PatientTakeNumberDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.queuesService.patientTakeNumber(userId, dto, idempotencyKey);
  }

  // --- Lễ tân tạo số hộ, xem queue & in phiếu ---
  @RequirePermissions('queue.take.onbehalf')
  @Post('reception/queues')
  receptionCreateQueue(
    @CurrentUser('id') userId: number,
    @Body() dto: ReceptionCreateQueueDto,
  ) {
    return this.queuesService.receptionCreateQueue(userId, dto);
  }

  @RequirePermissions('queue.read.all')
  @Get('reception/queues')
  getReceptionQueues(
    @Query('roomId') roomId?: number,
    @Query('date') date?: string,
    @Query('status') status?: QueueStatus,
  ) {
    return this.queuesService.getReceptionQueues(roomId, date, status);
  }

  @RequirePermissions('ticket.print')
  @Get('queues/:id/ticket')
  printTicket(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') userId: number,
    @Ip() ip: string,
  ) {
    return this.queuesService.printTicket(id, userId, ip);
  }

  @RequirePermissions('queue.priority.update')
  @Patch('queues/:id/priority')
  updatePriority(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePriorityDto,
    @CurrentUser() user: any,
    @Ip() ip: string,
  ) {
    return this.queuesService.updatePriority(id, dto, user, ip);
  }

  // --- Bác sĩ xem phòng, gọi số & chuyển trạng thái ---
  @Get('doctors/me')
  getDoctorMe(@CurrentUser('id') userId: number) {
    return this.queuesService.getDoctorMe(userId);
  }

  @RequirePermissions('queue.read.room')
  @Get('doctors/me/queue')
  getDoctorRoomQueues(
    @CurrentUser('id') userId: number,
    @Query('roomId', ParseIntPipe) roomId: number,
  ) {
    return this.queuesService.getDoctorRoomQueues(userId, roomId);
  }

  @RequirePermissions('queue.call')
  @HttpCode(HttpStatus.OK)
  @Post('doctors/me/call-next')
  callNext(
    @CurrentUser('id') userId: number,
    @Body() dto: DoctorCallNextDto,
  ) {
    return this.queuesService.callNext(userId, dto);
  }

  @RequirePermissions('queue.call')
  @HttpCode(HttpStatus.OK)
  @Post('queues/:id/call')
  callSpecific(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.queuesService.executeTransition(id, 'CALL_SPECIFIC', user);
  }

  @RequirePermissions('queue.recall')
  @HttpCode(HttpStatus.OK)
  @Post('queues/:id/recall')
  recall(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.queuesService.executeTransition(id, 'RECALL', user);
  }

  @RequirePermissions('queue.start')
  @HttpCode(HttpStatus.OK)
  @Post('queues/:id/start')
  start(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.queuesService.executeTransition(id, 'START', user);
  }

  @RequirePermissions('queue.complete')
  @HttpCode(HttpStatus.OK)
  @Post('queues/:id/complete')
  complete(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.queuesService.executeTransition(id, 'COMPLETE', user);
  }

  @RequirePermissions('queue.skip')
  @HttpCode(HttpStatus.OK)
  @Post('queues/:id/skip')
  skip(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.queuesService.executeTransition(id, 'SKIP', user);
  }

  @RequirePermissions('queue.cancel', 'queue.cancel.self')
  @HttpCode(HttpStatus.OK)
  @Post('queues/:id/cancel')
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelQueueDto,
    @CurrentUser() user: any,
  ) {
    return this.queuesService.executeTransition(id, 'CANCEL', user, {
      cancelReason: dto.reason,
    });
  }
}