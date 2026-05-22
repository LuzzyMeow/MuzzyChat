import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { existsSync } from 'fs';
import * as path from 'path';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { GatewayModule } from './gateway/gateway.module';
import { AgentModule } from './agent/agent.module';
import { LlmModule } from './llm/llm.module';
import { ConversationModule } from './conversation/conversation.module';
import { ChatGroupModule } from './chat-group/chat-group.module';
import { AgentLoopModule } from './agent-loop/agent-loop.module';
import { ModelProviderModule } from './model-provider/model-provider.module';
import { SettingsModule } from './settings/settings.module';
import { OrchestrationModule } from './orchestration/orchestration.module';
import { SecurityModule } from './security/security.module';
import { AceModule } from './ace/ace.module';
import { EventEmitterModule } from '@nestjs/event-emitter';

/**
 * Walk up from startDir to find the monorepo root containing `.env`.
 * Handles both dev (__dirname = packages/backend/src) and compiled
 * (__dirname = packages/backend/dist/src) modes.
 */
function findEnvPath(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const envPath = path.join(dir, '.env');
    if (existsSync(envPath)) return envPath;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Could not locate .env file. Ensure .env exists at the project root.',
  );
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: findEnvPath(__dirname),
    }),
    PrismaModule,
    GatewayModule,
    AgentModule,
    LlmModule,
    ConversationModule,
    ChatGroupModule,
    AgentLoopModule,
    ModelProviderModule,
    SettingsModule,
    OrchestrationModule,
    SecurityModule,
    AceModule,
    EventEmitterModule.forRoot(),
  ],
  controllers: [AppController],
})
export class AppModule {}