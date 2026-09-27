import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow, ArrayMaxSize, ArrayNotEmpty, IsArray, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { HTTP_METHODS, HttpMethod } from '../storage/models';

/*
 * These classes document the endpoint shape in the management Swagger.
 * Real validation happens in sanitizeEndpoint() so API calls and imports share one set of rules.
 */

export class ParamDocDto {
  @ApiProperty({ example: 'id' })
  name: string;

  @ApiPropertyOptional({ example: 'User id' })
  description?: string;

  @ApiPropertyOptional()
  required?: boolean;

  @ApiPropertyOptional({ example: 42 })
  example?: unknown;
}

export class RequestDocDto {
  @ApiPropertyOptional({ type: [ParamDocDto], description: 'Docs for path params (":id")' })
  params?: ParamDocDto[];

  @ApiPropertyOptional({ type: [ParamDocDto] })
  query?: ParamDocDto[];

  @ApiPropertyOptional({ type: [ParamDocDto] })
  headers?: ParamDocDto[];

  @ApiPropertyOptional({ description: 'Example request body shown in Swagger', example: { name: 'Sara' } })
  bodyExample?: unknown;
}

export class MockResponseDto {
  @ApiProperty({ example: 200, default: 200, minimum: 100, maximum: 599 })
  status: number;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { 'X-Total-Count': '2' },
  })
  headers?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Static JSON returned as-is', example: { id: 1, name: 'Sara', role: 'admin' } })
  body?: unknown;

  @ApiPropertyOptional({ example: 0, minimum: 0, maximum: 60000, description: 'Simulated latency' })
  delayMs?: number;
}

export class ResponseCaseDto extends MockResponseDto {
  @ApiPropertyOptional({ example: 'not-found', description: 'Stable id. Derived from the name when left out.' })
  id?: string;

  @ApiPropertyOptional({ example: 'Not found', description: 'Shown in the switch. Defaults to the status name.' })
  name?: string;

  @ApiPropertyOptional({ example: 'When the id does not exist' })
  description?: string;
}

export class ActiveCaseDto {
  @ApiProperty({ example: 'not-found', description: 'Case id or name. Applies at once: no proposal, no review.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  case: string;
}

export class BulkActiveCaseDto extends ActiveCaseDto {
  @ApiProperty({ type: [String], description: 'Endpoints to switch. Those without that case are reported as skipped.' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  endpointIds: string[];
}

export class EndpointInputDto {
  @ApiProperty({ enum: [...HTTP_METHODS], example: 'GET' })
  @Allow()
  method: HttpMethod;

  @ApiProperty({ example: '/users/:id', description: 'Express style. ":name" params and "*name" wildcards.' })
  @Allow()
  path: string;

  @ApiPropertyOptional({ example: 'Get one user' })
  @Allow()
  summary?: string;

  @ApiPropertyOptional()
  @Allow()
  description?: string;

  @ApiPropertyOptional({ type: [String], example: ['users'] })
  @Allow()
  tags?: string[];

  @ApiPropertyOptional({ type: RequestDocDto })
  @Allow()
  request?: RequestDocDto;

  @ApiPropertyOptional({
    type: [ResponseCaseDto],
    description: 'Every answer this endpoint can give. The first one is served until someone switches the case.',
    example: [
      { name: 'Success', status: 200, body: { id: 1, name: 'Sara' } },
      { name: 'Not found', status: 404, body: { error: 'User not found' } },
    ],
  })
  @Allow()
  responses?: ResponseCaseDto[];

  @ApiPropertyOptional({ type: MockResponseDto, description: 'Shorthand for a single case. Use "responses" for more.' })
  @Allow()
  response?: MockResponseDto;
}
