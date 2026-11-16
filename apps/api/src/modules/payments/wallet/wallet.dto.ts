import { Type } from 'class-transformer';
import { Equals, IsEmail, IsInt, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export class EmployerWalletSetupDto {
  @IsString() @Length(2, 160) legalName!: string;
  @IsString() @Length(2, 80) registrationNumber!: string;
  @IsString() @Length(5, 500) companyAddress!: string;
  @IsString() @Length(2, 160) representativeName!: string;
  @IsEmail() @Length(3, 200) representativeEmail!: string;
  @IsString() @Length(7, 30) representativePhone!: string;
  @IsString() @Length(2, 100) representativeRole!: string;
  @Equals(true) authorised!: boolean;
}

export class WalletPageDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}

export class WalletSubmissionDto {
  @IsUUID('4') requestKey!: string;
  /** The server re-quotes and rejects changed costs rather than silently spending more. */
  @IsInt() @Min(1) @Max(2_147_483_647) expectedRequiredMinorUnits!: number;
}
