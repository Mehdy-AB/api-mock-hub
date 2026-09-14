import { BadRequestException, Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { API_BASE } from '../constants';
import { buildHubExport } from '../import/hub-format';
import { generateOpenApi } from '../openapi/openapi-generator';
import { HTTP_METHODS } from '../storage/models';
import { StoreService } from '../storage/store.service';
import { contentOf } from './route-rules';

@ApiTags('endpoints')
@ApiBearerAuth()
@Controller(`${API_BASE}/endpoints`)
export class EndpointsController {
  constructor(private readonly store: StoreService) {}

  @Get()
  @ApiOperation({ summary: 'Live endpoints. Change them through proposals.' })
  @ApiQuery({ name: 'tag', required: false })
  @ApiQuery({ name: 'method', required: false, enum: [...HTTP_METHODS] })
  @ApiQuery({ name: 'q', required: false, description: 'Search path, summary and tags' })
  list(@Query('tag') tag?: string, @Query('method') method?: string, @Query('q') q?: string) {
    const needle = q?.trim().toLowerCase();
    return this.store.db.endpoints
      .filter((e) => !tag || e.tags.includes(tag))
      .filter((e) => !method || e.method === method.toUpperCase())
      .filter(
        (e) =>
          !needle ||
          e.path.toLowerCase().includes(needle) ||
          (e.summary ?? '').toLowerCase().includes(needle) ||
          e.tags.some((t) => t.toLowerCase().includes(needle)),
      )
      .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  }

  @Get('export')
  @ApiOperation({ summary: 'Export live endpoints (hub JSON re-imports cleanly; openapi is for the real backend)' })
  @ApiQuery({ name: 'format', required: false, enum: ['hub', 'openapi'] })
  export(@Query('format') format = 'hub') {
    const { endpoints } = this.store.db;
    if (format === 'openapi') return generateOpenApi(endpoints, { commitId: this.store.lastCommitId });
    if (format !== 'hub') throw new BadRequestException('format must be hub or openapi');
    return buildHubExport(endpoints.map(contentOf), this.store.lastCommitId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    const e = this.store.db.endpoints.find((x) => x.id === id);
    if (!e) throw new NotFoundException('Endpoint not found');
    return e;
  }
}
