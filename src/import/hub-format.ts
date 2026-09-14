import { isPlainObject } from '../common/json-utils';
import { EndpointContent } from '../storage/models';

export const HUB_FORMAT = 'api-mock-hub';

export type ImportFormat = 'hub' | 'openapi';

export function detectFormat(data: unknown): ImportFormat {
  return isPlainObject(data) && (typeof data.openapi === 'string' || typeof data.swagger === 'string')
    ? 'openapi'
    : 'hub';
}

/** Accepts a hub export, an array of endpoints, or a single endpoint object. */
export function extractHubItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (isPlainObject(data)) {
    if (Array.isArray(data.endpoints)) return data.endpoints;
    if ('method' in data && 'path' in data) return [data];
  }
  throw new Error('Hub import expects { "endpoints": [...] }, an array of endpoints, or a single endpoint object');
}

export function buildHubExport(endpoints: EndpointContent[], commitId: number) {
  return { format: HUB_FORMAT, exportedAt: new Date().toISOString(), commit: commitId, endpoints };
}
