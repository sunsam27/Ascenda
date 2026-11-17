import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
export class FeatureFlagsDto {
  @IsBoolean() people!: boolean;
  @IsBoolean() timeLeave!: boolean;
  @IsBoolean() documents!: boolean;
  @IsBoolean() payroll!: boolean;
  @IsBoolean() payments!: boolean;
  @IsBoolean() analytics!: boolean;
}
export class PlanAccessDto {
  @IsDefined() @ValidateNested() @Type(()=>FeatureFlagsDto) enabledFeatures!: FeatureFlagsDto;
  @IsInt() @Min(0) @Max(365) trialDays!: number;
  @IsDefined() @ValidateNested() @Type(()=>FeatureFlagsDto) trialFeatures!: FeatureFlagsDto;
  @IsInt() @Min(1) @Max(365) defaultDemoDays!: number;
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}
export class OrganisationAccessDto {
  @IsIn(['suspend','activate','extend','demo','revoke-demo','resume']) action!: 'suspend'|'activate'|'extend'|'demo'|'revoke-demo'|'resume';
  @IsOptional() @IsInt() @Min(1) @Max(3650) days?: number;
  @IsOptional() @ValidateNested() @Type(()=>FeatureFlagsDto) features?: FeatureFlagsDto;
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}
export class OrganisationQuery {
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(1000000) page=1;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100) pageSize=25;
  @IsOptional() @IsString() @MaxLength(100) search='';
}
