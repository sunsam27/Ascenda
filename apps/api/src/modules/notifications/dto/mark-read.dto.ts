import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';

/** Mark a specific set of notifications read (omit `ids` for all). */
export class MarkNotificationsReadDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  ids?: string[];
}
