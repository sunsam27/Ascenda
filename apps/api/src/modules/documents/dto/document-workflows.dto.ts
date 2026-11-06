import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { WorkerCategory } from '@ascenda/types';

/** Omitted filters mean all active members; supplied filters are combined. */
export class DocumentAudienceDto {
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsEnum(WorkerCategory) category?: WorkerCategory;
}

export class PublishAnnouncementDto extends DocumentAudienceDto {
  @IsString() @Length(1, 160) title!: string;
  @IsString() @Length(1, 5000) body!: string;
}

export class UpdateDocumentDto {
  @IsOptional() @IsString() @Length(1, 200) name?: string;
  @IsOptional() @IsDateString() expiresAt?: string | null;
}
