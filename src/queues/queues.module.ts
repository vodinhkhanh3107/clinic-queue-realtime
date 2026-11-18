import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Room } from '../database/entities/rooms.entity.js';
import { Queue } from '../database/entities/queues.entity.js';
import { QueueEvent } from '../database/entities/queue-events.entity.js';
import { QueueCounter } from '../database/entities/queue-counters.entity.js';
import { Patient } from '../database/entities/patients.entity.js';
import { Doctor } from '../database/entities/doctors.entity.js';
import { DoctorRoomAssignment } from '../database/entities/doctor-room-assignments.entity.js';
import { AuditLog } from '../database/entities/audit-logs.entity.js';
import { QueuesController } from './queues.controller.js';
import { QueuesService } from './queues.service.js';


@Module({
  imports: [
    TypeOrmModule.forFeature([
      Room,
      Queue,
      QueueEvent,
      QueueCounter,
      Patient,
      Doctor,
      DoctorRoomAssignment,
      AuditLog,
    ]),
  ],
  controllers: [QueuesController],
  providers: [QueuesService],
  exports: [QueuesService],
})
export class QueuesModule {}