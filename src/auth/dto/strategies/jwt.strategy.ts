import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { User } from '../../../database/entities/users.entity.js';
import { UserStatus } from '../../../common/const/constant.js';

export interface JwtPayload {
  sub: number;
  roleId: number;
  roleName: string;
  tokenVersion: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET', 'secret'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.userRepo.findOne({
      where: { id: payload.sub },
      relations: {
        'role': true,
      },
    });

    if (!user) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Tài khoản không tồn tại.',
      });
    }

    if (user.status === UserStatus.LOCKED || user.status === UserStatus.INACTIVE) {
      throw new ForbiddenException({
        code: 'ACCOUNT_LOCKED',
        message: 'Tài khoản đã bị khóa hoặc ngừng hoạt động.',
      });
    }

    if (user.locked_until && user.locked_until > new Date()) {
      throw new ForbiddenException({
        code: 'ACCOUNT_LOCKED',
        message: 'Tài khoản đang bị tạm khóa do nhập sai mật khẩu nhiều lần.',
      });
    }

    // Đối chiếu token_version
    if (user.token_version !== payload.tokenVersion) {
      throw new UnauthorizedException({
        code: 'TOKEN_EXPIRED',
        message: 'Phiên đăng nhập đã hết hiệu lực, vui lòng đăng nhập lại.',
      });
    }

    return {
      id: user.id,
      phone: user.phone,
      role_id: user.role_id,
      role_name: user.role?.name,
      must_change_password: user.must_change_password,
      token_version: user.token_version,
    };
  }
}