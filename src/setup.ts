import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { existsSync } from 'fs';
import * as swaggerUi from 'swagger-ui-express';
import { APP_CONFIG, AppConfig } from './config/app-config';
import { HUB_BASE, MGMT_DOCS_PATH, MOCK_DOCS_PATH, MOCK_HEADER, MOCK_OPENAPI_PATH } from './constants';
import { MockService } from './mock/mock.service';

/**
 * Order matters: CORS, then the mock router (before body parsing, so mocks accept any payload),
 * then JSON parsing and docs. Nest controllers are registered after these on app.init().
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<AppConfig>(APP_CONFIG);

  app.disable('x-powered-by');
  app.enableCors({ origin: true, credentials: true, exposedHeaders: [MOCK_HEADER] });
  app.use(app.get(MockService).handle);
  app.useBodyParser('json', { limit: config.bodyLimit });
  // Web UI assets (index.html itself is served by HubController at /_hub).
  // redirect: false keeps "/_hub" from being 301-redirected as a static directory.
  if (existsSync(config.uiDir)) {
    app.useStaticAssets(config.uiDir, { prefix: `${HUB_BASE}/`, index: false, redirect: false });
  }
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const mgmt = new DocumentBuilder()
    .setTitle('API Mock Hub: management API')
    .setDescription(
      [
        '1. `POST /_hub/api/auth/login`, copy the token, click **Authorize**.',
        '2. Propose endpoints with `POST /_hub/api/proposals` or `POST /_hub/api/import`.',
        '3. A teammate reviews with `POST /_hub/api/proposals/{id}/reviews`. Approved changes go live immediately.',
        '',
        `Web UI: [${HUB_BASE}/](${HUB_BASE}/) · Live mocks: [${MOCK_DOCS_PATH}/](${MOCK_DOCS_PATH}/)`,
      ].join('\n'),
    )
    .setVersion('1')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(MGMT_DOCS_PATH, app, SwaggerModule.createDocument(app, mgmt), {
    customSiteTitle: 'Mock Hub: management API',
    swaggerOptions: { persistAuthorization: true },
  });

  // customJsStr is supported by swagger-ui-express 5 but missing from its typings.
  const mockUi: swaggerUi.SwaggerUiOptions & { customJsStr?: string } = {
    customSiteTitle: 'Mock Hub: mock endpoints',
    swaggerOptions: { url: MOCK_OPENAPI_PATH, displayRequestDuration: true, tryItOutEnabled: true },
    // "/_hub/docs/?project=homefit" shows one project. The page is built once, so the spec is swapped in the browser.
    customJsStr: `(function () {
      var project = new URLSearchParams(location.search).get('project');
      if (!project) return;
      var url = '${MOCK_OPENAPI_PATH}?project=' + encodeURIComponent(project);
      var timer = setInterval(function () {
        if (!window.ui || !window.ui.specActions) return;
        clearInterval(timer);
        window.ui.specActions.updateUrl(url);
        window.ui.specActions.download(url);
      }, 30);
    })();`,
  };
  // swagger-ui-express uses relative asset URLs, so the page must be served with a trailing slash.
  const trailingSlash = (req: Request, res: Response, next: NextFunction) => {
    if (req.originalUrl.split('?')[0] === MOCK_DOCS_PATH) return res.redirect(301, `${MOCK_DOCS_PATH}/`);
    next();
  };
  app.use(
    MOCK_DOCS_PATH,
    trailingSlash,
    ...(swaggerUi.serveFiles(undefined, mockUi) as unknown as RequestHandler[]),
    swaggerUi.setup(undefined, mockUi) as unknown as RequestHandler,
  );
}
