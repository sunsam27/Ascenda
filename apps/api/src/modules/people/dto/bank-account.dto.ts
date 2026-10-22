import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Create a bank account for a worker. The account number is encrypted at rest;
 * `bankName`/`bankCode` may be supplied directly or left blank so the server
 * auto-detects them from the account number (falling back to the client's
 * explicit values when detection fails).
 */
export class CreateBankAccountDto {
  /** 10-digit NUBAN (Nigeria). Whitespace is tolerated and stripped server-side. */
  @IsString()
  @Matches(/^\s*\d{10}\s*$/, {
    message: 'accountNumber must be a 10-digit account number',
  })
  accountNumber!: string;

  @IsString()
  @Length(2, 120)
  accountName!: string;

  /** Optional: when omitted the server attempts NUBAN prefix detection. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  bankCode?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

/** Update an existing bank account (org correction, or employee edit). */
export class UpdateBankAccountDto {
  @IsOptional()
  @IsString()
  @Matches(/^\s*\d{10}\s*$/, {
    message: 'accountNumber must be a 10-digit account number',
  })
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  accountName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  bankCode?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  /** Org-only: mark the account as verified after manual review. */
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;
}

/** Resolve a bank from an account number before saving (UI helper). */
export class DetectBankDto {
  @IsString()
  @Matches(/^\s*\d{10}\s*$/, {
    message: 'accountNumber must be a 10-digit account number',
  })
  accountNumber!: string;
}
