import { BadRequestException, Body, Controller, ForbiddenException, Injectable, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Allow, IsDefined, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../auth/decorators';
import { API_BASE } from '../constants';
import { routeKey, routeLabel, sameContent, sanitizeEndpoint } from '../endpoints/route-rules';
import { PROPOSAL_COLLECTIONS, ChangeInput, ProposalsService } from '../proposals/proposals.service';
import { AuthUser, EndpointContent, PROPOSAL_KINDS, ProposalKind } from '../storage/models';
import { StoreService } from '../storage/store.service';
import { detectFormat, extractHubItems } from './hub-format';
import { parseOpenApi } from './openapi-parser';

export class ImportDto {
  @ApiPropertyOptional({ enum: ['auto', 'hub', 'openapi'], default: 'auto' })
  @IsOptional()
  @IsIn(['auto', 'hub', 'openapi'])
  format?: 'auto' | 'hub' | 'openapi';

  @ApiProperty({
    description:
      'A hub export ({ "endpoints": [...] }), an array of endpoints, one endpoint, or a whole OpenAPI 3 / Swagger 2 document',
    example: {
      endpoints: [
        { method: 'GET', path: '/users', tags: ['users'], response: { status: 200, body: [{ id: 1, name: 'Sara' }] } },
      ],
    },
  })
  @IsDefined()
  @Allow()
  data: unknown;

  @ApiPropertyOptional({
    description: 'OpenAPI only: prefix for every path. Defaults to the document server path or basePath. "" for none.',
  })
  @IsOptional()
  @IsString()
  basePath?: string;

  @ApiPropertyOptional({ example: 'Import orders API contract' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  message?: string;

  @ApiPropertyOptional({ enum: [...PROPOSAL_KINDS] })
  @IsOptional()
  @IsIn([...PROPOSAL_KINDS])
  kind?: ProposalKind;
}

@Injectable()
export class ImportService {
  constructor(
    private readonly store: StoreService,
    private readonly proposals: ProposalsService,
  ) {}

  import(dto: ImportDto, user: AuthUser, direct: boolean) {
    if (direct && user.role !== 'admin') throw new ForbiddenException('Only admins can import without review');

    const format = !dto.format || dto.format === 'auto' ? detectFormat(dto.data) : dto.format;
    const warnings: string[] = [];
    let items: unknown[];
    try {
      if (format === 'openapi') {
        const parsed = parseOpenApi(dto.data, { basePath: dto.basePath });
        items = parsed.endpoints;
        warnings.push(...parsed.warnings);
      } else {
        items = extractHubItems(dto.data);
      }
    } catch (e) {
      throw new BadRequestException(e.message);
    }
    if (!items.length) throw new BadRequestException('No endpoints found in the import data');

    const errors: string[] = [];
    const contents: EndpointContent[] = [];
    const seen = new Set<string>();
    items.forEach((item, i) => {
      const r = sanitizeEndpoint(item, `endpoints[${i}]`);
      if (!r.value) return errors.push(...r.errors);
      const key = routeKey(r.value.method, r.value.path);
      if (seen.has(key)) return errors.push(`endpoints[${i}]: ${routeLabel(r.value)} appears more than once`);
      seen.add(key);
      contents.push(r.value);
    });
    if (errors.length) throw new BadRequestException({ statusCode: 400, message: 'Invalid import data', errors });

    return this.store.write(PROPOSAL_COLLECTIONS, (db) => {
      const summary = { added: [] as string[], updated: [] as string[], unchanged: [] as string[] };
      const changes: ChangeInput[] = [];
      for (const c of contents) {
        const key = routeKey(c.method, c.path);
        const existing = db.endpoints.find((e) => routeKey(e.method, e.path) === key);
        if (!existing) {
          changes.push({ type: 'add', endpoint: c });
          summary.added.push(routeLabel(c));
        } else if (sameContent(existing, c)) {
          summary.unchanged.push(routeLabel(c));
        } else {
          changes.push({ type: 'update', endpointId: existing.id, endpoint: c });
          summary.updated.push(routeLabel(c));
        }
      }
      if (!changes.length) return { proposal: null, format, summary, warnings };

      const p = this.proposals.createIn(
        db,
        {
          title: dto.title?.trim() || `Import ${changes.length} endpoint(s)`,
          message: dto.message ?? `Imported from ${format} data: ${summary.added.length} added, ${summary.updated.length} updated.`,
          kind: dto.kind,
          changes,
        },
        user,
      );
      if (direct) this.proposals.applyIn(db, p, [user.username]);
      else this.proposals.autoApplyIfReady(db, p);
      return { proposal: this.proposals.view(db.settings, p), format, summary, warnings };
    });
  }
}

@ApiTags('import')
@ApiBearerAuth()
@Controller(`${API_BASE}/import`)
export class ImportController {
  constructor(private readonly importer: ImportService) {}

  @Post()
  @ApiOperation({
    summary: 'Import endpoints as one proposal',
    description:
      'New routes become "add" changes, changed routes become "update" changes, identical ones are skipped. Nothing is deleted.',
  })
  @ApiQuery({ name: 'direct', required: false, type: Boolean, description: 'Admin only: apply without review' })
  import(@Body() dto: ImportDto, @CurrentUser() user: AuthUser, @Query('direct') direct?: string) {
    return this.importer.import(dto, user, direct === 'true' || direct === '1');
  }
}
