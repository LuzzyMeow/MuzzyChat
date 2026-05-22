import { Controller, Post, Param, Body, Logger, NotFoundException } from '@nestjs/common';
import { AgentRecruitService } from './agent-recruit.service';
import { ParallelOrchestrator } from './parallel-orchestrator.service';
import { PrismaService } from '../prisma/prisma.service';

// ── DTOs ─────────────────────────────────────────────────────

interface RecruitDto {
  description: string;
  orchestrationMode?: 'parallel' | 'supervisor';
  dynamicDiscussionEnabled?: boolean;
}

interface ParseDto {
  description: string;
}

@Controller()
export class OrchestrationController {
  private readonly logger = new Logger(OrchestrationController.name);

  constructor(
    private readonly agentRecruitService: AgentRecruitService,
    private readonly parallelOrchestrator: ParallelOrchestrator,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 一句话招募创建新群组 (02-群聊设计 §5.2)
   * POST /api/recruit
   */
  @Post('api/recruit')
  async recruit(@Body() dto: RecruitDto) {
    const result = await this.agentRecruitService.parse(dto.description);
    if (!result) {
      return {
        success: false,
        message: '自动解析失败，请手动配置',
      };
    }

    return {
      success: true,
      data: result,
    };
  }

  /**
   * 解析自然语言描述 (用于已有群组追加 Agent) (02-群聊设计 §5.4)
   * POST /api/groups/:groupId/agents/parse
   */
  @Post('api/groups/:groupId/agents/parse')
  async parseAgents(
    @Param('groupId') groupId: string,
    @Body() dto: ParseDto,
  ) {
    // Validate group exists and is not deleted
    const group = await this.prisma.chatGroup.findFirst({
      where: { id: groupId, deletedAt: null },
    });
    if (!group) {
      throw new NotFoundException(`群组 ${groupId} 不存在`);
    }

    const result = await this.agentRecruitService.parse(dto.description);
    if (!result) {
      return {
        success: false,
        message: '自动解析失败，请手动配置',
      };
    }

    // 仅返回 agents[], 忽略 group_name (02-群聊设计 §5.4.1)
    return {
      success: true,
      data: result.agents,
    };
  }

  /**
   * 批量创建 Agent 并加入群组
   * POST /api/groups/:groupId/agents/batch
   */
  @Post('api/groups/:groupId/agents/batch')
  async batchAddAgents(
    @Param('groupId') groupId: string,
    @Body() dto: { agents: { name: string; avatarStyle: string; profession: string; personality: string; background: string; scenario: string }[] },
  ) {
    // Validate group exists and is not deleted
    const group = await this.prisma.chatGroup.findFirst({
      where: { id: groupId, deletedAt: null },
    });
    if (!group) {
      throw new NotFoundException(`群组 ${groupId} 不存在`);
    }

    const created = await this.agentRecruitService.createAgentsForGroup(
      groupId,
      dto.agents,
    );

    return {
      success: true,
      agents: created,
    };
  }
}
