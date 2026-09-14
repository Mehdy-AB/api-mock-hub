import { Injectable, Logger } from '@nestjs/common';
import { match, MatchFunction } from 'path-to-regexp';
import { compareSpecificity } from '../endpoints/route-rules';
import { Endpoint } from '../storage/models';
import { StoreService } from '../storage/store.service';

type Params = Partial<Record<string, string | string[]>>;

interface CompiledRoute {
  endpoint: Endpoint;
  matcher: MatchFunction<Params>;
}

export interface RouteHit {
  endpoint: Endpoint;
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
      if (m) return { endpoint: r.endpoint, params: m.params };
    }
    return null;
  }

  private ensureBuilt(): void {
    const revision = this.store.endpointsRevision;
    if (revision === this.builtFor) return;
    const sorted = [...this.store.db.endpoints].sort(
      (a, b) => compareSpecificity(a.path, b.path) || a.path.localeCompare(b.path),
    );
    const routes: CompiledRoute[] = [];
    for (const endpoint of sorted) {
      try {
        routes.push({ endpoint, matcher: match<Params>(endpoint.path) });
      } catch (e) {
        this.logger.error(`Skipping ${endpoint.method} ${endpoint.path}: ${e.message}`);
      }
    }
    this.routes = routes;
    this.builtFor = revision;
  }
}
