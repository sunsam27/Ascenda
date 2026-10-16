import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class DecideLeaveRequestDto {
  /** true = approve the current step, false = reject the request. */
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
