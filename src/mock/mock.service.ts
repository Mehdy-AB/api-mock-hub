import { Inject, Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { API_BASE, HUB_BASE, MOCK_DOCS_PATH, MOCK_HEADER } from '../constants';
import { RegistryService } from './registry.service';

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
    const r = endpoint.response;
    const send = () => {
      if (res.headersSent || res.destroyed) return;
      res.status(r.status);
      res.setHeader(MOCK_HEADER, `${endpoint.id}@v${endpoint.version}`);
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
