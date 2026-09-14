import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators';
import { API_BASE } from '../constants';
import { AuthUser } from '../storage/models';
import { StoreService } from '../storage/store.service';
import { CreateProposalDto, ReasonDto } from './proposal.dto';
import { ProposalsService } from './proposals.service';
import { changeRoute, changeWithDiff } from './view';

@ApiTags('commits')
@ApiBearerAuth()
@Controller(`${API_BASE}/commits`)
export class CommitsController {
  constructor(
    private readonly store: StoreService,
    private readonly proposals: ProposalsService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Save changes directly',
    description: 'Applied at once as a commit. Teammates can discard it. Needs the allowDirectCommits setting.',
  })
  create(@Body() dto: CreateProposalDto, @CurrentUser() user: AuthUser) {
    return this.proposals.commitDirect(dto, user);
  }

  @Post(':id/discard')
  @HttpCode(200)
  @ApiOperation({ summary: 'Undo a commit for everyone by applying its inverse as a new commit' })
  discard(@Param('id', ParseIntPipe) id: number, @Body() dto: ReasonDto, @CurrentUser() user: AuthUser) {
    return this.proposals.discardCommit(id, dto.reason, user);
  }

  @Get()
  @ApiOperation({ summary: 'History of applied proposals, newest first' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'before', required: false, type: Number, description: 'Only commits with a smaller id' })
  @ApiQuery({ name: 'endpointId', required: false, description: 'Only commits that touched this endpoint' })
  list(@Query('limit') limit?: string, @Query('before') before?: string, @Query('endpointId') endpointId?: string) {
    const max = Math.min(Math.max(Number(limit) || 50, 1), 500);
    const beforeId = Number(before) || Infinity;
    return [...this.store.db.commits]
      .reverse()
      .filter((c) => c.id < beforeId)
      .filter((c) => !endpointId || c.changes.some((ch) => ch.endpointId === endpointId))
      .slice(0, max)
      .map((c) => ({
        id: c.id,
        proposalId: c.proposalId,
        title: c.title,
        author: c.author,
        approvedBy: c.approvedBy,
        at: c.at,
        changes: c.changes.map((ch) => `${ch.type} ${changeRoute(ch)}`),
        endpointIds: c.changes.map((ch) => ch.endpointId).filter((id): id is string => !!id),
        direct: c.direct,
        revertOf: c.revertOf,
        revertedBy: c.revertedBy,
      }));
  }

  @Get(':id')
  @ApiOperation({ summary: 'One commit with full changes and diffs' })
  get(@Param('id', ParseIntPipe) id: number) {
    const c = this.store.db.commits.find((x) => x.id === id);
    if (!c) throw new NotFoundException(`Commit ${id} not found`);
    return { ...c, changes: c.changes.map(changeWithDiff) };
  }
}
