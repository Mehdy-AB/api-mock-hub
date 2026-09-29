import { Injectable, Logger } from '@nestjs/common';
import { match, MatchFunction } from 'path-to-regexp';
import { compareSpecificity, PathIndex } from '../endpoints/route-rules';
import { Endpoint } from '../storage/models';
import { StoreService } from '../storage/store.service';

type Params = Partial<Record<string, string | string[]>>;

interface CompiledRoute {
  endpoint: Endpoint;
  /** Project and layer prefixes included. */
  fullPath: string;
  matcher: MatchFunction<Params>;
}

export interface RouteHit {
  endpoint: Endpoint;
  fullPath: string;
  params: Params;
}

/** Compiled route table of the live endpoints. Rebuilt lazily whenever the endpoint set changes. */
@Injectable()
export class RegistryService {
  private readonly logger = new Logger('Registry');
  private routes: CompiledRoute[] = [];
  private builtFor = -1;

  constructor(private readonly store: StoreService) {}

  match(method: string, path: string): RouteHit | null {
    this.ensureBuilt();
    for (const r of this.routes) {
      if (r.endpoint.method !== method) continue;
      let m: ReturnType<MatchFunction<Params>>;
      try {
        m = r.matcher(path);
      } catch {
        return null; // malformed percent-encoding in the request path
      }
      if (m) return { endpoint: r.endpoint, fullPath: r.fullPath, params: m.params };
    }
    return null;
  }

  private ensureBuilt(): void {
    const revision = this.store.endpointsRevision;
    if (revision === this.builtFor) return;
    const db = this.store.db;
    const paths = new PathIndex(db.projects, db.layers);
    const withPath = db.endpoints.map((endpoint) => ({ endpoint, fullPath: paths.full(endpoint) }));
    const sorted = withPath.sort(
      (a, b) => compareSpecificity(a.fullPath, b.fullPath) || a.fullPath.localeCompare(b.fullPath),
    );
    const routes: CompiledRoute[] = [];
    for (const { endpoint, fullPath } of sorted) {
      try {
        routes.push({ endpoint, fullPath, matcher: match<Params>(fullPath) });
      } catch (e) {
        this.logger.error(`Skipping ${endpoint.method} ${fullPath}: ${e.message}`);
      }
    }
    this.routes = routes;
    this.builtFor = revision;
  }
}
