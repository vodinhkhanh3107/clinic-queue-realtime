import 'reflect-metadata';

import 'dotenv/config';
import { DataSource, In, IsNull } from 'typeorm';
import * as bcrypt from 'bcrypt';

import { Permission } from './entities/permissions.entity.js';
import { Role } from './entities/roles.entity.js';
import { Room } from './entities/rooms.entity.js';
import { User } from './entities/users.entity.js';
import { Receptionist } from './entities/receptionists.entity.js';
import { Doctor } from './entities/doctors.entity.js';
import { DoctorRoomAssignment } from './entities/doctor-room-assignments.entity.js';
import { RoomStatus, UserStatus } from '../common/const/constant.js';
import { ALL_ENTITIES } from './entities/index.js';



const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'clinic_queue',
  entities: ALL_ENTITIES,
  synchronize: false,
});

async function runSeed() {
  await AppDataSource.initialize();
  console.log('⏳ Đang nạp dữ liệu mẫu bằng TypeORM...');

  await AppDataSource.transaction(async (manager) => {
    const permRepo = manager.getRepository(Permission);
    const roleRepo = manager.getRepository(Role);
    const roomRepo = manager.getRepository(Room);
    const userRepo = manager.getRepository(User);
    const recRepo = manager.getRepository(Receptionist);
    const docRepo = manager.getRepository(Doctor);
    const assignRepo = manager.getRepository(DoctorRoomAssignment);

    // 1. Upsert Permissions
    const permissionCodes = [
      'queue.take.self', 'queue.take.onbehalf', 'queue.cancel.self', 'queue.cancel',
      'queue.read.self', 'queue.read.room', 'queue.read.all',
      'queue.call', 'queue.recall', 'queue.start', 'queue.complete', 'queue.skip',
      'queue.priority.update', 'patient.read.self', 'patient.create', 'patient.read',
      'patient.update', 'patient.list', 'account.create', 'account.reset_password',
      'ticket.print', 'room.manage', 'assignment.manage', 'staff.manage',
    ];
    await permRepo.upsert(
      permissionCodes.map((code) => ({ code, description: `Quyền ${code}` })),
      ['code'],
    );
    const allPerms = await permRepo.find();

    // 2. Lưu Roles kèm quan hệ ManyToMany Permissions
    const roleDefinitions: Record<string, { desc: string; perms: string[] }> = {
      PATIENT: {
        desc: 'Bệnh nhân',
        perms: ['queue.take.self', 'queue.cancel.self', 'queue.read.self', 'patient.read.self'],
      },
      DOCTOR: {
        desc: 'Bác sĩ',
        perms: ['queue.read.room', 'queue.call', 'queue.recall', 'queue.start', 'queue.complete', 'queue.skip', 'queue.priority.update'],
      },
      RECEPTIONIST: {
        desc: 'Lễ tân',
        perms: [
          'queue.take.onbehalf', 'queue.cancel', 'queue.read.room', 'queue.read.all',
          'queue.priority.update', 'patient.create', 'patient.read', 'patient.update',
          'patient.list', 'account.create', 'account.reset_password', 'ticket.print',
        ],
      },
      ADMIN: {
        desc: 'Quản trị viên',
        perms: [
          'queue.cancel', 'queue.read.room', 'queue.read.all', 'patient.create',
          'patient.read', 'patient.update', 'patient.list', 'account.create',
          'account.reset_password', 'ticket.print', 'room.manage', 'assignment.manage', 'staff.manage',
        ],
      },
    };

    const savedRoles: Record<string, Role> = {};
    for (const [name, data] of Object.entries(roleDefinitions)) {
      let role = await roleRepo.findOne({ where: { name } });
      if (!role) role = roleRepo.create({ name });
      role.description = data.desc;
      role.permissions = allPerms.filter((p) => data.perms.includes(p.code));
      savedRoles[name] = await roleRepo.save(role);
    }

    // 3. Upsert Phòng khám
    await roomRepo.upsert(
      [
        {
          room_code: 'R_NOI_01',
          room_name: 'Phòng Nội Tổng Quát 1',
          queue_prefix: 'A',
          status: RoomStatus.ACTIVE,
          open_time: '07:00:00',
          close_time: '22:00:00',
          max_daily_tickets: 200,
          call_timeout_minutes: 5,
        },
        {
          room_code: 'R_NHI_01',
          room_name: 'Phòng Khám Nhi 1',
          queue_prefix: 'B',
          status: RoomStatus.ACTIVE,
          open_time: '07:00:00',
          close_time: '22:00:00',
          max_daily_tickets: 200,
          call_timeout_minutes: 5,
        },
      ],
      ['room_code'],
    );
    const roomNoi1 = await roomRepo.findOneByOrFail({ room_code: 'R_NOI_01' });

    // 4. Tạo Users + Nhân sự mẫu (Mật khẩu: Clinic@12345)
    const password_hash = await bcrypt.hash('Clinic@12345', 12);

    // Lễ tân
    await userRepo.upsert(
      { phone: '+84900000002', password_hash, role_id: savedRoles.RECEPTIONIST.id, status: UserStatus.ACTIVE },
      ['phone'],
    );
    const recUser = await userRepo.findOneByOrFail({ phone: '+84900000002' });
    await recRepo.upsert(
      { user_id: recUser.id, employee_code: 'REC001', full_name: 'Lễ tân Nguyễn Thị Lan', department: 'Quầy Tiếp Đón' },
      ['employee_code'],
    );

    // 2 Bác sĩ
    const doctorSeeds = [
      { phone: '+84900000003', code: 'DOC001', name: 'BS. Trần Văn Minh' },
      { phone: '+84900000004', code: 'DOC002', name: 'BS. Lê Hoàng Nam' },
    ];

    for (const d of doctorSeeds) {
      await userRepo.upsert(
        { phone: d.phone, password_hash, role_id: savedRoles.DOCTOR.id, status: UserStatus.ACTIVE },
        ['phone'],
      );
      const docUser = await userRepo.findOneByOrFail({ phone: d.phone });
      await docRepo.upsert(
        { user_id: docUser.id, doctor_code: d.code, full_name: d.name, specialization: 'Nội Tổng Quát' },
        ['doctor_code'],
      );
      const doctor = await docRepo.findOneByOrFail({ doctor_code: d.code });

      // Phân công vào phòng R_NOI_01 nếu chưa có assignment đang mở
      const existingAssign = await assignRepo.findOne({
        where: { doctor_id: doctor.id, room_id: roomNoi1.id, unassigned_at: IsNull() },
      });
      if (!existingAssign) {
        await assignRepo.save({ doctor_id: doctor.id, room_id: roomNoi1.id });
      }
    }
  });

  console.log('✅ Seed dữ liệu bằng TypeORM thành công!');
  await AppDataSource.destroy();
}

runSeed().catch((err) => {
  console.error('❌ Lỗi khi chạy seed:', err);
  process.exit(1);
});