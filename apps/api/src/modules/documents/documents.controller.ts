import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PermissionScope } from '@ascenda/types';
import { RequirePermission } from '../../common/rbac/permission.decorator';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { ListDocumentsQueryDto } from './dto/list-documents.dto';

const ORG = PermissionScope.ORGANISATION;
const SELF = PermissionScope.SELF;

@ApiTags('documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  @Get()
  @ApiOperation({ summary: 'List documents (directory, filters + pagination)' })
  @RequirePermission({ resource: 'documents', action: 'read', scope: SELF })
  async list(@Query() query: ListDocumentsQueryDto) {
    const { data, meta } = await this.service.list(query);
    return { data, meta };
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download a document (auth-scoped, streamed)' })
  @RequirePermission({ resource: 'documents', action: 'read', scope: SELF })
  async download(@Param('id') id: string, @Res() res: Response) {
    const { document, buffer } = await this.service.download(id);
    const encoded = encodeURIComponent(document.name);
    res.setHeader(
      'Content-Type',
      document.mimeType || 'application/octet-stream',
    );
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`,
    );
    res.end(buffer);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single document’s metadata' })
  @RequirePermission({ resource: 'documents', action: 'read', scope: SELF })
  async get(@Param('id') id: string) {
    return { data: await this.service.get(id) };
  }

  @Post()
  @ApiOperation({ summary: 'Upload a document (base64 body)' })
  @RequirePermission({ resource: 'documents', action: 'create', scope: ORG })
  async create(@Body() dto: CreateDocumentDto) {
    return { data: await this.service.create(dto) };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a document and its stored file' })
  @RequirePermission({ resource: 'documents', action: 'delete', scope: ORG })
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
  }
}
