import { IsString, MaxLength, MinLength } from 'class-validator';

/** Public payload: accept an invitation by choosing a password. */
export class SetPasswordDto {
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  token!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  password!: string;
}
