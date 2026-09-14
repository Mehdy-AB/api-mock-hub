import { Controller, Get, Header, Inject, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { existsSync } from 'fs';
import * as path from 'path';
import { Public } from '../auth/decorators';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { API_BASE, MGMT_DOCS_PATH, MOCK_DOCS_PATH, MOCK_OPENAPI_PATH } from '../constants';
import { StoreService } from '../storage/store.service';
import { generateOpenApi } from './openapi-generator';

@Public()
@ApiTags('hub')
@Controller()
export class HubController {
  constructor(
    private readonly store: StoreService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get(MOCK_OPENAPI_PATH.slice(1))
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'OpenAPI 3 document of the live mock endpoints' })
  openapi() {
    return generateOpenApi(this.store.db.endpoints, { commitId: this.store.lastCommitId });
  }

  @Get(`${API_BASE}/health`)
  @ApiOperation({ summary: 'Health check' })
  health() {
    const db = this.store.db;
    return {
      status: 'ok',
      endpoints: db.endpoints.length,
      openProposals: db.proposals.filter((p) => p.status === 'open').length,
      lastCommit: this.store.lastCommitId,
    };
  }

  /** Web UI when built, otherwise a small landing page with links. */
  @Get('_hub')
  @ApiExcludeEndpoint()
  index(@Res() res: Response) {
    const ui = path.join(this.config.uiDir, 'index.html');
    if (existsSync(ui)) {
      res.setHeader('Cache-Control', 'no-cache');
      return res.sendFile(ui);
    }
    const db = this.store.db;
    const open = db.proposals.filter((p) => p.status === 'open' || p.status === 'conflict').length;
    res.type('html').send(`<!doctype html><meta charset="utf-8"><title>API Mock Hub</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px;color:#1f2328}
a{color:#0969da}code{background:#f3f4f6;padding:1px 5px;border-radius:4px}li{margin:6px 0}</style>
<h1>API Mock Hub</h1>
<p>${db.endpoints.length} live endpoints &middot; ${open} open proposals &middot; last commit #${this.store.lastCommitId}</p>
<ul>
<li><a href="${MOCK_DOCS_PATH}/">Mock endpoints</a>: browse and call the live mocks</li>
<li><a href="/${MGMT_DOCS_PATH}">Management API</a>: log in, propose, review, import</li>
<li><a href="${MOCK_OPENAPI_PATH}">openapi.json</a>: OpenAPI 3 of the live mocks</li>
</ul>
<p>The web UI is not built. Run <code>npm run build:ui</code>.</p>`);
  }
}
