import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Role, ROLES } from '../storage/models';

export class LoginDto {
  @ApiProperty({ example: 'admin' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ example: 'change-me' })
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ minLength: 6 })
  @IsString()
  @MinLength(6)
  @MaxLength(200)
  newPassword: string;
}

export class CreateUserDto {
  @ApiProperty({ example: 'sara', description: '2-40 chars: letters, digits, dot, dash, underscore' })
  @Matches(/^[a-zA-Z0-9._-]{2,40}$/, { message: 'username must be 2-40 chars of letters, digits, ".", "-" or "_"' })
  username: string;

  @ApiProperty({ minLength: 6, example: 'secret123' })
  @IsString()
  @MinLength(6)
  @MaxLength(200)
  password: string;

  @ApiProperty({ enum: [...ROLES], example: 'frontend' })
  @IsIn([...ROLES])
  role: Role;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ enum: [...ROLES] })
  @IsOptional()
  @IsIn([...ROLES])
  role?: Role;

  @ApiPropertyOptional({ minLength: 6 })
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(200)
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}
