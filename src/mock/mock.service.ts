import { Inject, Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { API_BASE, HUB_BASE, MOCK_CASE_HEADER, MOCK_CASE_QUERY, MOCK_DOCS_PATH, MOCK_HEADER } from '../constants';
import { activeCase, findCase } from '../endpoints/route-rules';
import { RegistryService } from './registry.service';

const firstQuery = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined;

/** Express middleware that answers every non-hub request from the live endpoint set. */
@Injectable()
export class MockService {
  constructor(
    private readonly registry: RegistryService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  readonly handle = (req: Request, res: Response, next: NextFunction): void => {
    const path = req.path;
    if (path === HUB_BASE || path.startsWith(HUB_BASE + '/')) return next();

    if (this.config.mockApiKey && req.get('x-mock-key') !== this.config.mockApiKey) {
      res.status(401).json({ error: 'Missing or invalid x-mock-key header' });
      return;
    }

    const hit =
      this.registry.match(req.method, path) ?? (req.method === 'HEAD' ? this.registry.match('GET', path) : null);
    if (!hit) {
      res.status(404).json({
        error: 'No mock endpoint for this route',
        method: req.method,
        path,
        create: `${HUB_BASE}/#/endpoints/new?method=${encodeURIComponent(req.method)}&path=${encodeURIComponent(path)}`,
        browse: MOCK_DOCS_PATH,
        propose: `POST /${API_BASE}/proposals`,
      });
      return;
    }

    const { endpoint } = hit;
    // One call can ask for another case without changing what everyone else gets.
    const wanted = req.get(MOCK_CASE_HEADER) ?? firstQuery(req.query[MOCK_CASE_QUERY]);
    const r = wanted ? findCase(endpoint.responses, wanted) : activeCase(endpoint);
    if (!r) {
      res.status(400).json({
        error: `Unknown response case "${wanted}"`,
        cases: endpoint.responses.map((c) => ({ id: c.id, name: c.name, status: c.status })),
        hint: `Send ${MOCK_CASE_HEADER}: <id> or ?${MOCK_CASE_QUERY}=<id>, or drop it to get the selected case`,
      });
      return;
    }
    const send = () => {
      if (res.headersSent || res.destroyed) return;
      res.status(r.status);
      res.setHeader(MOCK_HEADER, `${endpoint.id}@v${endpoint.version}`);
      res.setHeader(MOCK_CASE_HEADER, r.id);
      for (const [k, v] of Object.entries(r.headers ?? {})) res.setHeader(k, v);
      if (r.body === undefined || r.body === null || r.status === 204 || r.status === 304) {
        res.end();
        return;
      }
      const type = String(res.getHeader('content-type') ?? '');
      if (typeof r.body === 'string' && type && !type.includes('json')) {
        res.send(r.body);
        return;
      }
      res.json(r.body);
    };
    if (r.delayMs) setTimeout(send, r.delayMs);
    else send();
  };
}
