import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators';
import { API_BASE } from '../constants';
import { buildHubExport } from '../import/hub-format';
import { generateOpenApi } from '../openapi/openapi-generator';
import { AuthUser, HTTP_METHODS } from '../storage/models';
import { StoreService } from '../storage/store.service';
import { ActiveCaseDto, BulkActiveCaseDto } from './endpoint.dto';
import { contentOf, findCase, PathIndex, routeLabel } from './route-rules';

@ApiTags('endpoints')
@ApiBearerAuth()
@Controller(`${API_BASE}/endpoints`)
export class EndpointsController {
  constructor(private readonly store: StoreService) {}

  @Get()
  @ApiOperation({
    summary: 'Live endpoints, with the URL each one answers on. Change them through proposals.',
  })
  @ApiQuery({ name: 'tag', required: false })
  @ApiQuery({ name: 'method', required: false, enum: [...HTTP_METHODS] })
  @ApiQuery({ name: 'q', required: false, description: 'Search path, summary and tags' })
  @ApiQuery({ name: 'project', required: false, description: 'Project key or id ("none" for endpoints outside any project)' })
  @ApiQuery({ name: 'layer', required: false, description: 'Layer key or id' })
  list(
    @Query('tag') tag?: string,
    @Query('method') method?: string,
    @Query('q') q?: string,
    @Query('project') project?: string,
    @Query('layer') layer?: string,
  ) {
    const db = this.store.db;
    const index = new PathIndex(db.projects, db.layers);
    const needle = q?.trim().toLowerCase();
    const projectId = this.scopeId(project, 'project');
    const layerId = this.scopeId(layer, 'layer');
    return db.endpoints
      .filter((e) => !tag || e.tags.includes(tag))
      .filter((e) => !method || e.method === method.toUpperCase())
      .filter((e) => projectId === undefined || (projectId === null ? !e.projectId : e.projectId === projectId))
      .filter((e) => layerId === undefined || (layerId === null ? !e.layerId : e.layerId === layerId))
      .filter(
        (e) =>
          !needle ||
          index.full(e).toLowerCase().includes(needle) ||
          (e.summary ?? '').toLowerCase().includes(needle) ||
          e.tags.some((t) => t.toLowerCase().includes(needle)),
      )
      .map((e) => ({ ...e, url: index.full(e) }))
      .sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method));
  }

  @Get('export')
  @ApiOperation({
    summary: 'Export live endpoints (hub JSON re-imports cleanly, projects included; openapi is for the real backend)',
  })
  @ApiQuery({ name: 'format', required: false, enum: ['hub', 'openapi'] })
  @ApiQuery({ name: 'project', required: false, description: 'Only this project, by key or id' })
  export(@Query('format') format = 'hub', @Query('project') project?: string) {
    const db = this.store.db;
    const index = new PathIndex(db.projects, db.layers);
    const projectId = this.scopeId(project, 'project');
    const endpoints = db.endpoints.filter(
      (e) => projectId === undefined || (projectId === null ? !e.projectId : e.projectId === projectId),
    );
    if (format === 'openapi') {
      return generateOpenApi(endpoints, {
        commitId: this.store.lastCommitId,
        index,
        project: db.projects.find((p) => p.id === projectId) ?? undefined,
      });
    }
    if (format !== 'hub') throw new BadRequestException('format must be hub or openapi');
    return buildHubExport(endpoints.map(contentOf), this.store.lastCommitId, {
      projects: [...db.projects],
      layers: [...db.layers],
    });
  }

  @Post('active-case')
  @ApiOperation({
    summary: 'Switch several endpoints to the same case (by id or name)',
    description: 'Same rules as the single switch: instant, and endpoints without that case are skipped.',
  })
  setActiveCases(@Body() dto: BulkActiveCaseDto, @CurrentUser() user: AuthUser) {
    return this.store.write(['endpoints'], (db) => {
      const at = new Date().toISOString();
      const changed: string[] = [];
      const skipped: { endpoint: string; reason: string }[] = [];
      for (const id of [...new Set(dto.endpointIds)]) {
        const e = db.endpoints.find((x) => x.id === id);
        if (!e) {
          skipped.push({ endpoint: id, reason: 'no longer exists' });
          continue;
        }
        const c = findCase(e.responses, dto.case);
        if (!c) {
          skipped.push({ endpoint: routeLabel(e), reason: `has no case "${dto.case}"` });
          continue;
        }
        e.active = { caseId: c.id, by: user.username, at };
        changed.push(routeLabel(e));
      }
      return { case: dto.case, changed, skipped };
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    const db = this.store.db;
    const e = db.endpoints.find((x) => x.id === id);
    if (!e) throw new NotFoundException('Endpoint not found');
    return { ...e, url: new PathIndex(db.projects, db.layers).full(e) };
  }

  /** undefined = no filter, null = "outside any project/layer", string = that id. */
  private scopeId(ref: string | undefined, what: 'project' | 'layer'): string | null | undefined {
    const value = ref?.trim();
    if (!value) return undefined;
    if (value === 'none') return null;
    const db = this.store.db;
    const found =
      what === 'project'
        ? db.projects.find((p) => p.key === value || p.id === value)
        : db.layers.find((l) => l.key === value || l.id === value);
    if (!found) throw new NotFoundException(`No ${what} "${value}"`);
    return found.id;
  }

  @Put(':id/active-case')
  @ApiOperation({
    summary: 'Choose the response case this endpoint returns now',
    description:
      'Takes effect immediately for every caller. It is a switch, not an edit: no proposal, no approval, no commit, ' +
      'and the endpoint version stays the same. Adding or changing the cases themselves goes through the normal review.',
  })
  setActiveCase(@Param('id') id: string, @Body() dto: ActiveCaseDto, @CurrentUser() user: AuthUser) {
    return this.store.write(['endpoints'], (db) => {
      const e = db.endpoints.find((x) => x.id === id);
      if (!e) throw new NotFoundException('Endpoint not found');
      const c = findCase(e.responses, dto.case);
      if (!c) {
        throw new BadRequestException(
          `Unknown response case "${dto.case}". This endpoint has: ${e.responses.map((r) => r.id).join(', ')}`,
        );
      }
      e.active = { caseId: c.id, by: user.username, at: new Date().toISOString() };
      return e;
    });
  }
}
