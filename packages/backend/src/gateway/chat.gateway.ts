import {
  Logger,
} from '@nestjs/common';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { MessageType } from '../../generated/prisma/enums';

const VALID_MESSAGE_TYPES = new Set<string>(Object.values(MessageType));

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN ?? '*',
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(private readonly prisma: PrismaService) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string },
  ): Promise<{ event: string; data: unknown }> {
    if (!payload.conversationId || typeof payload.conversationId !== 'string') {
      client.emit('error', { code: 'INVALID_CONVERSATION_ID', message: 'conversationId is required and must be a string' });
      return { event: 'error', data: { code: 'INVALID_CONVERSATION_ID', message: 'conversationId is required and must be a string' } };
    }
    const room = `conversation:${payload.conversationId}`;
    client.join(room);
    this.logger.log(`Client ${client.id} joined room ${room}`);
    return { event: 'join_room', data: { conversationId: payload.conversationId } };
  }

  @SubscribeMessage('leave_room')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string },
  ): Promise<{ event: string; data: unknown }> {
    if (!payload.conversationId || typeof payload.conversationId !== 'string') {
      client.emit('error', { code: 'INVALID_CONVERSATION_ID', message: 'conversationId is required and must be a string' });
      return { event: 'error', data: { code: 'INVALID_CONVERSATION_ID', message: 'conversationId is required and must be a string' } };
    }
    const room = `conversation:${payload.conversationId}`;
    client.leave(room);
    this.logger.log(`Client ${client.id} left room ${room}`);
    return { event: 'leave_room', data: { conversationId: payload.conversationId } };
  }

  @SubscribeMessage('message:send')
  async handleMessageSend(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      conversationId: string;
      content: string;
      agentId?: string;
      messageType?: string;
      parentId?: string;
    },
  ): Promise<{ event: string; data: unknown } | { event: string; data: { code: string; message: string } }> {
    this.logger.log(`message:send from conversation ${payload.conversationId}`);

    const messageType = payload.messageType ?? 'text';
    if (!VALID_MESSAGE_TYPES.has(messageType)) {
      this.logger.warn(`Invalid messageType: ${messageType}`);
      return {
        event: 'error',
        data: { code: 'INVALID_MESSAGE_TYPE', message: `Invalid messageType: ${messageType}` },
      };
    }

    try {
      const message = await this.prisma.message.create({
        data: {
          conversationId: payload.conversationId,
          role: 'user',
          content: payload.content,
          agentId: payload.agentId ?? null,
          messageType: messageType as MessageType,
          parentId: payload.parentId ?? null,
        },
      });

      this.server.to(`conversation:${payload.conversationId}`).emit('message:send', message);

      return { event: 'message:send', data: message };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to store message: ${msg}`);
      client.emit('error', { code: 'MESSAGE_STORE_FAILED', message: msg });
      return { event: 'error', data: { code: 'MESSAGE_STORE_FAILED', message: msg } };
    }
  }

  @SubscribeMessage('approval:response')
  async handleApprovalResponse(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      approvalId: string;
      decision: 'approved' | 'rejected';
    },
  ): Promise<{ event: string; data: unknown } | { event: string; data: { code: string; message: string } }> {
    this.logger.log(`approval:response for ${payload.approvalId}: ${payload.decision}`);

    try {
      const existing = await this.prisma.approvalRequest.findUnique({
        where: { id: payload.approvalId },
      });

      if (!existing) {
        return {
          event: 'error',
          data: { code: 'APPROVAL_NOT_FOUND', message: `Approval request ${payload.approvalId} not found` },
        };
      }

      if (existing.status !== 'pending') {
        return {
          event: 'error',
          data: { code: 'APPROVAL_ALREADY_RESOLVED', message: `Approval request ${payload.approvalId} is already ${existing.status}` },
        };
      }

      const status = payload.decision === 'approved' ? 'approved' : 'rejected';

      const [approval] = await this.prisma.$transaction([
        this.prisma.approvalRequest.update({
          where: { id: payload.approvalId },
          data: {
            status,
            userDecision: payload.decision,
            resolvedAt: new Date(),
          },
        }),
        this.prisma.auditTrail.create({
          data: {
            action: `approval:${payload.decision}`,
            agentId: existing.agentId,
            conversationId: existing.conversationId,
            details: {
              approvalId: payload.approvalId,
              target: existing.target,
              operation: existing.operation,
              toolName: existing.toolName,
              riskLevel: existing.riskLevel,
              userDecision: payload.decision,
            },
          },
        }),
      ]);

      return { event: 'approval:response', data: approval };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to process approval: ${msg}`);
      client.emit('error', { code: 'APPROVAL_PROCESS_FAILED', message: msg });
      return { event: 'error', data: { code: 'APPROVAL_PROCESS_FAILED', message: msg } };
    }
  }

  emitMessageStream(conversationId: string, data: {
    agentId?: string;
    content: string;
    messageId?: string;
  }) {
    this.server.to(`conversation:${conversationId}`).emit('message:stream', data);
  }

  emitMessageComplete(conversationId: string, data: {
    messageId: string;
    agentId: string;
    content: string;
    messageType?: string;
  }) {
    this.server.to(`conversation:${conversationId}`).emit('message:complete', data);
  }

  emitAgentThinking(conversationId: string, data: {
    agentId: string;
    content?: string;
  }) {
    this.server.to(`conversation:${conversationId}`).emit('agent:thinking', data);
  }

  emitAgentPeerMessage(conversationId: string, data: {
    fromAgentId: string;
    content: string;
    messageId: string;
  }) {
    this.server.to(`conversation:${conversationId}`).emit('agent:peer_message', data);
  }

  emitToolStart(conversationId: string, data: {
    agentId: string;
    toolName: string;
    input?: unknown;
  }) {
    this.server.to(`conversation:${conversationId}`).emit('tool:start', data);
  }

  emitToolEnd(conversationId: string, data: {
    agentId: string;
    toolName: string;
    result?: unknown;
    error?: string;
  }) {
    this.server.to(`conversation:${conversationId}`).emit('tool:end', data);
  }

  emitToolProgress(conversationId: string, data: {
    agentId: string;
    toolName: string;
    progress: number;
    message?: string;
  }) {
    this.server.to(`conversation:${conversationId}`).emit('tool:progress', data);
  }

  emitApprovalRequest(conversationId: string, data: {
    approvalId: string;
    agentId: string;
    target: string;
    operation: string;
    toolName?: string;
    reason: string;
    riskLevel: string;
  }) {
    this.server.to(`conversation:${conversationId}`).emit('approval:request', data);
  }

  emitTaskUpdate(conversationId: string, data: {
    taskId: string;
    status: string;
    data?: unknown;
  }) {
    this.server.to(`conversation:${conversationId}`).emit('task:update', data);
  }

  emitTaskProgress(conversationId: string, data: {
    taskId: string;
    agentId: string;
    progress: number;
    message?: string;
  }) {
    this.server.to(`conversation:${conversationId}`).emit('task:progress', data);
  }

  emitDreamStatus(data: {
    agentId: string;
    status: string;
    stage?: string;
    message?: string;
  }) {
    this.server.emit('dream:status', data);
  }

  emitAceStatus(data: {
    agentId: string;
    status: string;
    stage?: string;
    message?: string;
  }) {
    this.server.emit('ace:status', data);
  }

  emitGroupMemberJoined(conversationId: string, data: {
    agentId: string;
    agentName: string;
    joinedAt: string;
  }) {
    this.server.to(`conversation:${conversationId}`).emit('group:member_joined', data);
  }

  emitError(conversationId: string | null, data: {
    code: string;
    message: string;
    details?: unknown;
  }) {
    if (conversationId) {
      this.server.to(`conversation:${conversationId}`).emit('error', data);
    } else {
      this.server.emit('error', data);
    }
  }
}
