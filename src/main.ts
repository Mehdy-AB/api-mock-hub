import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config/app-config';
import { loadDotEnv } from './config/env-file';
import { MGMT_DOCS_PATH, MOCK_DOCS_PATH } from './constants';
import { configureApp } from './setup';

async function bootstrap() {
  loadDotEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app);
  app.enableShutdownHooks();

  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.port, config.host);

  const base = `http://localhost:${config.port}`;
  const log = new Logger('Bootstrap');
  log.log(`Mock endpoints     ${base}/<path>`);
  log.log(`Mock Swagger       ${base}${MOCK_DOCS_PATH}/`);
  log.log(`Management Swagger ${base}/${MGMT_DOCS_PATH}`);
}

bootstrap();
