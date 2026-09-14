import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators';
import { API_BASE } from '../constants';
import { AuthUser, PROPOSAL_KINDS, PROPOSAL_STATUSES } from '../storage/models';
import { CommentDto, CreateProposalDto, ReasonDto, ReviewDto, UpdateProposalDto } from './proposal.dto';
import { ProposalsService } from './proposals.service';

@ApiTags('proposals')
@ApiBearerAuth()
@Controller(`${API_BASE}/proposals`)
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Get()
  @ApiOperation({ summary: 'List proposals, newest first' })
  @ApiQuery({ name: 'status', required: false, description: `One or more of ${PROPOSAL_STATUSES.join(', ')}, comma separated` })
  @ApiQuery({ name: 'kind', required: false, enum: [...PROPOSAL_KINDS] })
  @ApiQuery({ name: 'author', required: false })
  @ApiQuery({ name: 'endpointId', required: false, description: 'Only proposals that touch this endpoint' })
  @ApiQuery({ name: 'full', required: false, type: Boolean, description: 'Return whole proposals with changes and diffs' })
  list(
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('author') author?: string,
    @Query('endpointId') endpointId?: string,
    @Query('full') full?: string,
  ) {
    for (const s of (status ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
      if (!PROPOSAL_STATUSES.includes(s as never)) {
        throw new BadRequestException(`status must be one of ${PROPOSAL_STATUSES.join(', ')}`);
      }
    }
    return this.proposals.list({ status, kind, author, endpointId }, full === 'true' || full === '1');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Proposal detail with per-change diff and approval state' })
  get(@Param('id', ParseIntPipe) id: number) {
    return this.proposals.get(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Propose changes (your "commit")',
    description: 'Applied automatically once the approval rule in /settings is met.',
  })
  create(@Body() dto: CreateProposalDto, @CurrentUser() user: AuthUser) {
    return this.proposals.create(dto, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit an open or conflicting proposal (author or admin)' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProposalDto, @CurrentUser() user: AuthUser) {
    return this.proposals.update(id, dto, user);
  }

  @Post(':id/rebase')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve a conflict by re-basing your changes on the latest live endpoints' })
  rebase(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.proposals.rebase(id, user);
  }

  @Post(':id/reviews')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve or request changes' })
  review(@Param('id', ParseIntPipe) id: number, @Body() dto: ReviewDto, @CurrentUser() user: AuthUser) {
    return this.proposals.review(id, dto.decision, dto.comment, user);
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Add a comment' })
  comment(@Param('id', ParseIntPipe) id: number, @Body() dto: CommentDto, @CurrentUser() user: AuthUser) {
    return this.proposals.comment(id, dto.text, user);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject a proposal (reviewer)' })
  reject(@Param('id', ParseIntPipe) id: number, @Body() dto: ReasonDto, @CurrentUser() user: AuthUser) {
    return this.proposals.reject(id, dto.reason, user);
  }

  @Post(':id/close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Withdraw a proposal (author or admin)' })
  close(@Param('id', ParseIntPipe) id: number, @Body() dto: ReasonDto, @CurrentUser() user: AuthUser) {
    return this.proposals.close(id, dto.reason, user);
  }
}
