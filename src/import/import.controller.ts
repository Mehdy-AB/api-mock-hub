import { BadRequestException, Body, Controller, ForbiddenException, Injectable, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { Allow, IsBoolean, IsDefined, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../auth/decorators';
import { isPlainObject } from '../common/json-utils';
import { nowIso } from '../common/util';
import { API_BASE } from '../constants';
import {
  basePathError,
  normalizeBasePath,
  PathIndex,
  sameContent,
  sanitizeEndpoint,
  uniqueKey,
} from '../endpoints/route-rules';
import { ChangeInput, PROPOSAL_COLLECTIONS, ProposalsService } from '../proposals/proposals.service';
import { AuthUser, Db, EndpointContent, Layer, PROPOSAL_KINDS, Project, ProposalKind } from '../storage/models';
import { CollectionName, StoreService } from '../storage/store.service';
import { DeclaredProject, detectFormat, extractHubItems, extractHubProjects } from './hub-format';
import { parseOpenApi } from './openapi-parser';

const IMPORT_COLLECTIONS: CollectionName[] = ['projects', 'layers', ...PROPOSAL_COLLECTIONS];

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

  @ApiPropertyOptional({
    example: 'homefit',
    description: 'Project key or id every imported endpoint goes into, unless an endpoint names its own "project".',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  project?: string;

  @ApiPropertyOptional({ example: 'local', description: 'Layer key or id inside that project' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  layer?: string;

  @ApiPropertyOptional({
    description: 'Create the projects and layers the file refers to when they do not exist yet (admin or backend only)',
  })
  @IsOptional()
  @IsBoolean()
  createMissing?: boolean;
}

/**
 * Puts each imported endpoint into a project and a layer.
 * Endpoints may name their own "project" and "layer" keys; otherwise the import-wide ones apply.
 */
class ScopeResolver {
  private readonly declared = new Map<string, DeclaredProject>();
  private readonly created: string[] = [];

  constructor(
    private readonly db: Db,
    declared: DeclaredProject[],
    private readonly dto: ImportDto,
    private readonly user: AuthUser,
    private readonly warnings: string[],
  ) {
    for (const d of declared) this.declared.set(d.key, d);
  }

  assign(content: EndpointContent, raw: unknown): EndpointContent {
    const item = isPlainObject(raw) ? raw : {};
    const projectRef = str(item.project) ?? this.dto.project;
    const layerRef = str(item.layer) ?? (str(item.project) ? undefined : this.dto.layer);
    if (!projectRef) return content;
    const project = this.project(projectRef);
    const layer = layerRef ? this.layer(project, layerRef) : undefined;
    return { ...content, projectId: project.id, ...(layer ? { layerId: layer.id } : {}) };
  }

  /** Projects and layers this import created, so the caller can see the new structure. */
  touched(): string[] {
    return this.created;
  }

  private project(ref: string): Project {
    const found = this.db.projects.find((p) => p.key === ref || p.id === ref);
    if (found) return found;
    const declared = this.declared.get(ref);
    this.assertMayCreate(`project "${ref}"`);
    const now = nowIso();
    const project: Project = {
      id: randomUUID(),
      key: uniqueKey(ref, new Set(this.db.projects.map((p) => p.key)), 'project'),
      name: declared?.name?.trim() || ref,
      description: declared?.description?.trim() || undefined,
      basePath: this.basePath(declared?.basePath, `project "${ref}"`),
      order: this.db.projects.length,
      createdAt: now,
      updatedAt: now,
    };
    this.db.projects.push(project);
    this.created.push(`project ${project.key}`);
    return project;
  }

  private layer(project: Project, ref: string): Layer {
    const found = this.db.layers.find((l) => l.projectId === project.id && (l.key === ref || l.id === ref));
    if (found) return found;
    const declared = this.declared.get(project.key)?.layers?.find((l) => l.key === ref);
    this.assertMayCreate(`layer "${ref}" of project "${project.key}"`);
    const now = nowIso();
    const layer: Layer = {
      id: randomUUID(),
      projectId: project.id,
      key: uniqueKey(ref, new Set(this.db.layers.filter((l) => l.projectId === project.id).map((l) => l.key)), 'layer'),
      name: declared?.name?.trim() || ref,
      description: declared?.description?.trim() || undefined,
      basePath: this.basePath(declared?.basePath, `layer "${ref}"`),
      order: this.db.layers.filter((l) => l.projectId === project.id).length,
      createdAt: now,
      updatedAt: now,
    };
    this.db.layers.push(layer);
    this.created.push(`layer ${project.key}/${layer.key}`);
    return layer;
  }

  private assertMayCreate(what: string): void {
    if (!this.dto.createMissing) {
      throw new Error(`no ${what} in this hub. Create it first, or send "createMissing": true.`);
    }
    if (this.user.role !== 'admin' && this.user.role !== 'backend') {
      throw new ForbiddenException(`Only admins and backend users can create ${what}`);
    }
  }

  private basePath(raw: string | undefined, what: string): string {
    const basePath = normalizeBasePath(raw);
    const bad = basePathError(basePath);
    if (bad) {
      this.warnings.push(`${what}: ignored basePath "${raw}" (${bad})`);
      return '';
    }
    return basePath;
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

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
    const declared = format === 'hub' ? extractHubProjects(dto.data) : [];

    return this.store.write(IMPORT_COLLECTIONS, (db) => {
      const scopes = new ScopeResolver(db, declared, dto, user, warnings);
      const errors: string[] = [];
      const contents: EndpointContent[] = [];
      items.forEach((item, i) => {
        const at = `endpoints[${i}]`;
        const r = sanitizeEndpoint(item, at);
        if (!r.value) return errors.push(...r.errors);
        try {
          contents.push(scopes.assign(r.value, item));
        } catch (e) {
          if (e instanceof ForbiddenException) throw e;
          errors.push(`${at}: ${e.message}`);
        }
      });

      const paths = new PathIndex(db.projects, db.layers);
      const seen = new Set<string>();
      contents.forEach((c, i) => {
        const key = paths.key(c);
        if (seen.has(key)) errors.push(`endpoints[${i}]: ${paths.label(c)} appears more than once`);
        seen.add(key);
      });
      if (errors.length) throw new BadRequestException({ statusCode: 400, message: 'Invalid import data', errors });

      const summary = { added: [] as string[], updated: [] as string[], unchanged: [] as string[] };
      const changes: ChangeInput[] = [];
      for (const c of contents) {
        const key = paths.key(c);
        const existing = db.endpoints.find((e) => paths.key(e) === key);
        if (!existing) {
          changes.push({ type: 'add', endpoint: c });
          summary.added.push(paths.label(c));
        } else if (sameContent(existing, c)) {
          summary.unchanged.push(paths.label(c));
        } else {
          changes.push({ type: 'update', endpointId: existing.id, endpoint: c });
          summary.updated.push(paths.label(c));
        }
      }
      if (!changes.length) return { proposal: null, format, summary, warnings, created: scopes.touched() };

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
      return {
        proposal: this.proposals.view(db.settings, p),
        format,
        summary,
        warnings,
        created: scopes.touched(),
      };
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
  @ApiQuery({ name: 'project', required: false, description: 'Project key or id for every endpoint of this import' })
  @ApiQuery({ name: 'layer', required: false, description: 'Layer key or id inside that project' })
  import(
    @Body() dto: ImportDto,
    @CurrentUser() user: AuthUser,
    @Query('direct') direct?: string,
    @Query('project') project?: string,
    @Query('layer') layer?: string,
  ) {
    const scoped: ImportDto = { ...dto, project: dto.project ?? project, layer: dto.layer ?? layer };
    return this.importer.import(scoped, user, direct === 'true' || direct === '1');
  }
}
