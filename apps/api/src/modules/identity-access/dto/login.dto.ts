import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

/**
 * Login payload. A concrete class (not an interface) is required so the global
 * ValidationPipe allow-list can validate and retain the fields.
 */
export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  @IsOptional()
  @IsString()
  organisationId?: string;

  @IsOptional()
  @IsString()
  mfaCode?: string;
}
