import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ExitReason } from '@ascenda/types';

export class StartOffboardingDto {
  @IsUUID()
  workerId!: string;

  @IsEnum(ExitReason)
  exitReason!: ExitReason;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reasonDetail?: string;

  @IsDateString()
  lastWorkingDate!: string;

  @IsOptional()
  @IsDateString()
  noticeDate?: string;
}
