import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { QueuePriority } from '../../common/const/constant.js';

export class PatientTakeNumberDto {
  @IsInt()
  roomId: number;
}

export class ReceptionCreateQueueDto {
  @IsInt()
  patientId: number;

  @IsInt()
  roomId: number;

  @IsOptional()
  @IsEnum(QueuePriority)
  priority?: QueuePriority;
}

export class DoctorCallNextDto {
  @IsInt()
  roomId: number;
}

export class CancelQueueDto {
  @IsNotEmpty({ message: 'Bắt buộc phải nhập lý do hủy số (cancel_reason)' })
  @IsString()
  reason: string;
}

export class UpdatePriorityDto {
  @IsEnum(QueuePriority)
  priority: QueuePriority;
}