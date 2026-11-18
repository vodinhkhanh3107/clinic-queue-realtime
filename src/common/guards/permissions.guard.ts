import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../../database/entities/roles.entity.js';
import { PERMISSIONS_KEY } from '../decorators/auth.decorator.js';

interface CachedPermissions {
  permissions: Set<string>;
  expiresAt: number;
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  private rolePermCache = new Map<number, CachedPermissions>();
  private readonly CACHE_TTL_MS = 60 * 1000; // 60 giây

  constructor(
    private reflector: Reflector,
    @InjectRepository(Role)
    private roleRepo: Repository<Role>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.role_id) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Không xác định được quyền truy cập.',
      });
    }

    const userPermissions = await this.getPermissionsForRole(user.role_id);

    // Cho phép nếu user có ít nhất 1 trong các quyền được liệt kê trên endpoint
    const hasPermission = requiredPermissions.some((perm) =>
      userPermissions.has(perm),
    );

    if (!hasPermission) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Bạn không có quyền thực hiện thao tác này.',
      });
    }

    return true;
  }

  public async getPermissionsForRole(roleId: number): Promise<Set<string>> {
    const now = Date.now();
    const cached = this.rolePermCache.get(roleId);

    if (cached && cached.expiresAt > now) {
      return cached.permissions;
    }

    const role = await this.roleRepo.findOne({
      where: { id: roleId },
      relations: {
        'permissions': true
      },
    });

    const permSet = new Set<string>(
      role?.permissions?.map((p) => p.code) || [],
    );

    this.rolePermCache.set(roleId, {
      permissions: permSet,
      expiresAt: now + this.CACHE_TTL_MS,
    });

    return permSet;
  }
}