import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { IsNull, Repository } from 'typeorm';
import { QueueEventType, UserStatus } from '../common/const/constant.js';
import { User } from '../database/entities/users.entity.js';
import { Patient } from '../database/entities/patients.entity.js';
import { Doctor } from '../database/entities/doctors.entity.js';
import { DoctorRoomAssignment } from '../database/entities/doctor-room-assignments.entity.js';
import { JwtPayload } from '../auth/dto/strategies/jwt.strategy.js';
import { Queue } from '../database/entities/queues.entity.js';

export interface RealtimeQueuePayload {
  eventId: string;
  eventType: QueueEventType;
  queue: Queue;
}

// Ánh xạ QueueEventType sang tên sự kiện Socket.IO chuẩn mục 10.2
const SOCKET_EVENT_NAME_MAP: Record<QueueEventType, string> = {
  [QueueEventType.TAKEN]: 'queue:taken',
  [QueueEventType.CALLED]: 'queue:called',
  [QueueEventType.RECALLED]: 'queue:recalled',
  [QueueEventType.STARTED]: 'queue:started',
  [QueueEventType.COMPLETED]: 'queue:completed',
  [QueueEventType.SKIPPED]: 'queue:skipped',
  [QueueEventType.CANCELLED]: 'queue:cancelled',
};

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
@Injectable()
export class QueuesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(QueuesGateway.name);

  constructor(
    private jwtService: JwtService,
    private config: ConfigService,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Patient) private patientRepo: Repository<Patient>,
    @InjectRepository(Doctor) private doctorRepo: Repository<Doctor>,
    @InjectRepository(DoctorRoomAssignment)
    private assignRepo: Repository<DoctorRoomAssignment>,
  ) {}

  // 1. Xác thực ngay tại Handshake
  async handleConnection(client: Socket) {
    try {
      const displayToken =
        client.handshake.auth?.displayToken ||
        client.handshake.headers['x-display-token'];

      const validDisplayToken = this.config.get<string>(
        'DISPLAY_DEVICE_TOKEN',
        'display_secret_token_room_tv_2026',
      );

      // Trường hợp 1: Màn hình Display kết nối bằng Device Token
      if (displayToken && displayToken === validDisplayToken) {
        client.data.clientType = 'DISPLAY';
        this.logger.log(`📺 Display connected: ${client.id}`);
        return;
      }

      // Trường hợp 2: Nhân viên y tế hoặc Bệnh nhân kết nối bằng JWT
      const rawToken =
        client.handshake.auth?.token ||
        client.handshake.headers.authorization?.replace('Bearer ', '');

      if (!rawToken) {
        this.logger.warn(`❌ Từ chối kết nối thiếu token: ${client.id}`);
        client.disconnect(true);
        return;
      }

      const payload = await this.jwtService.verifyAsync<JwtPayload>(rawToken, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET', 'secret'),
      });

      const user = await this.userRepo.findOne({
        where: { id: payload.sub },
        relations: {
            'role': true
        },
      });

      if (
        !user ||
        user.status !== UserStatus.ACTIVE ||
        user.token_version !== payload.tokenVersion ||
        user.must_change_password
      ) {
        this.logger.warn(`❌ Token không hợp lệ hoặc cần đổi mật khẩu: ${client.id}`);
        client.disconnect(true);
        return;
      }

      client.data.clientType = 'USER';
      client.data.user = {
        id: user.id,
        roleName: user.role.name,
      };

      // Nếu là PATIENT, tự động tìm hồ sơ và đưa thẳng vào kênh riêng patient:{patientId}
      if (user.role.name === 'PATIENT') {
        const patient = await this.patientRepo.findOne({
          where: { user_id: user.id },
        });
        if (patient) {
          client.data.patientId = patient.id;
          const patientRoom = `patient:${patient.id}`;
          await client.join(patientRoom);
          this.logger.log(
            `👤 Bệnh nhân #${patient.id} đã vào kênh ${patientRoom}`,
          );
        }
      }
    } catch {
      this.logger.warn(`❌ Xác thực Socket thất bại: ${client.id}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`🔌 Client disconnected: ${client.id}`);
  }

  // 2. Display đăng ký nhận tin từ kênh display:room:{id}
  @SubscribeMessage('join:display:room')
  async handleJoinDisplayRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: number },
  ) {
    if (client.data.clientType !== 'DISPLAY') {
      throw new WsException('Chỉ thiết bị Display mới được tham gia kênh này.');
    }
    const channel = `display:room:${Number(data.roomId)}`;
    await client.join(channel);
    return { status: 'joined', channel };
  }

  // 3. Bác sĩ / Lễ tân đăng ký nhận tin từ kênh staff:room:{id}
  @SubscribeMessage('join:staff:room')
  async handleJoinStaffRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: number },
  ) {
    if (client.data.clientType !== 'USER' || !client.data.user) {
      throw new WsException('Chưa xác thực người dùng.');
    }

    const { id: userId, roleName } = client.data.user;
    const roomId = Number(data.roomId);

    // Bệnh nhân tuyệt đối không được vào kênh của staff
    if (roleName === 'PATIENT') {
      throw new WsException('Bệnh nhân không có quyền tham gia kênh nhân viên.');
    }

    // Nếu là DOCTOR, kiểm tra phải được phân công vào phòng đó
    if (roleName === 'DOCTOR') {
      const doctor = await this.doctorRepo.findOne({
        where: { user_id: userId },
      });
      if (!doctor) {
        throw new WsException('Không tìm thấy hồ sơ bác sĩ.');
      }
      const assigned = await this.assignRepo.findOne({
        where: {
          doctor_id: doctor.id,
          room_id: roomId,
          unassigned_at: IsNull(),
        },
      });
      if (!assigned) {
        throw new WsException('Bạn không được phân công vào phòng khám này.');
      }
    }

    const channel = `staff:room:${roomId}`;
    await client.join(channel);
    return { status: 'joined', channel };
  }

  // 4. Lắng nghe sự kiện sau khi DB transaction COMMIT và phát xuống 3 kênh tách biệt
  @OnEvent('queue.state.changed')
  handleQueueStateChanged(payload: RealtimeQueuePayload) {
    const { eventId, eventType, queue } = payload;
    const socketEvent = SOCKET_EVENT_NAME_MAP[eventType];
    const numericEventId = Number(eventId);

    // 4.1. Phát tới kênh Display: KHÔNG chứa thông tin cá nhân
    this.server.to(`display:room:${queue.room_id}`).emit(socketEvent, {
      eventId: numericEventId,
      eventType,
      roomId: queue.room_id,
      queueNumber: queue.queue_number,
      status: queue.status,
      priority: queue.priority,
      calledAt: queue.called_at,
    });

    // 4.2. Phát tới kênh Staff (Bác sĩ & Lễ tân): Có đầy đủ thông tin nghiệp vụ
    this.server.to(`staff:room:${queue.room_id}`).emit(socketEvent, {
      eventId: numericEventId,
      eventType,
      queueId: queue.id,
      roomId: queue.room_id,
      patientId: queue.patient_id,
      patientName: queue.patient?.full_name,
      patientCode: queue.patient?.patient_code,
      doctorId: queue.doctor_id,
      queueNumber: queue.queue_number,
      queueSequence: queue.queue_sequence,
      priority: queue.priority,
      status: queue.status,
      skipCount: queue.skip_count,
      calledAt: queue.called_at,
      startedAt: queue.started_at,
      completedAt: queue.completed_at,
    });

    // 4.3. Phát tới kênh riêng của Bệnh nhân sở hữu lượt khám đó
    this.server.to(`patient:${queue.patient_id}`).emit(socketEvent, {
      eventId: numericEventId,
      eventType,
      queueId: queue.id,
      roomId: queue.room_id,
      roomName: queue.room?.room_name,
      queueNumber: queue.queue_number,
      status: queue.status,
      priority: queue.priority,
      calledAt: queue.called_at,
    });
  }
}