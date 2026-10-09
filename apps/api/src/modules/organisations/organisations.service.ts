import { Injectable } from '@nestjs/common';
import { Organisation } from '@ascenda/db';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Organisations Service
 * Reads are scoped by RLS to the caller's active organisation (SECURITY.md §3).
 */
@Injectable()
export class OrganisationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrent(): Promise<Organisation[]> {
    return this.prisma.withRequestContext((tx) => tx.organisation.findMany());
  }
}
