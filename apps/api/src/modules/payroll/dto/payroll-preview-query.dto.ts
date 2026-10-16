import { Transform } from 'class-transformer';
import { ArrayNotEmpty, IsDateString, IsUUID } from 'class-validator';

/**
 * Parameters for a read-only payroll preview (PRD LVE-06 / ATT-03). `workerIds`
 * is supplied as a repeated query param or a comma-separated list.
 */
export class PayrollPreviewQueryDto {
  /** ISO date (YYYY-MM-DD) the pay period opens. */
  @IsDateString()
  periodStart!: string;

  /** ISO date (YYYY-MM-DD) the pay period closes (inclusive). */
  @IsDateString()
  periodEnd!: string;

  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : value,
  )
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  workerIds!: string[];
}
