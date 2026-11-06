import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DocumentType } from '@ascenda/types';

export class CreateDocumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsEnum(DocumentType)
  type!: DocumentType;

  @IsOptional()
  @IsUUID()
  workerId?: string | null;

  @IsString()
  @MaxLength(120)
  mimeType!: string;

  /** Base64-encoded file bytes (no `data:` prefix). ~8 MB max. */
  @IsString()
  @MaxLength(4 * Math.ceil((8 * 1024 * 1024) / 3))
  content!: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
