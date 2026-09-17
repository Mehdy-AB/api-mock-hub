import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { EndpointInputDto } from '../endpoints/endpoint.dto';
import {
  CHANGE_TYPES,
  ChangeType,
  PROPOSAL_KINDS,
  ProposalKind,
  REVIEW_DECISIONS,
  ReviewDecision,
} from '../storage/models';

export class ChangeInputDto {
  @ApiProperty({ enum: [...CHANGE_TYPES], example: 'add' })
  @IsIn([...CHANGE_TYPES])
  type: ChangeType;

  @ApiPropertyOptional({ description: 'update/delete: target endpoint id. Use this or "ref".' })
  @IsOptional()
  @IsString()
  endpointId?: string;

  @ApiPropertyOptional({ description: 'update/delete: target by route instead of id', example: 'GET /users/:id' })
  @IsOptional()
  @IsString()
  ref?: string;

  @ApiPropertyOptional({ description: 'update/delete: the version you edited. Rejected if the live endpoint moved on.' })
  @IsOptional()
  @IsInt()
  baseVersion?: number;

  @ApiPropertyOptional({
    type: EndpointInputDto,
    description: 'add/update: the full endpoint. An update replaces the whole endpoint.',
  })
  @IsOptional()
  @IsObject()
  endpoint?: Record<string, unknown>;
}

export class CreateProposalDto {
  @ApiProperty({ example: 'Add user detail endpoint', description: 'Like a commit subject' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ example: 'Needed by the profile page. Fields agreed in standup.' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  message?: string;

  @ApiPropertyOptional({
    enum: [...PROPOSAL_KINDS],
    description: 'publish = backend publishes a contract, request = frontend asks for data. Defaults from your role.',
  })
  @IsOptional()
  @IsIn([...PROPOSAL_KINDS])
  kind?: ProposalKind;

  @ApiProperty({ type: [ChangeInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ChangeInputDto)
  changes: ChangeInputDto[];
}

export class UpdateProposalDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
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

  @ApiPropertyOptional({ type: [ChangeInputDto], description: 'Replaces all changes and clears reviews' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ChangeInputDto)
  changes?: ChangeInputDto[];
}

export class ReviewDto {
  @ApiProperty({ enum: [...REVIEW_DECISIONS], example: 'approve' })
  @IsIn([...REVIEW_DECISIONS])
  decision: ReviewDecision;

  @ApiPropertyOptional({ example: 'Looks good, tested from the profile page.' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  comment?: string;
}

export class CommentDto {
  @ApiProperty({ example: 'Can we add avatarUrl to the response?' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  text: string;
}

export class BackendStatusDto {
  @ApiProperty({ example: true, description: 'true = the real backend implements this commit' })
  @IsBoolean()
  done: boolean;

  @ApiPropertyOptional({ example: 'Merged in backend PR #42' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ReasonDto {
  @ApiPropertyOptional({ example: 'Superseded by #12' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  reason?: string;
}
