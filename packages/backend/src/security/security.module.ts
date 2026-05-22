import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RiskEngineService } from './risk-engine.service';
import { WhitelistService } from './whitelist.service';
import { AuditTrailService } from './audit-trail.service';
import { ApprovalTimeoutService } from './approval-timeout.service';
import { ToolExecutorService } from './tool-executor.service';

@Module({
  imports: [PrismaModule],
  providers: [
    RiskEngineService,
    WhitelistService,
    AuditTrailService,
    ApprovalTimeoutService,
    ToolExecutorService,
  ],
  exports: [
    RiskEngineService,
    WhitelistService,
    AuditTrailService,
    ApprovalTimeoutService,
    ToolExecutorService,
  ],
})
export class SecurityModule {}
