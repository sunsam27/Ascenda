import { IsOptional, IsString, Length, Matches } from 'class-validator';

/** SECURITY.md §2: re-authenticate before payroll approval or export. */
export class StepUpDto {
  @IsString()
  @Length(1, 200)
  password!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'mfaCode must be a 6-digit code' })
  mfaCode?: string;
}

export interface StepUpResult {
  token: string;
  expiresIn: number;
}
