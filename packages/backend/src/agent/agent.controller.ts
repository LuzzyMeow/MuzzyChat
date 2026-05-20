import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { AgentService } from './agent.service';
import { CreateAgentDto, UpdateAgentDto } from './dto';

@Controller('agents')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Get()
  async findAll() {
    return this.agentService.findAll();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    const agent = await this.agentService.findById(id);
    if (!agent) {
      throw new NotFoundException(`Agent ${id} not found`);
    }
    return agent;
  }

  @Post()
  async create(@Body() dto: CreateAgentDto) {
    return this.agentService.create(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateAgentDto) {
    const agent = await this.agentService.update(id, dto);
    if (!agent) {
      throw new NotFoundException(`Agent ${id} not found`);
    }
    return agent;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const agent = await this.agentService.remove(id);
    if (!agent) {
      throw new NotFoundException(`Agent ${id} not found`);
    }
    return agent;
  }
}