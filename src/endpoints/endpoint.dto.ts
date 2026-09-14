import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';
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

  @ApiProperty({ type: MockResponseDto })
  @Allow()
  response: MockResponseDto;
}
