import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../database/entities/audit-logs.entity.js';
import { User } from '../database/entities/users.entity.js';
import { Queue } from '../database/entities/queues.entity.js';
import { Patient } from '../database/entities/patients.entity.js';
import { Role } from '../database/entities/roles.entity.js';
import { PatientsController } from './patients.controller.js';
import { PatientsService } from './patients.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Patient, User, Role, Queue, AuditLog])],
  controllers: [PatientsController],
  providers: [PatientsService],
  exports: [PatientsService],
})
export class PatientsModule {}