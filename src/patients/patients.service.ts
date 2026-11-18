import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, Like, Repository } from 'typeorm';
import { Patient } from '../database/entities/patients.entity.js';
import { User } from '../database/entities/users.entity.js';
import { Role } from '../database/entities/roles.entity.js';
import { Queue } from '../database/entities/queues.entity.js';
import { CreatePatientDto, UpdatePatientDto } from './dto/patient.dto.js';
import { normalizePhoneE164 } from '../common/utils/phone.util.js';
import { AuditAction, UserStatus } from '../common/const/constant.js';
import { AuditLog } from '../database/entities/audit-logs.entity.js';
import { generateTempPassword } from '../common/utils/clinic.util.js';

@Injectable()
export class PatientsService {
  constructor(
    @InjectRepository(Patient)
    private patientRepo: Repository<Patient>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(Role)
    private roleRepo: Repository<Role>,
    @InjectRepository(Queue)
    private queueRepo: Repository<Queue>,
    private dataSource: DataSource,
  ) {}

  // Bệnh nhân xem hồ sơ của chính mình (mục 9.2)
  async getMyProfile(userId: number) {
    const patient = await this.patientRepo.findOne({
      where: { user_id: userId },
    });
    if (!patient) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy hồ sơ bệnh nhân.',
      });
    }
    return patient;
  }

  // Bệnh nhân xem danh sách queue của chính mình
  async getMyQueues(userId: number) {
    const patient = await this.getMyProfile(userId);
    return this.queueRepo.find({
      where: { patient_id: patient.id },
      relations: {
        'room': true,
        'doctor': true
      },
      order: { created_at: 'DESC' },
      take: 20,
    });
  }

  // Lễ tân tạo hồ sơ bệnh nhân (không tạo tài khoản, cảnh báo trùng)
  async createPatient(dto: CreatePatientDto, creatorUserId: number) {
    const normalizedPhone = dto.phone ? normalizePhoneE164(dto.phone) : null;

    if (!dto.confirmDuplicate) {
      const qb = this.patientRepo.createQueryBuilder('p');
      if (dto.dateOfBirth) {
        qb.where('(p.full_name = :name AND p.date_of_birth = :dob)', {
          name: dto.fullName.trim(),
          dob: dto.dateOfBirth,
        });
      } else {
        qb.where('p.full_name = :name', { name: dto.fullName.trim() });
      }
      if (normalizedPhone) {
        qb.orWhere('p.phone = :phone', { phone: normalizedPhone });
      }

      const duplicates = await qb.getMany();
      if (duplicates.length > 0) {
        return {
          warning: true,
          code: 'DUPLICATE_PATIENT_WARNING',
          message:
            'Phát hiện hồ sơ có khả năng trùng lặp. Gửi lại kèm confirmDuplicate = true để xác nhận tạo mới.',
          duplicates,
        };
      }
    }

    const patientCode = `BN${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 90 + 10)}`;

    const patient = this.patientRepo.create({
      patient_code: patientCode,
      full_name: dto.fullName.trim(),
      date_of_birth: dto.dateOfBirth || null,
      gender: dto.gender || null,
      address: dto.address || null,
      phone: normalizedPhone,
      created_by_user_id: creatorUserId,
    });

    return this.patientRepo.save(patient);
  }

  // Lễ tân tìm kiếm hồ sơ theo tên, SĐT, mã hồ sơ
  async searchPatients(q?: string) {
    if (!q || !q.trim()) {
      return this.patientRepo.find({
        order: { created_at: 'DESC' },
        take: 30,
      });
    }
    const keyword = q.trim();
    const phoneQuery = keyword.startsWith('0')
      ? normalizePhoneE164(keyword)
      : keyword;

    return this.patientRepo.find({
      where: [
        { full_name: Like(`%${keyword}%`) },
        { patient_code: Like(`%${keyword}%`) },
        { phone: Like(`%${keyword}%`) },
        { phone: Like(`%${phoneQuery}%`) },
      ],
      order: { created_at: 'DESC' },
      take: 30,
    });
  }

  async getPatientById(id: number) {
    const patient = await this.patientRepo.findOne({ where: { id } });
    if (!patient) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy hồ sơ bệnh nhân.',
      });
    }
    return patient;
  }

  async updatePatient(id: number, dto: UpdatePatientDto) {
    const patient = await this.getPatientById(id);
    if (dto.fullName !== undefined) patient.full_name = dto.fullName.trim();
    if (dto.dateOfBirth !== undefined) patient.date_of_birth = dto.dateOfBirth;
    if (dto.gender !== undefined) patient.gender = dto.gender;
    if (dto.address !== undefined) patient.address = dto.address;
    if (dto.phone !== undefined) {
      patient.phone = dto.phone ? normalizePhoneE164(dto.phone) : null;
    }
    return this.patientRepo.save(patient);
  }

  // Lễ tân kích hoạt tài khoản cho hồ sơ đã có 
  async activateAccount(patientId: number, actorUserId: number, ip?: string) {
    return this.dataSource.transaction(async (manager) => {
      const patient = await manager.findOne(Patient, {
        where: { id: patientId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!patient) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Không tìm thấy hồ sơ bệnh nhân.',
        });
      }

      if (patient.user_id) {
        throw new ConflictException({
          code: 'ACCOUNT_ALREADY_EXISTS',
          message: 'Hồ sơ này đã được kích hoạt tài khoản trước đó.',
        });
      }

      if (!patient.phone) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Hồ sơ bệnh nhân phải có số điện thoại hợp lệ để kích hoạt tài khoản.',
        });
      }

      const normalizedPhone = normalizePhoneE164(patient.phone);
      const existingUser = await manager.findOne(User, {
        where: { phone: normalizedPhone },
      });

      if (existingUser) {
        throw new ConflictException({
          code: 'PHONE_ALREADY_USED',
          message: 'Số điện thoại này đã được dùng cho một tài khoản đăng nhập khác.',
        });
      }

      const patientRole = await manager.findOneByOrFail(Role, {
        name: 'PATIENT',
      });

      const tempPassword = generateTempPassword(10);
      const passwordHash = await bcrypt.hash(tempPassword, 12);
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // Hạn 48 giờ (mục 4.1)

      const newUser = manager.create(User, {
        phone: normalizedPhone,
        password_hash: passwordHash,
        role_id: patientRole.id,
        status: UserStatus.ACTIVE,
        must_change_password: true,
        temp_password_expires_at: expiresAt,
        token_version: 1,
      });

      const savedUser = await manager.save(User, newUser);
      patient.user_id = savedUser.id;
      patient.phone = normalizedPhone;
      await manager.save(Patient, patient);

      await manager.save(AuditLog, {
        actor_user_id: actorUserId,
        action: AuditAction.ACCOUNT_CREATED,
        target_type: 'PATIENT',
        target_id: patient.id,
        metadata: { userId: savedUser.id, phone: normalizedPhone },
        ip: ip || null,
      });

      // Chỉ trả mật khẩu tạm duy nhất 1 lần trong response để in phiếu cấp tài khoản
      return {
        patientId: patient.id,
        patientCode: patient.patient_code,
        fullName: patient.full_name,
        loginPhone: normalizedPhone,
        temporaryPassword: tempPassword,
        expiresAt,
        mustChangePassword: true,
      };
    });
  }

  // Lễ tân reset mật khẩu cho bệnh nhân quên mật khẩu
  async resetPatientPassword(patientId: number, actorUserId: number, ip?: string) {
    return this.dataSource.transaction(async (manager) => {
      const patient = await manager.findOne(Patient, {
        where: { id: patientId },
      });

      if (!patient || !patient.user_id) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Bệnh nhân chưa có tài khoản đăng nhập để đặt lại mật khẩu.',
        });
      }

      const user = await manager.findOneByOrFail(User, { id: patient.user_id });

      const tempPassword = generateTempPassword(10);
      const passwordHash = await bcrypt.hash(tempPassword, 12);
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

      user.password_hash = passwordHash;
      user.must_change_password = true;
      user.temp_password_expires_at = expiresAt;
      user.failed_login_count = 0;
      user.locked_until = null;
      user.status = UserStatus.ACTIVE;
      user.token_version += 1; // Vô hiệu hóa toàn bộ token cũ

      await manager.save(User, user);

      await manager.save(AuditLog, {
        actor_user_id: actorUserId,
        action: AuditAction.PASSWORD_RESET,
        target_type: 'USER',
        target_id: user.id,
        metadata: { patientId: patient.id },
        ip: ip || null,
      });

      return {
        patientId: patient.id,
        fullName: patient.full_name,
        loginPhone: user.phone,
        temporaryPassword: tempPassword,
        expiresAt,
        mustChangePassword: true,
      };
    });
  }
}