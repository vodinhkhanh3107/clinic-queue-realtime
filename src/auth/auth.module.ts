import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../database/entities/users.entity.js';
import { Role } from '../database/entities/roles.entity.js';
import { AuditLog } from '../database/entities/audit-logs.entity.js';
import { AuthService } from './auth.service.js';
import { JwtStrategy } from './dto/strategies/jwt.strategy.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';
import { AuthController } from './auth.controller.js';
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role, AuditLog]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, PermissionsGuard],
  exports: [AuthService, JwtModule, PermissionsGuard],
})
export class AuthModule {}