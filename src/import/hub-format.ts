import { isPlainObject } from '../common/json-utils';
import { EndpointContent, Layer, Project } from '../storage/models';

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

/** How a project travels in an export: portable keys, never instance ids. */
export interface DeclaredProject {
  key: string;
  name?: string;
  description?: string;
  basePath?: string;
  layers?: { key: string; name?: string; description?: string; basePath?: string }[];
}

/** Projects and layers declared by an import file, so a round-trip restores the structure. */
export function extractHubProjects(data: unknown): DeclaredProject[] {
  if (!isPlainObject(data) || !Array.isArray(data.projects)) return [];
  return data.projects.filter(isPlainObject).flatMap((p): DeclaredProject[] => {
    const key = typeof p.key === 'string' ? p.key.trim() : '';
    if (!key) return [];
    const layers = Array.isArray(p.layers)
      ? p.layers.filter(isPlainObject).flatMap((l) => {
          const lkey = typeof l.key === 'string' ? l.key.trim() : '';
          if (!lkey) return [];
          return [
            {
              key: lkey,
              name: typeof l.name === 'string' ? l.name : undefined,
              description: typeof l.description === 'string' ? l.description : undefined,
              basePath: typeof l.basePath === 'string' ? l.basePath : undefined,
            },
          ];
        })
      : undefined;
    return [
      {
        key,
        name: typeof p.name === 'string' ? p.name : undefined,
        description: typeof p.description === 'string' ? p.description : undefined,
        basePath: typeof p.basePath === 'string' ? p.basePath : undefined,
        layers,
      },
    ];
  });
}

export function buildHubExport(
  endpoints: EndpointContent[],
  commitId: number,
  scope?: { projects: Project[]; layers: Layer[] },
) {
  const byId = new Map((scope?.projects ?? []).map((p) => [p.id, p]));
  const layerById = new Map((scope?.layers ?? []).map((l) => [l.id, l]));
  const used = new Set<string>();
  const items = endpoints.map((e) => {
    const { projectId, layerId, ...rest } = e;
    const project = projectId ? byId.get(projectId) : undefined;
    const layer = layerId ? layerById.get(layerId) : undefined;
    if (project) used.add(project.id);
    return {
      ...rest,
      ...(project ? { project: project.key } : {}),
      ...(layer ? { layer: layer.key } : {}),
    };
  });
  const projects: DeclaredProject[] = (scope?.projects ?? [])
    .filter((p) => used.has(p.id))
    .map((p) => ({
      key: p.key,
      name: p.name,
      description: p.description,
      basePath: p.basePath,
      layers: (scope?.layers ?? [])
        .filter((l) => l.projectId === p.id)
        .map((l) => ({ key: l.key, name: l.name, description: l.description, basePath: l.basePath })),
    }));
  return {
    format: HUB_FORMAT,
    exportedAt: new Date().toISOString(),
    commit: commitId,
    ...(projects.length ? { projects } : {}),
    endpoints: items,
  };
}
