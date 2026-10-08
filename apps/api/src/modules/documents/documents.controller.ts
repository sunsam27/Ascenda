import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { DocumentsService } from './documents.service';

/**
 * Documents Controller
 * TODO: Implement PRD endpoints for this module.
 * Every route requires JWT + RBAC guard.
 */
@ApiTags('documents')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('documents')
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  @Get()
  findAll() {
    return { message: 'Documents module  coming soon' };
  }
}
