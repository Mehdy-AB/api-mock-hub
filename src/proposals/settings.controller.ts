import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import { Roles } from '../auth/decorators';
import { API_BASE } from '../constants';
import { PROPOSAL_KINDS, Role, ROLES } from '../storage/models';
import { StoreService } from '../storage/store.service';

class ApproverRolesDto {
  @ApiPropertyOptional({ enum: [...ROLES], nullable: true, description: 'Who may approve "publish" proposals' })
  @IsOptional()
  @IsIn([...ROLES])
  publish?: Role | null;

  @ApiPropertyOptional({ enum: [...ROLES], nullable: true, description: 'Who may approve "request" proposals' })
  @IsOptional()
  @IsIn([...ROLES])
  request?: Role | null;
}

class UpdateSettingsDto {
  @ApiPropertyOptional({ description: 'true = Save applies changes at once and teammates can discard the commit' })
  @IsOptional()
  @IsBoolean()
  allowDirectCommits?: boolean;

  @ApiPropertyOptional({ description: 'false = proposals go live immediately' })
  @IsOptional()
  @IsBoolean()
  requireApproval?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  minApprovals?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  approverMustDiffer?: boolean;

  @ApiPropertyOptional({ type: ApproverRolesDto, example: { publish: 'frontend', request: 'backend' } })
  @IsOptional()
  @ValidateNested()
  @Type(() => ApproverRolesDto)
  requiredApproverRole?: ApproverRolesDto;
}

@ApiTags('settings')
@ApiBearerAuth()
@Controller(`${API_BASE}/settings`)
export class SettingsController {
  constructor(private readonly store: StoreService) {}

  @Get()
  @ApiOperation({ summary: 'Approval rules' })
  get() {
    return this.store.db.settings;
  }

  @Patch()
  @Roles('admin')
  @ApiOperation({ summary: 'Change approval rules (admin)' })
  update(@Body() dto: UpdateSettingsDto) {
    return this.store.write(['settings'], (db) => {
      const s = db.settings;
      if (dto.allowDirectCommits !== undefined) s.allowDirectCommits = dto.allowDirectCommits;
      if (dto.requireApproval !== undefined) s.requireApproval = dto.requireApproval;
      if (dto.minApprovals !== undefined) s.minApprovals = dto.minApprovals;
      if (dto.approverMustDiffer !== undefined) s.approverMustDiffer = dto.approverMustDiffer;
      if (dto.requiredApproverRole) {
        for (const kind of PROPOSAL_KINDS) {
          const v = dto.requiredApproverRole[kind];
          if (v !== undefined) s.requiredApproverRole[kind] = v ?? null;
        }
      }
      return structuredClone(s);
    });
  }
}
