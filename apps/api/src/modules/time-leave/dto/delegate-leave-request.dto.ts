import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class DelegateLeaveRequestDto {
  /** User id of the colleague who should decide the active step instead. */
  @IsUUID()
  toUserId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
