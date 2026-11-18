import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ALLOW_MUST_CHANGE_PWD_KEY, IS_PUBLIC_KEY } from '../decorators/auth.decorator.js';


@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const canActivate = (await super.canActivate(context)) as boolean;
    if (!canActivate) {
      return false;
    }

    const allowMustChange = this.reflector.getAllAndOverride<boolean>(
      ALLOW_MUST_CHANGE_PWD_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (user?.must_change_password && !allowMustChange) {
      throw new UnauthorizedException({
        code: 'MUST_CHANGE_PASSWORD',
        message: 'Bạn bắt buộc phải đổi mật khẩu tạm trước khi sử dụng hệ thống.',
      });
    }

    return true;
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      if (info?.name === 'TokenExpiredError') {
        throw new UnauthorizedException({
          code: 'TOKEN_EXPIRED',
          message: 'Phiên đăng nhập đã hết hạn.',
        });
      }
      throw (
        err ||
        new UnauthorizedException({
          code: 'UNAUTHORIZED',
          message: 'Chưa đăng nhập hoặc token không hợp lệ.',
        })
      );
    }
    return user;
  }
}