import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@nestjs/passport';
import { IdentityAccessService } from './identity-access.service';
import { LoginDto } from '@ascenda/types';

@ApiTags('auth')
@Controller('auth')
export class IdentityAccessController {
  constructor(private readonly authService: IdentityAccessService) {}

  /** PRD: AUTH-01 — Login with email and password */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60000 } }) // 5 attempts per minute per IP
  @ApiOperation({ summary: 'Login with email and password' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /** PRD: AUTH-02 — Register a new user */
  @Post('register')
  @Throttle({ short: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Register a new platform account' })
  register(
    @Body()
    body: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
    },
  ) {
    return this.authService.register(body);
  }

  /** PRD: AUTH-03 — Refresh access token */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  refresh(@Body() body: { refreshToken: string }) {
    return this.authService.refreshToken(body.refreshToken);
  }

  /** PRD: AUTH-04 — Get current user profile */
  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user' })
  me() {
    // TODO: Return user from request context
    return { message: 'Authenticated' };
  }

  /** Health check — unauthenticated */
  @Get('health')
  @HttpCode(HttpStatus.OK)
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
