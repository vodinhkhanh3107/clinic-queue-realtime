import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { AuditAction, QueueEventType, QueuePriority, QueueSource, QueueStatus, RoomStatus } from '../common/const/constant.js';
import { Queue } from '../database/entities/queues.entity.js';
import { Room } from '../database/entities/rooms.entity.js';
import { Patient } from '../database/entities/patients.entity.js';
import { Doctor } from '../database/entities/doctors.entity.js';
import { DoctorRoomAssignment } from '../database/entities/doctor-room-assignments.entity.js';
import { AuditLog } from '../database/entities/audit-logs.entity.js';
import { DoctorCallNextDto, PatientTakeNumberDto, ReceptionCreateQueueDto, UpdatePriorityDto } from './dto/queue.dto.js';
import { formatQueueNumber, getVietnamDateAndTime } from '../common/utils/clinic.util.js';
import { QueueCounter } from '../database/entities/queue-counters.entity.js';
import { QueueEvent } from '../database/entities/queue-events.entity.js';
import { PRIORITY_RANK_MAP, QUEUE_TRANSITIONS, QueueAction } from './queue-transitions.js';

export interface RealtimeQueuePayload {
  eventId: string;
  eventType: QueueEventType;
  queue: Queue;
}

@Injectable()
export class QueuesService {
  // Lưu Idempotency-Key trong bộ nhớ đệm (TTL 10 phút)
  private idempotencyStore = new Map<string, { result: any; expiresAt: number }>();

  constructor(
    @InjectRepository(Room) private roomRepo: Repository<Room>,
    @InjectRepository(Queue) private queueRepo: Repository<Queue>,
    @InjectRepository(Patient) private patientRepo: Repository<Patient>,
    @InjectRepository(Doctor) private doctorRepo: Repository<Doctor>,
    @InjectRepository(DoctorRoomAssignment)
    private assignRepo: Repository<DoctorRoomAssignment>,
    @InjectRepository(AuditLog) private auditRepo: Repository<AuditLog>,
    private dataSource: DataSource,
    private eventEmitter: EventEmitter2,
  ) {}

  // ==================== 1. DANH MỤC PHÒNG & BÁC SĨ ====================

  async getActiveRooms() {
    return this.roomRepo.find({
      where: { status: RoomStatus.ACTIVE },
      order: { room_code: 'ASC' },
    });
  }

  async getDoctorMe(userId: number) {
    const doctor = await this.doctorRepo.findOne({ where: { user_id: userId } });
    if (!doctor) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy thông tin bác sĩ.',
      });
    }
    const assignments = await this.assignRepo.find({
      where: { doctor_id: doctor.id, unassigned_at: IsNull() },
      relations: {
        'room': true
      },
    });
    return {
      ...doctor,
      assignedRooms: assignments.map((a) => a.room),
    };
  }

  private async verifyDoctorRoomAssignment(userId: number, roomId: number): Promise<Doctor> {
    const doctor = await this.doctorRepo.findOne({ where: { user_id: userId } });
    if (!doctor) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Tài khoản không phải là bác sĩ.',
      });
    }
    const assigned = await this.assignRepo.findOne({
      where: { doctor_id: doctor.id, room_id: roomId, unassigned_at: IsNull() },
    });
    if (!assigned) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Bạn không được phân công phụ trách phòng khám này.',
      });
    }
    return doctor;
  }

  // ==================== 2. LẤY SỐ THỨ TỰ ====================

  async patientTakeNumber(
    userId: number,
    dto: PatientTakeNumberDto,
    idempotencyKey?: string,
  ) {
    if (!idempotencyKey || !idempotencyKey.trim()) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Bắt buộc phải có header Idempotency-Key khi lấy số.',
      });
    }

    const cacheKey = `${userId}:${idempotencyKey.trim()}`;
    const cached = this.idempotencyStore.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    const patient = await this.patientRepo.findOne({ where: { user_id: userId } });
    if (!patient) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy hồ sơ bệnh nhân.',
      });
    }

    // Bệnh nhân tự lấy số luôn mặc định priority = NORMAL
    const result = await this.issueQueueTicket({
      patientId: patient.id,
      roomId: dto.roomId,
      priority: QueuePriority.NORMAL,
      source: QueueSource.PATIENT,
      createdByUserId: userId,
    });

    this.idempotencyStore.set(cacheKey, {
      result,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    return result;
  }

  async receptionCreateQueue(userId: number, dto: ReceptionCreateQueueDto) {
    return this.issueQueueTicket({
      patientId: dto.patientId,
      roomId: dto.roomId,
      priority: dto.priority || QueuePriority.NORMAL,
      source: QueueSource.RECEPTIONIST,
      createdByUserId: userId,
    });
  }

  private async issueQueueTicket(params: {
    patientId: number;
    roomId: number;
    priority: QueuePriority;
    source: QueueSource;
    createdByUserId: number;
  }) {
    const { date: queueDate, time: currentTime } = getVietnamDateAndTime();

    const [patient, room] = await Promise.all([
      this.patientRepo.findOne({ where: { id: params.patientId } }),
      this.roomRepo.findOne({ where: { id: params.roomId } }),
    ]);

    if (!patient) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Hồ sơ bệnh nhân không tồn tại.',
      });
    }
    if (!room) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Phòng khám không tồn tại.',
      });
    }

    // Kiểm tra phòng ACTIVE và trong giờ mở cửa
    if (
      room.status !== RoomStatus.ACTIVE ||
      currentTime < room.open_time ||
      currentTime > room.close_time
    ) {
      throw new ConflictException({
        code: 'ROOM_CLOSED',
        message: `Phòng khám hiện đang đóng cửa (Giờ mở cửa: ${room.open_time} - ${room.close_time}).`,
      });
    }

    // Giới hạn tối đa 3 lượt lấy số mỗi bệnh nhân mỗi ngày 
    const patientDailyCount = await this.queueRepo.count({
      where: { patient_id: patient.id, queue_date: queueDate },
    });
    if (patientDailyCount >= 3) {
      throw new ConflictException({
        code: 'DAILY_LIMIT_EXCEEDED',
        message: 'Bệnh nhân đã đạt giới hạn tối đa 3 lượt lấy số trong ngày.',
      });
    }

    // Bước 1 (ngoài transaction): bảo đảm dòng counter của (phòng, ngày) tồn tại
    await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(QueueCounter)
      .values({ room_id: room.id, queue_date: queueDate, last_number: 0 })
      .orIgnore()
      .execute();

    // Bước 2 & 3 (trong transaction): tăng số nguyên tử + tạo queue + tạo queue_event
    let savedQueue!: Queue;
    let savedEvent!: QueueEvent;

    try {
      await this.dataSource.transaction(async (manager) => {
        // Tăng số, lấy X-lock ngay trên dòng counter
        await manager
          .createQueryBuilder()
          .update(QueueCounter)
          .set({ last_number: () => 'last_number + 1' })
          .where('room_id = :roomId AND queue_date = :queueDate', {
            roomId: room.id,
            queueDate,
          })
          .execute();

        // Đọc số vừa cấp
        const counter = await manager
          .createQueryBuilder(QueueCounter, 'qc')
          .setLock('pessimistic_write')
          .where('qc.room_id = :roomId AND qc.queue_date = :queueDate', {
            roomId: room.id,
            queueDate,
          })
          .getOneOrFail();

        if (room.max_daily_tickets && counter.last_number > room.max_daily_tickets) {
          throw new ConflictException({
            code: 'ROOM_FULL',
            message: 'Phòng khám đã phát hết số lượng phiếu tối đa trong ngày.',
          });
        }

        const seq = counter.last_number;
        const queueNumber = formatQueueNumber(room.queue_prefix, seq);

        const newQueue = manager.create(Queue, {
          patient_id: patient.id,
          room_id: room.id,
          created_by_user_id: params.createdByUserId,
          queue_date: queueDate,
          queue_sequence: seq,
          queue_number: queueNumber,
          priority: params.priority,
          priority_rank: PRIORITY_RANK_MAP[params.priority] ?? 0,
          status: QueueStatus.WAITING,
          source: params.source,
        });

        savedQueue = await manager.save(Queue, newQueue);

        const event = manager.create(QueueEvent, {
          queue_id: savedQueue.id,
          performed_by_user_id: params.createdByUserId,
          event_type: QueueEventType.TAKEN,
          from_status: null,
          to_status: QueueStatus.WAITING,
          metadata: { source: params.source, priority: params.priority },
        });
        savedEvent = await manager.save(QueueEvent, event);
      });
    } catch (err: any) {
      // Bắt lỗi duplicate key uq_queue_active từ DB 
      if (err?.code === 'ER_DUP_ENTRY' && err?.message?.includes('uq_queue_active')) {
        throw new ConflictException({
          code: 'DUPLICATE_ACTIVE_QUEUE',
          message: 'Bệnh nhân đang có một số khám chưa hoàn tất tại phòng này trong hôm nay.',
        });
      }
      throw err;
    }

    // Sau khi COMMIT thành công mới phát sự kiện Realtime
    savedQueue.room = room;
    savedQueue.patient = patient;
    this.emitRealtime(savedEvent.id, QueueEventType.TAKEN, savedQueue);

    return {
      queueId: savedQueue.id,
      queueNumber: savedQueue.queue_number,
      queueSequence: savedQueue.queue_sequence,
      queueDate: savedQueue.queue_date,
      priority: savedQueue.priority,
      status: savedQueue.status,
      roomName: room.room_name,
      roomId: room.id,
      patientName: patient.full_name,
      patientCode: patient.patient_code,
    };
  }

  // ==================== 3. BÁC SĨ GỌI SỐ TIẾP THEO ====================

  async callNext(userId: number, dto: DoctorCallNextDto) {
    const doctor = await this.verifyDoctorRoomAssignment(userId, dto.roomId);
    const { date: queueDate } = getVietnamDateAndTime();

    let calledQueue!: Queue;
    let calledEvent!: QueueEvent;

    // Chạy transaction ở mức READ COMMITTED để giảm gap lock
    await this.dataSource.transaction('READ COMMITTED', async (manager) => {
      // 1) Khóa hàng bác sĩ: chặn bấm đúp / gọi song song của cùng một bác sĩ
      await manager
        .createQueryBuilder(Doctor, 'd')
        .setLock('pessimistic_write')
        .where('d.id = :doctorId', { doctorId: doctor.id })
        .getOne();

      // 2) Bác sĩ đang có queue CALLED / IN_PROGRESS thì trả 409 DOCTOR_BUSY
      const activeQueue = await manager.findOne(Queue, {
        where: {
          doctor_id: doctor.id,
          queue_date: queueDate,
          status: In([QueueStatus.CALLED, QueueStatus.IN_PROGRESS]),
        },
      });
      if (activeQueue) {
        throw new ConflictException({
          code: 'DOCTOR_BUSY',
          message: `Bạn đang xử lý số khám ${activeQueue.queue_number} (${activeQueue.status}). Vui lòng hoàn tất hoặc bỏ qua trước khi gọi số mới.`,
        });
      }

      // Kiểm tra priority_streak để chống đói cho queue NORMAL 
      const counter = await manager.findOne(QueueCounter, {
        where: { room_id: dto.roomId, queue_date: queueDate },
      });

      let targetQueue: Queue | null = null;

      if (counter && counter.priority_streak >= 3) {
        // Thử tìm queue NORMAL cũ nhất trước
        targetQueue = await manager
          .createQueryBuilder(Queue, 'q')
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .where('q.room_id = :roomId', { roomId: dto.roomId })
          .andWhere('q.queue_date = :queueDate', { queueDate })
          .andWhere('q.status = :status', { status: QueueStatus.WAITING })
          .andWhere('q.priority_rank = 0')
          .orderBy('q.queue_sequence', 'ASC')
          .getOne();
      }

      // 3) Nếu chưa chọn được từ luồng chống đói, lấy queue theo chuẩn ix_queues_pick (SKIP LOCKED)
      if (!targetQueue) {
        targetQueue = await manager
          .createQueryBuilder(Queue, 'q')
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .where('q.room_id = :roomId', { roomId: dto.roomId })
          .andWhere('q.queue_date = :queueDate', { queueDate })
          .andWhere('q.status = :status', { status: QueueStatus.WAITING })
          .orderBy('q.priority_rank', 'DESC')
          .addOrderBy('q.queue_sequence', 'ASC')
          .getOne();
      }

      if (!targetQueue) {
        throw new NotFoundException({
          code: 'QUEUE_EMPTY',
          message: 'Hiện không còn bệnh nhân nào đang chờ trong phòng khám này.',
        });
      }

      // 4) Cập nhật trạng thái có điều kiện status = WAITING
      const now = new Date();
      const updateRes = await manager
        .createQueryBuilder()
        .update(Queue)
        .set({
          status: QueueStatus.CALLED,
          doctor_id: doctor.id,
          called_at: now,
        })
        .where('id = :id AND status = :status', {
          id: targetQueue.id,
          status: QueueStatus.WAITING,
        })
        .execute();

      if (!updateRes.affected) {
        throw new ConflictException({
          code: 'INVALID_TRANSITION',
          message: 'Trạng thái hàng đợi đã thay đổi, vui lòng thử lại.',
        });
      }

      // Cập nhật priority_streak trên bảng queue_counters
      if (counter) {
        const nextStreak =
          targetQueue.priority_rank > 0 ? counter.priority_streak + 1 : 0;
        await manager.update(QueueCounter, counter.id, {
          priority_streak: nextStreak,
        });
      }

      // 5) Ghi queue_events trong cùng transaction
      const event = manager.create(QueueEvent, {
        queue_id: targetQueue.id,
        performed_by_user_id: userId,
        event_type: QueueEventType.CALLED,
        from_status: QueueStatus.WAITING,
        to_status: QueueStatus.CALLED,
        metadata: { doctorId: doctor.id },
      });
      calledEvent = await manager.save(QueueEvent, event);

      calledQueue = await manager.findOneOrFail(Queue, {
        where: { id: targetQueue.id },
        relations: {
            'patient': true,
            'room': true, 
            'doctor': true
        },
      });
    });

    this.emitRealtime(calledEvent.id, QueueEventType.CALLED, calledQueue);
    return calledQueue;
  }

  // ==================== 4. THAO TÁC TRẠNG THÁI QUA BẢNG TRANSITION ====================

  async executeTransition(
    queueId: number,
    action: QueueAction,
    user: { id: number; role_name: string },
    extra?: { cancelReason?: string },
  ) {
    const rule = QUEUE_TRANSITIONS[action];
    let updatedQueue!: Queue;
    let savedEvent!: QueueEvent;

    await this.dataSource.transaction(async (manager) => {
      const queue = await manager.findOne(Queue, {
        where: { id: queueId },
        relations: {
          'patient': true,
          'room': true,
          'doctor': true
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!queue) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Không tìm thấy lượt khám.',
        });
      }

      // Resource authorization trong Service
      let actorDoctor: Doctor | null = null;
      if (user.role_name === 'PATIENT') {
        const patient = await manager.findOne(Patient, {
          where: { user_id: user.id },
        });
        // Trả 404 thay vì 403 nếu không phải queue của bệnh nhân đó (mục 5 & 13)
        if (!patient || queue.patient_id !== patient.id) {
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: 'Không tìm thấy lượt khám.',
          });
        }
      } else if (user.role_name === 'DOCTOR') {
        actorDoctor = await this.verifyDoctorRoomAssignment(user.id, queue.room_id);
      }

      // Kiểm tra trạng thái hợp lệ theo bảng QUEUE_TRANSITIONS
      if (!rule.from.includes(queue.status)) {
        throw new ConflictException({
          code: 'INVALID_TRANSITION',
          message: `Không thể thực hiện thao tác ${action} khi lượt khám đang ở trạng thái ${queue.status}.`,
        });
      }

      const now = new Date();
      let targetStatus = rule.to;
      let eventType = rule.event;
      const updatePayload: Partial<Queue> = {};
      const eventMetadata: Record<string, any> = {};

      // Xử lý chi tiết từng Action
      if (action === 'CALL_SPECIFIC') {
        if (queue.skip_count >= 3) {
          throw new ConflictException({
            code: 'INVALID_TRANSITION',
            message: 'Lượt khám đã vượt quá số lần gọi lại cho phép (skip_count >= 3).',
          });
        }
        if (actorDoctor) {
          const busy = await manager.findOne(Queue, {
            where: {
              doctor_id: actorDoctor.id,
              queue_date: queue.queue_date,
              status: In([QueueStatus.CALLED, QueueStatus.IN_PROGRESS]),
            },
          });
          if (busy) {
            throw new ConflictException({
              code: 'DOCTOR_BUSY',
              message: `Bạn đang xử lý số khám ${busy.queue_number}.`,
            });
          }
          updatePayload.doctor_id = actorDoctor.id;
        }
        updatePayload.called_at = now;
      } else if (action === 'RECALL') {
        const recallCount = await manager.count(QueueEvent, {
          where: { queue_id: queue.id, event_type: QueueEventType.RECALLED },
        });
        eventMetadata.recall_count = recallCount + 1;
        updatePayload.called_at = now;
      } else if (action === 'START') {
        updatePayload.started_at = now;
      } else if (action === 'COMPLETE') {
        updatePayload.completed_at = now;
      } else if (action === 'SKIP') {
        const nextSkipCount = queue.skip_count + 1;
        updatePayload.skip_count = nextSkipCount;
        updatePayload.skipped_at = now;

        // Bị skip lần thứ 3 chuyển thẳng sang CANCELLED (NO_SHOW)
        if (nextSkipCount >= 3) {
          targetStatus = QueueStatus.CANCELLED;
          eventType = QueueEventType.CANCELLED;
          updatePayload.cancel_reason = 'NO_SHOW';
          updatePayload.cancelled_at = now;
          eventMetadata.reason = 'NO_SHOW_THIRD_SKIP';
        }
      } else if (action === 'CANCEL') {
        if (!extra?.cancelReason?.trim()) {
          throw new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: 'Bắt buộc phải cung cấp lý do hủy (reason).',
          });
        }
        updatePayload.cancel_reason = extra.cancelReason.trim();
        updatePayload.cancelled_at = now;
        eventMetadata.reason = extra.cancelReason.trim();
      }

      updatePayload.status = targetStatus;

      // UPDATE có điều kiện trạng thái hiện tại (WHERE id = ? AND status = ?)
      const res = await manager
        .createQueryBuilder()
        .update(Queue)
        .set(updatePayload)
        .where('id = :id AND status = :currentStatus', {
          id: queue.id,
          currentStatus: queue.status,
        })
        .execute();

      if (!res.affected) {
        throw new ConflictException({
          code: 'INVALID_TRANSITION',
          message: 'Trạng thái lượt khám vừa bị thay đổi bởi thao tác khác.',
        });
      }

      const ev = manager.create(QueueEvent, {
        queue_id: queue.id,
        performed_by_user_id: user.id,
        event_type: eventType,
        from_status: queue.status,
        to_status: targetStatus,
        metadata: Object.keys(eventMetadata).length ? eventMetadata : null,
      });
      savedEvent = await manager.save(QueueEvent, ev);

      updatedQueue = await manager.findOneOrFail(Queue, {
        where: { id: queue.id },
        relations: {
            'patient': true,
            'room': true,
            'doctor': true
        },
      });
    });

    this.emitRealtime(savedEvent.id, savedEvent.event_type, updatedQueue);
    return updatedQueue;
  }

  // ==================== 5. ĐỔI ƯU TIÊN, TRA CỨU & IN LẠI PHIẾU ====================

  async updatePriority(
    queueId: number,
    dto: UpdatePriorityDto,
    user: { id: number; role_name: string },
    ip?: string,
  ) {
    const queue = await this.queueRepo.findOne({ where: { id: queueId } });
    if (!queue) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy lượt khám.',
      });
    }

    if (user.role_name === 'DOCTOR') {
      await this.verifyDoctorRoomAssignment(user.id, queue.room_id);
    }

    const oldPriority = queue.priority;
    queue.priority = dto.priority;
    queue.priority_rank = PRIORITY_RANK_MAP[dto.priority] ?? 0;
    const saved = await this.queueRepo.save(queue);

    await this.auditRepo.save({
      actor_user_id: user.id,
      action: AuditAction.PRIORITY_CHANGED,
      target_type: 'QUEUE',
      target_id: queue.id,
      metadata: { from: oldPriority, to: dto.priority },
      ip: ip || null,
    });

    return saved;
  }

  async getDoctorRoomQueues(userId: number, roomId: number) {
    await this.verifyDoctorRoomAssignment(userId, roomId);
    const { date: queueDate } = getVietnamDateAndTime();

    return this.queueRepo.find({
      where: { room_id: roomId, queue_date: queueDate },
      relations: {
        'patient': true,
        'doctor': true
      },
      order: { priority_rank: 'DESC', queue_sequence: 'ASC' },
    });
  }

  async getReceptionQueues(roomId?: number, date?: string, status?: QueueStatus) {
    const { date: today } = getVietnamDateAndTime();
    const where: any = { queue_date: date || today };
    if (roomId) where.room_id = Number(roomId);
    if (status) where.status = status;

    return this.queueRepo.find({
      where,
      relations: {
        'patient': true,
        'room': true,
        'doctor': true
      },
      order: { priority_rank: 'DESC', queue_sequence: 'ASC' },
    });
  }

  async printTicket(queueId: number, actorUserId: number, ip?: string) {
    const queue = await this.queueRepo.findOne({
      where: { id: queueId },
      relations: {
        'room': true,
        'patient': true
      },
    });
    if (!queue) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy phiếu khám.',
      });
    }

    // Ghi audit_logs TICKET_REPRINTED
    await this.auditRepo.save({
      actor_user_id: actorUserId,
      action: AuditAction.TICKET_REPRINTED,
      target_type: 'QUEUE',
      target_id: queue.id,
      metadata: { queueNumber: queue.queue_number },
      ip: ip || null,
    });

    return {
      queueId: queue.id,
      queueNumber: queue.queue_number,
      roomName: queue.room.room_name,
      queueDate: queue.queue_date,
      patientName: queue.patient.full_name,
    };
  }

  // ==================== 6. JOB NỀN TỰ ĐỘNG SKIP & ĐÓNG NGÀY ====================

  @Cron(CronExpression.EVERY_MINUTE)
  async handleBackgroundQueueJobs() {
    const { date: today, time: currentTime } = getVietnamDateAndTime();
    const rooms = await this.roomRepo.find();

    for (const room of rooms) {
      // 6.1. Tự động skip: queue CALLED quá call_timeout_minutes mà chưa START
      const calledQueues = await this.queueRepo.find({
        where: {
          room_id: room.id,
          queue_date: today,
          status: QueueStatus.CALLED,
        },
        relations: {
          'patient': true,
          'room': true
        },
      });

      const timeoutMs = (room.call_timeout_minutes || 5) * 60 * 1000;
      const now = Date.now();

      for (const q of calledQueues) {
        if (q.called_at && now - new Date(q.called_at).getTime() >= timeoutMs) {
          await this.autoSkipTimeoutQueue(q.id);
        }
      }

      // 6.2. Đóng ngày: khi đến close_time, chuyển WAITING, CALLED, SKIPPED -> CANCELLED (END_OF_DAY)
      if (currentTime >= room.close_time) {
        await this.closeEndOfDayQueues(room.id, today);
      }
    }
  }

  private async autoSkipTimeoutQueue(queueId: number) {
    let updatedQueue: Queue | null = null;
    let savedEvent: QueueEvent | null = null;

    await this.dataSource.transaction(async (manager) => {
      const q = await manager.findOne(Queue, {
        where: { id: queueId, status: QueueStatus.CALLED },
        lock: { mode: 'pessimistic_write' },
      });
      if (!q) return;

      const nextSkip = q.skip_count + 1;
      const isThirdSkip = nextSkip >= 3;
      const targetStatus = isThirdSkip
        ? QueueStatus.CANCELLED
        : QueueStatus.SKIPPED;
      const eventType = isThirdSkip
        ? QueueEventType.CANCELLED
        : QueueEventType.SKIPPED;

      await manager.update(Queue, q.id, {
        status: targetStatus,
        skip_count: nextSkip,
        skipped_at: new Date(),
        ...(isThirdSkip
          ? { cancel_reason: 'NO_SHOW', cancelled_at: new Date() }
          : {}),
      });

      savedEvent = await manager.save(
        manager.create(QueueEvent, {
          queue_id: q.id,
          performed_by_user_id: null, // NULL = hệ thống
          event_type: eventType,
          from_status: QueueStatus.CALLED,
          to_status: targetStatus,
          metadata: { reason: isThirdSkip ? 'NO_SHOW' : 'AUTO_TIMEOUT' },
        }),
      );

      updatedQueue = await manager.findOne(Queue, {
        where: { id: q.id },
        relations: {
          'patient': true,
          'room': true,
          'doctor': true
        },
      });
    });

    if (updatedQueue && savedEvent) {
      this.emitRealtime(
        (savedEvent as QueueEvent).id,
        (savedEvent as QueueEvent).event_type,
        updatedQueue,
      );
    }
  }

  private async closeEndOfDayQueues(roomId: number, queueDate: string) {
    const pendingQueues = await this.queueRepo.find({
      where: {
        room_id: roomId,
        queue_date: queueDate,
        status: In([
          QueueStatus.WAITING,
          QueueStatus.CALLED,
          QueueStatus.SKIPPED,
        ]),
      },
    });

    for (const q of pendingQueues) {
      let updatedQueue: Queue | null = null;
      let savedEvent: QueueEvent | null = null;

      await this.dataSource.transaction(async (manager) => {
        const current = await manager.findOne(Queue, {
          where: { id: q.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (
          !current ||
          ![
            QueueStatus.WAITING,
            QueueStatus.CALLED,
            QueueStatus.SKIPPED,
          ].includes(current.status)
        ) {
          return;
        }

        const prevStatus = current.status;
        await manager.update(Queue, current.id, {
          status: QueueStatus.CANCELLED,
          cancel_reason: 'END_OF_DAY',
          cancelled_at: new Date(),
        });

        savedEvent = await manager.save(
          manager.create(QueueEvent, {
            queue_id: current.id,
            performed_by_user_id: null,
            event_type: QueueEventType.CANCELLED,
            from_status: prevStatus,
            to_status: QueueStatus.CANCELLED,
            metadata: { reason: 'END_OF_DAY' },
          }),
        );

        updatedQueue = await manager.findOne(Queue, {
          where: { id: current.id },
          relations: {
            'patient': true,
            'room': true,
            'doctor': true
          },
        });
      });

      if (updatedQueue && savedEvent) {
        this.emitRealtime(
          (savedEvent as QueueEvent).id,
          QueueEventType.CANCELLED,
          updatedQueue,
        );
      }
    }
  }

  // Cache ngắn 1.5 giây cho màn hình Display
  private displayCache = new Map<number, { data: any; expiresAt: number }>();

  // ==================== 7. DISPLAY API ====================

  async getDisplayRoomData(roomId: number) {
    const now = Date.now();
    const cached = this.displayCache.get(roomId);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const room = await this.roomRepo.findOne({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy phòng khám.',
      });
    }

    const { date: today } = getVietnamDateAndTime();

    // 1. Lấy các số đang được gọi (CALLED) hoặc đang khám (IN_PROGRESS) trong phòng
    // Phòng có nhiều bác sĩ sẽ có nhiều số đang gọi cùng lúc 
    const callingQueues = await this.queueRepo.find({
      where: {
        room_id: roomId,
        queue_date: today,
        status: In([QueueStatus.CALLED, QueueStatus.IN_PROGRESS]),
      },
      order: { called_at: 'DESC', queue_sequence: 'ASC' },
    });

    // 2. Lấy tối đa 5 số kế tiếp đang chờ (WAITING) theo thứ tự ưu tiên
    const nextQueues = await this.queueRepo.find({
      where: {
        room_id: roomId,
        queue_date: today,
        status: QueueStatus.WAITING,
      },
      order: { priority_rank: 'DESC', queue_sequence: 'ASC' },
      take: 5,
    });

    // 3. Lấy lastEventId mới nhất của phòng này để Display đối chiếu chống trôi sự kiện
    const latestEvent = await this.dataSource
      .createQueryBuilder(QueueEvent, 'qe')
      .innerJoin(Queue, 'q', 'q.id = qe.queue_id')
      .where('q.room_id = :roomId AND q.queue_date = :today', { roomId, today })
      .orderBy('qe.id', 'DESC')
      .getOne();

    // Không trả về họ tên, SĐT, ngày sinh, địa chỉ
    const responseData = {
      room: {
        id: room.id,
        roomCode: room.room_code,
        roomName: room.room_name,
        status: room.status,
      },
      calling: callingQueues.map((q) => ({
        queueNumber: q.queue_number,
        status: q.status,
        calledAt: q.called_at,
      })),
      next: nextQueues.map((q) => ({
        queueNumber: q.queue_number,
        priority: q.priority,
      })),
      lastEventId: latestEvent ? Number(latestEvent.id) : 0,
    };

    this.displayCache.set(roomId, {
      data: responseData,
      expiresAt: now + 1500, // Cache 1.5 giây
    });

    return responseData;
  }

  private emitRealtime(
    eventId: string,
    eventType: QueueEventType,
    queue: Queue,
  ) {
    this.displayCache.delete(queue.room_id); // Xóa cache cũ ngay khi có thay đổi
    const payload: RealtimeQueuePayload = { eventId, eventType, queue };
    this.eventEmitter.emit('queue.state.changed', payload);
  }
}