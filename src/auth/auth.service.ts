import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { User } from '../database/entities/users.entity.js';
import { AuditLog } from '../database/entities/audit-logs.entity.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';
import { ChangePasswordDto, LoginDto, RefreshTokenDto } from './dto/auth.dto.js';
import { normalizePhoneE164 } from '../common/utils/phone.util.js';
import { AuditAction, UserStatus } from '../common/const/constant.js';
import { JwtPayload } from './dto/strategies/jwt.strategy.js';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(AuditLog)
    private auditRepo: Repository<AuditLog>,
    private jwtService: JwtService,
    private config: ConfigService,
    private permGuard: PermissionsGuard,
  ) {}

  async login(dto: LoginDto, ip?: string) {
    const normalizedPhone = normalizePhoneE164(dto.phone);

    // Lấy cả password_hash vì trong Entity đang đặt select: false
    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.password_hash')
      .leftJoinAndSelect('user.role', 'role')
      .where('user.phone = :phone', { phone: normalizedPhone })
      .getOne();

    // Thông báo lỗi chung để không lộ số điện thoại nào đã đăng ký (mục 4.2)
    const invalidCredsError = new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: 'Sai số điện thoại hoặc mật khẩu',
    });

    if (!user) {
      throw invalidCredsError;
    }

    // 1. Kiểm tra trạng thái LOCKED / INACTIVE
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException({
        code: 'ACCOUNT_LOCKED',
        message: 'Tài khoản đã bị khóa hoặc ngừng hoạt động. Vui lòng liên hệ quầy lễ tân.',
      });
    }

    // 2. Kiểm tra khóa tạm 15 phút (locked_until)
    const now = new Date();
    if (user.locked_until && user.locked_until > now) {
      const waitMinutes = Math.ceil((user.locked_until.getTime() - now.getTime()) / 60000);
      throw new ForbiddenException({
        code: 'ACCOUNT_LOCKED',
        message: `Tài khoản đang bị tạm khóa. Vui lòng thử lại sau ${waitMinutes} phút.`,
      });
    }

    // 3. Kiểm tra mật khẩu tạm đã hết hạn 48h chưa (mục 4.1)
    if (
      user.must_change_password &&
      user.temp_password_expires_at &&
      user.temp_password_expires_at < now
    ) {
      throw new UnauthorizedException({
        code: 'TEMP_PASSWORD_EXPIRED',
        message: 'Mật khẩu tạm đã hết hạn (48 giờ). Vui lòng liên hệ lễ tân để cấp lại.',
      });
    }

    // 4. Đối chiếu mật khẩu
    const isMatch = await bcrypt.compare(dto.password, user.password_hash);
    if (!isMatch) {
      const newFailCount = user.failed_login_count + 1;
      const updateData: Partial<User> = { failed_login_count: newFailCount };

      // Sai 5 lần liên tiếp: khóa tạm 15 phút; sai đến 15 lần: chuyển sang LOCKED
      if (newFailCount >= 15) {
        updateData.status = UserStatus.LOCKED;
        await this.auditRepo.save({
          actor_user_id: user.id,
          action: AuditAction.ACCOUNT_LOCKED,
          target_type: 'USER',
          target_id: user.id,
          metadata: { reason: 'EXCEEDED_MAX_FAILED_LOGINS', failCount: newFailCount },
          ip: ip || null,
        });
      } else if (newFailCount % 5 === 0) {
        updateData.locked_until = new Date(now.getTime() + 15 * 60 * 1000);
      }

      await this.userRepo.update(user.id, updateData);
      throw invalidCredsError;
    }

    // 5. Đăng nhập thành công: Reset bộ đếm lỗi, cập nhật last_login_at
    await this.userRepo.update(user.id, {
      failed_login_count: 0,
      locked_until: null,
      last_login_at: now,
    });

    const tokens = await this.generateTokens(user);
    const permissions = Array.from(
      await this.permGuard.getPermissionsForRole(user.role_id),
    );

    return {
      ...tokens,
      user: {
        id: user.id,
        phone: user.phone,
        role: user.role.name,
        mustChangePassword: user.must_change_password,
        permissions,
      },
    };
  }

  async refresh(dto: RefreshTokenDto) {
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(
        dto.refreshToken,
        {
          secret: this.config.get<string>('JWT_REFRESH_SECRET', 'refresh_secret'),
        },
      );

      const user = await this.userRepo.findOne({
        where: { id: payload.sub },
        relations: {
            'role': true,
        },
      });

      if (
        !user ||
        user.status !== UserStatus.ACTIVE ||
        user.token_version !== payload.tokenVersion
      ) {
        throw new UnauthorizedException({
          code: 'TOKEN_EXPIRED',
          message: 'Refresh token không hợp lệ hoặc đã bị thu hồi.',
        });
      }

      return this.generateTokens(user);
    } catch {
      throw new UnauthorizedException({
        code: 'TOKEN_EXPIRED',
        message: 'Refresh token không hợp lệ hoặc đã hết hạn.',
      });
    }
  }

  async logout(userId: number) {
    // Tăng token_version để vô hiệu hóa toàn bộ Access & Refresh token cũ
    await this.userRepo.increment({ id: userId }, 'token_version', 1);
    return { message: 'Đăng xuất thành công.' };
  }

  async changePassword(userId: number, dto: ChangePasswordDto) {
    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.password_hash')
      .leftJoinAndSelect('user.role', 'role')
      .where('user.id = :id', { id: userId })
      .getOne();

    if (!user) {
      throw new UnauthorizedException();
    }

    const isMatch = await bcrypt.compare(dto.currentPassword, user.password_hash);
    if (!isMatch) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Mật khẩu hiện tại không chính xác.',
      });
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Mật khẩu mới phải khác mật khẩu hiện tại.',
      });
    }

    const newHash = await bcrypt.hash(dto.newPassword, 12);
    const nextTokenVersion = user.token_version + 1;

    // Cập nhật mật khẩu, tắt must_change_password, xóa hạn mật khẩu tạm và tăng token_version
    await this.userRepo.update(user.id, {
      password_hash: newHash,
      must_change_password: false,
      temp_password_expires_at: null,
      token_version: nextTokenVersion,
    });

    user.token_version = nextTokenVersion;
    user.must_change_password = false;

    const tokens = await this.generateTokens(user);
    return {
      message: 'Đổi mật khẩu thành công.',
      ...tokens,
    };
  }

  async getMe(userId: number) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: {
        'role': true,
      },
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    const permissions = Array.from(
      await this.permGuard.getPermissionsForRole(user.role_id),
    );

    return {
      id: user.id,
      phone: user.phone,
      role: user.role.name,
      status: user.status,
      mustChangePassword: user.must_change_password,
      permissions,
    };
  }

  private async generateTokens(user: User) {
    const payload: JwtPayload = {
      sub: user.id,
      roleId: user.role_id,
      roleName: user.role.name,
      tokenVersion: user.token_version,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET', 'secret'),
        expiresIn: '15m', // Sống 15 phút theo mục 4.3
      }),
      this.jwtService.signAsync(payload, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET', 'refresh_secret'),
        expiresIn: '7d', // Sống 7 ngày theo mục 4.3
      }),
    ]);

    return { accessToken, refreshToken };
  }
}