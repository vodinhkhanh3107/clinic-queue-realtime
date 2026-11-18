import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PatientsService } from './patients.service.js';
import { CurrentUser, RequirePermissions } from '../common/decorators/auth.decorator.js';
import { CreatePatientDto, UpdatePatientDto } from './dto/patient.dto.js';


@Controller()
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  // --- Luồng Bệnh nhân tự phục vụ
  @RequirePermissions('patient.read.self')
  @Get('patients/me')
  getMyProfile(@CurrentUser('id') userId: number) {
    return this.patientsService.getMyProfile(userId);
  }

  @RequirePermissions('queue.read.self')
  @Get('patients/me/queues')
  getMyQueues(@CurrentUser('id') userId: number) {
    return this.patientsService.getMyQueues(userId);
  }

  // --- Luồng Lễ tân quản lý hồ sơ & tài khoản
  @RequirePermissions('patient.create')
  @Post('reception/patients')
  createPatient(
    @Body() dto: CreatePatientDto,
    @CurrentUser('id') userId: number,
  ) {
    return this.patientsService.createPatient(dto, userId);
  }

  @RequirePermissions('patient.list')
  @Get('reception/patients')
  searchPatients(@Query('q') q?: string) {
    return this.patientsService.searchPatients(q);
  }

  @RequirePermissions('patient.read')
  @Get('reception/patients/:id')
  getPatient(@Param('id', ParseIntPipe) id: number) {
    return this.patientsService.getPatientById(id);
  }

  @RequirePermissions('patient.update')
  @Patch('reception/patients/:id')
  updatePatient(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePatientDto,
  ) {
    return this.patientsService.updatePatient(id, dto);
  }

  @RequirePermissions('account.create')
  @Post('reception/patients/:id/account')
  activateAccount(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') userId: number,
    @Ip() ip: string,
  ) {
    return this.patientsService.activateAccount(id, userId, ip);
  }

  @RequirePermissions('account.reset_password')
  @Post('reception/patients/:id/reset-password')
  resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') userId: number,
    @Ip() ip: string,
  ) {
    return this.patientsService.resetPatientPassword(id, userId, ip);
  }
}