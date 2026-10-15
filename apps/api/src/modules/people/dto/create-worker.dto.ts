import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  EmploymentType,
  WorkerCategory,
  WorkerStatus,
} from '@ascenda/types';

export class CreateWorkerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  employeeNumber!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  preferredName?: string;

  @IsEmail()
  @MaxLength(160)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsEnum(WorkerCategory)
  category!: WorkerCategory;

  @IsEnum(EmploymentType)
  employmentType!: EmploymentType;

  @IsOptional()
  @IsEnum(WorkerStatus)
  status?: WorkerStatus;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  jobTitle!: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @IsOptional()
  @IsUUID()
  locationId?: string | null;

  @IsOptional()
  @IsUUID()
  managerId?: string | null;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  gender?: string | null;
}
