import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  ParseUUIDPipe,
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
import { DocumentWorkflowsService } from './document-workflows.service';
import { DocumentAudienceDto, PublishAnnouncementDto, UpdateDocumentDto } from './dto/document-workflows.dto';

const ORG = PermissionScope.ORGANISATION;
const SELF = PermissionScope.SELF;

@ApiTags('documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly service: DocumentsService, private readonly workflows: DocumentWorkflowsService) {}

  @Get('announcements')
  @RequirePermission({ resource: 'documents', action: 'read', scope: SELF })
  announcements(@Query() query: ListDocumentsQueryDto) { return this.workflows.announcements(query.page); }

  @Post('announcements')
  @RequirePermission({ resource: 'documents', action: 'create', scope: ORG })
  publishAnnouncement(@Body() dto: PublishAnnouncementDto) { return this.workflows.publishAnnouncement(dto); }

  @Post(':id/publish')
  @RequirePermission({ resource: 'documents', action: 'update', scope: ORG })
  publishPolicy(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DocumentAudienceDto) {
    return this.workflows.publishPolicy(id, dto);
  }

  @Post(':id/acknowledge')
  @RequirePermission({ resource: 'documents', action: 'read', scope: SELF })
  acknowledge(@Param('id', ParseUUIDPipe) id: string) { return this.workflows.acknowledge(id); }

  @Get(':id/acknowledgements')
  @RequirePermission({ resource: 'documents', action: 'update', scope: ORG })
  acknowledgements(@Param('id', ParseUUIDPipe) id: string) { return this.workflows.policyReport(id); }

  @Patch(':id')
  @RequirePermission({ resource: 'documents', action: 'update', scope: ORG })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDocumentDto) { return this.workflows.updateDocument(id, dto); }

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
    const { document, buffer, signedUrl } = await this.service.download(id);
    res.setHeader('Cache-Control', 'private, no-store');
    if (signedUrl) return res.redirect(302, signedUrl);
    if (!buffer) throw new Error('Document bytes unavailable');
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
