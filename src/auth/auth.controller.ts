import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { API_BASE } from '../constants';
import { AuthUser } from '../storage/models';
import { ChangePasswordDto, CreateUserDto, LoginDto, UpdateUserDto } from './auth.dto';
import { AuthService } from './auth.service';
import { CurrentUser, Public, Roles } from './decorators';

@ApiTags('auth')
@ApiBearerAuth()
@Controller(`${API_BASE}/auth`)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in. Paste the returned token into "Authorize" above.' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.username, dto.password);
  }

  @Get('me')
  @ApiOperation({ summary: 'Current user' })
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Post('password')
  @HttpCode(204)
  @ApiOperation({ summary: 'Change your own password' })
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto): Promise<void> {
    await this.auth.changePassword(user, dto.currentPassword, dto.newPassword);
  }
}

@ApiTags('users (admin)')
@ApiBearerAuth()
@Roles('admin')
@Controller(`${API_BASE}/users`)
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  list() {
    return this.auth.listUsers();
  }

  @Post()
  @ApiOperation({ summary: 'Create a team member account' })
  create(@Body() dto: CreateUserDto) {
    return this.auth.createUser(dto.username, dto.password, dto.role);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change role, reset password, or disable a user' })
  update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.auth.updateUser(actor, id, dto);
  }
}
