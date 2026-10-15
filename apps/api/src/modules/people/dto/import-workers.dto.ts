import { IsString, MaxLength, MinLength } from 'class-validator';

export class ImportWorkersDto {
  /** Raw CSV file contents (parsed server-side). */
  @IsString()
  @MinLength(1)
  @MaxLength(2_000_000)
  csv!: string;
}
