import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/auth/public.decorator';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';
import { IdentityAccessService } from './identity-access.service';
import { LoginDto } from './dto/login.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  SESSION_COOKIE,
  REFRESH_PATH,
  readCookie,
  writeAuthCookies,
} from './auth-cookies';

@ApiTags('auth')
@Controller('auth')
export class IdentityAccessController {
  constructor(private readonly authService: IdentityAccessService) {}

  /** PRD: AUTH-01 — Login with email and password */
  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60000 } }) // 5 attempts per minute per IP
  @ApiOperation({ summary: 'Login with email and password' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto);
    writeAuthCookies(res, result);
    // Tokens are deliberately omitted from the body — they live in cookies.
    return {
      user: result.user,
      redirectTo: result.redirectTo,
      expiresIn: result.expiresIn,
    };
  }

  /** Verify an invitation token and return safe context for the UI. */
  @Get('invitation')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Validate an invitation token' })
  invitation(@Query('token') token?: string) {
    if (!token) {
      throw new BadRequestException('Missing invitation token');
    }
    return this.authService.getInvitation(token);
  }

  /** Accept an invitation by setting a password (auto-signs the user in). */
  @Post('set-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Accept an invitation and set a password' })
  async setPassword(
    @Body() dto: SetPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.setPassword(dto.token, dto.password);
    writeAuthCookies(res, result);
    return {
      user: result.user,
      redirectTo: result.redirectTo,
      expiresIn: result.expiresIn,
    };
  }

  /** PRD: AUTH-03 — Rotate refresh token and issue a new access token */
  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token and issue a new access token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readCookie(req, REFRESH_COOKIE);
    if (!token) {
      throw new UnauthorizedException('No refresh token provided');
    }
    const result = await this.authService.refresh(token);
    writeAuthCookies(res, result);
    return { user: result.user, expiresIn: result.expiresIn };
  }

  /** PRD: AUTH-04 — Clear the session cookies */
  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear the session cookies' })
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  /** PRD: AUTH-05 — Get the current authenticated user */
  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user' })
  me(@Req() req: Request) {
    return { user: req.user };
  }

  @Get('health')
  @Public()
  @HttpCode(HttpStatus.OK)
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
