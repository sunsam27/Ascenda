import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { OrganisationType } from '@ascenda/types';

export class StartRegistrationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  firstName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  lastName!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  @Matches(/[A-Z]/, { message: 'Password must include an uppercase letter' })
  @Matches(/[a-z]/, { message: 'Password must include a lowercase letter' })
  @Matches(/[0-9]/, { message: 'Password must include a number' })
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  organisationName!: string;

  @IsEnum(OrganisationType)
  organisationType!: OrganisationType;

  @IsString()
  @MaxLength(50)
  teamSize!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  role?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @IsString()
  @MaxLength(40)
  planCode!: string;
}
