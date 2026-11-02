import { IsEnum } from 'class-validator';
import { ChecklistTaskStatus } from '@ascenda/types';

export class UpdateChecklistTaskDto {
  @IsEnum(ChecklistTaskStatus)
  status!: ChecklistTaskStatus;
}
