import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Roles } from '../auth/decorators';
import { nowIso } from '../common/util';
import { API_BASE } from '../constants';
import { basePathError, normalizeBasePath, PathIndex, slugify, uniqueKey } from '../endpoints/route-rules';
import { Db, Layer, Project } from '../storage/models';
import { StoreService } from '../storage/store.service';

export class ProjectInputDto {
  @ApiPropertyOptional({ example: 'HomeFit' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ example: 'homefit', description: 'Slug used by import files and ?project=. Derived from the name when left out.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  key?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    example: '/homefit',
    description: 'Static prefix added to every endpoint of the project. "" serves them at their own path.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  basePath?: string;

  @ApiPropertyOptional({ description: 'Sort order in the UI' })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class LayerInputDto extends ProjectInputDto {
  @ApiPropertyOptional({ example: '/api', description: 'Added after the project prefix' })
  declare basePath?: string;
}

const projectView = (p: Project, layers: Layer[], count: (scope: { projectId?: string; layerId?: string }) => number) => ({
  ...p,
  endpoints: count({ projectId: p.id }),
  layers: layers
    .filter((l) => l.projectId === p.id)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((l) => ({ ...l, endpoints: count({ layerId: l.id }) })),
});

@ApiTags('projects')
@ApiBearerAuth()
@Controller(`${API_BASE}/projects`)
export class ProjectsController {
  constructor(private readonly store: StoreService) {}

  @Get()
  @ApiOperation({
    summary: 'Projects with their layers',
    description:
      'A project groups the mocks of one product and can prefix their URLs. A layer is a tier inside it ' +
      '(cloud API, local server, core…) and can add a second prefix.',
  })
  list() {
    const db = this.store.db;
    const count = (scope: { projectId?: string; layerId?: string }) =>
      db.endpoints.filter((e) =>
        scope.layerId ? e.layerId === scope.layerId : e.projectId === scope.projectId,
      ).length;
    return [...db.projects]
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map((p) => projectView(p, [...db.layers], count));
  }

  @Post()
  @Roles('admin', 'backend')
  @ApiOperation({ summary: 'Add a project. Applies at once; no proposal or review.' })
  create(@Body() dto: ProjectInputDto) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('name is required');
    return this.store.write(['projects'], (db) => {
      const taken = new Set(db.projects.map((p) => p.key));
      const key = this.checkedKey(dto.key, name, taken, 'project');
      const now = nowIso();
      const project: Project = {
        id: randomUUID(),
        key,
        name,
        description: dto.description?.trim() || undefined,
        basePath: this.checkedBasePath(dto.basePath),
        order: dto.order ?? db.projects.length,
        createdAt: now,
        updatedAt: now,
      };
      db.projects.push(project);
      this.assertNoCollisions(db);
      return projectView(project, [], () => 0);
    });
  }

  @Patch(':id')
  @Roles('admin', 'backend')
  @ApiOperation({
    summary: 'Rename a project, or change its prefix',
    description: 'Changing the prefix moves every endpoint of the project to a new URL at once. Refused if that would make two mocks share a URL.',
  })
  update(@Param('id') id: string, @Body() dto: ProjectInputDto) {
    return this.store.write(['projects'], (db) => {
      const project = db.projects.find((p) => p.id === id);
      if (!project) throw new NotFoundException('Project not found');
      if (dto.name !== undefined) {
        const name = dto.name.trim();
        if (!name) throw new BadRequestException('name cannot be empty');
        project.name = name;
      }
      if (dto.key !== undefined) {
        const taken = new Set(db.projects.filter((p) => p.id !== id).map((p) => p.key));
        project.key = this.checkedKey(dto.key, project.name, taken, 'project');
      }
      if (dto.description !== undefined) project.description = dto.description.trim() || undefined;
      if (dto.basePath !== undefined) project.basePath = this.checkedBasePath(dto.basePath);
      if (dto.order !== undefined) project.order = dto.order;
      project.updatedAt = nowIso();
      this.assertNoCollisions(db);
      return projectView(project, [...db.layers], () => 0);
    });
  }

  @Delete(':id')
  @Roles('admin', 'backend')
  @ApiOperation({ summary: 'Delete an empty project (with its layers)' })
  remove(@Param('id') id: string) {
    return this.store.write(['projects', 'layers'], (db) => {
      const project = db.projects.find((p) => p.id === id);
      if (!project) throw new NotFoundException('Project not found');
      const used = db.endpoints.filter((e) => e.projectId === id).length;
      if (used) {
        throw new ConflictException(
          `${project.name} still holds ${used} endpoint(s). Move or delete them first, then delete the project.`,
        );
      }
      db.projects = db.projects.filter((p) => p.id !== id);
      db.layers = db.layers.filter((l) => l.projectId !== id);
      return { deleted: project.key };
    });
  }

  @Post(':id/layers')
  @Roles('admin', 'backend')
  @ApiOperation({ summary: 'Add a layer to a project' })
  addLayer(@Param('id') id: string, @Body() dto: LayerInputDto) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('name is required');
    return this.store.write(['layers'], (db) => {
      const project = this.findProject(db, id);
      const taken = new Set(db.layers.filter((l) => l.projectId === project.id).map((l) => l.key));
      const now = nowIso();
      const layer: Layer = {
        id: randomUUID(),
        projectId: project.id,
        key: this.checkedKey(dto.key, name, taken, 'layer'),
        name,
        description: dto.description?.trim() || undefined,
        basePath: this.checkedBasePath(dto.basePath),
        order: dto.order ?? db.layers.filter((l) => l.projectId === project.id).length,
        createdAt: now,
        updatedAt: now,
      };
      db.layers.push(layer);
      this.assertNoCollisions(db);
      return { ...layer, endpoints: 0 };
    });
  }

  @Patch(':id/layers/:layerId')
  @Roles('admin', 'backend')
  @ApiOperation({ summary: 'Rename a layer, or change its prefix' })
  updateLayer(@Param('id') id: string, @Param('layerId') layerId: string, @Body() dto: LayerInputDto) {
    return this.store.write(['layers'], (db) => {
      const project = this.findProject(db, id);
      const layer = db.layers.find((l) => l.id === layerId && l.projectId === project.id);
      if (!layer) throw new NotFoundException('Layer not found in this project');
      if (dto.name !== undefined) {
        const name = dto.name.trim();
        if (!name) throw new BadRequestException('name cannot be empty');
        layer.name = name;
      }
      if (dto.key !== undefined) {
        const taken = new Set(db.layers.filter((l) => l.projectId === project.id && l.id !== layerId).map((l) => l.key));
        layer.key = this.checkedKey(dto.key, layer.name, taken, 'layer');
      }
      if (dto.description !== undefined) layer.description = dto.description.trim() || undefined;
      if (dto.basePath !== undefined) layer.basePath = this.checkedBasePath(dto.basePath);
      if (dto.order !== undefined) layer.order = dto.order;
      layer.updatedAt = nowIso();
      this.assertNoCollisions(db);
      return layer;
    });
  }

  @Delete(':id/layers/:layerId')
  @Roles('admin', 'backend')
  @ApiOperation({ summary: 'Delete an empty layer' })
  removeLayer(@Param('id') id: string, @Param('layerId') layerId: string) {
    return this.store.write(['layers'], (db) => {
      const project = this.findProject(db, id);
      const layer = db.layers.find((l) => l.id === layerId && l.projectId === project.id);
      if (!layer) throw new NotFoundException('Layer not found in this project');
      const used = db.endpoints.filter((e) => e.layerId === layerId).length;
      if (used) {
        throw new ConflictException(
          `${layer.name} still holds ${used} endpoint(s). Move them to another layer first, then delete this one.`,
        );
      }
      db.layers = db.layers.filter((l) => l.id !== layerId);
      return { deleted: layer.key };
    });
  }

  // ----- internals -----

  private findProject(db: Db, id: string): Project {
    const project = db.projects.find((p) => p.id === id);
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  private checkedKey(raw: string | undefined, name: string, taken: Set<string>, what: string): string {
    if (raw === undefined || !raw.trim()) return uniqueKey(name, taken, what);
    const key = slugify(raw, what);
    if (taken.has(key)) throw new ConflictException(`Another ${what} already uses the key "${key}"`);
    return key;
  }

  private checkedBasePath(raw: string | undefined): string {
    const basePath = normalizeBasePath(raw);
    const bad = basePathError(basePath);
    if (bad) throw new BadRequestException(`basePath: ${bad}`);
    return basePath;
  }

  /** Two endpoints must never resolve to the same URL, whatever their project and layer. */
  private assertNoCollisions(db: Db): void {
    const paths = new PathIndex(db.projects, db.layers);
    const taken = new Map<string, string>();
    const errors: string[] = [];
    for (const e of db.endpoints) {
      const key = paths.key(e);
      const other = taken.get(key);
      if (other) errors.push(`${paths.label(e)} would collide with ${other}`);
      else taken.set(key, paths.label(e));
    }
    if (errors.length) {
      throw new ConflictException({ statusCode: 409, message: 'That prefix would make two mocks share a URL', errors });
    }
  }
}
