import { Global, Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { APP_CONFIG, loadConfig } from './config/app-config';
import { EndpointsController } from './endpoints/endpoints.controller';
import { ImportController, ImportService } from './import/import.controller';
import { MockService } from './mock/mock.service';
import { RegistryService } from './mock/registry.service';
import { HubController } from './openapi/hub.controller';
import { CommitsController } from './proposals/commits.controller';
import { ProposalsController } from './proposals/proposals.controller';
import { ProposalsService } from './proposals/proposals.service';
import { SettingsController } from './proposals/settings.controller';
import { StoreService } from './storage/store.service';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }, StoreService, RegistryService, MockService],
  exports: [APP_CONFIG, StoreService, RegistryService, MockService],
})
export class CoreModule {}

@Module({
  controllers: [
    HubController,
    EndpointsController,
    ProposalsController,
    CommitsController,
    SettingsController,
    ImportController,
  ],
  providers: [ProposalsService, ImportService],
})
export class HubModule {}

@Module({
  imports: [CoreModule, AuthModule, HubModule],
})
export class AppModule {}
