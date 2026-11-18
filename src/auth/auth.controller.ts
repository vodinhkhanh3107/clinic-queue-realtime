import { Body, Controller, Get, Ip, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AllowMustChangePassword, CurrentUser, Public } from '../common/decorators/auth.decorator.js';
import { AuthService } from './auth.service.js';
import { ChangePasswordDto, LoginDto, RefreshTokenDto } from './dto/auth.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // Tối đa 10 lần gọi login / phút / IP
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.authService.login(dto, ip);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @AllowMustChangePassword()
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  logout(@CurrentUser('id') userId: number) {
    return this.authService.logout(userId);
  }

  @AllowMustChangePassword()
  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  changePassword(
    @CurrentUser('id') userId: number,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(userId, dto);
  }

  @AllowMustChangePassword()
  @Get('me')
  getMe(@CurrentUser('id') userId: number) {
    return this.authService.getMe(userId);
  }
}