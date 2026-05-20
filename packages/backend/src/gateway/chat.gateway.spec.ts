import { Test, TestingModule } from '@nestjs/testing';
import { ChatGateway } from './chat.gateway';
import { PrismaService } from '../prisma/prisma.service';

describe('ChatGateway', () => {
  let gateway: ChatGateway;

  const mockPrismaService = {
    message: {
      create: jest.fn(),
    },
    approvalRequest: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    auditTrail: {
      create: jest.fn(),
    },
    $transaction: jest.fn((promises: Promise<unknown>[]) => Promise.all(promises)),
  };

  const mockServer = {
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
  };

  const mockClient = {
    id: 'test-client-id',
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGateway,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    gateway = module.get<ChatGateway>(ChatGateway);

    (gateway as any).server = mockServer;

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('join_room', () => {
    it('should join a conversation room', async () => {
      const result = await gateway.handleJoinRoom(
        mockClient as any,
        { conversationId: 'conv-001' },
      );

      expect(mockClient.join).toHaveBeenCalledWith('conversation:conv-001');
      expect(result).toEqual({
        event: 'join_room',
        data: { conversationId: 'conv-001' },
      });
    });

    it('should reject invalid conversationId', async () => {
      const result = await gateway.handleJoinRoom(
        mockClient as any,
        { conversationId: '' },
      );

      expect(mockClient.join).not.toHaveBeenCalled();
      expect(mockClient.emit).toHaveBeenCalledWith('error', {
        code: 'INVALID_CONVERSATION_ID',
        message: 'conversationId is required and must be a string',
      });
      expect(result).toEqual({
        event: 'error',
        data: { code: 'INVALID_CONVERSATION_ID', message: 'conversationId is required and must be a string' },
      });
    });
  });

  describe('leave_room', () => {
    it('should leave a conversation room', async () => {
      const result = await gateway.handleLeaveRoom(
        mockClient as any,
        { conversationId: 'conv-001' },
      );

      expect(mockClient.leave).toHaveBeenCalledWith('conversation:conv-001');
      expect(result).toEqual({
        event: 'leave_room',
        data: { conversationId: 'conv-001' },
      });
    });

    it('should reject invalid conversationId', async () => {
      const result = await gateway.handleLeaveRoom(
        mockClient as any,
        { conversationId: '' },
      );

      expect(mockClient.leave).not.toHaveBeenCalled();
      expect(mockClient.emit).toHaveBeenCalledWith('error', {
        code: 'INVALID_CONVERSATION_ID',
        message: 'conversationId is required and must be a string',
      });
      expect(result).toEqual({
        event: 'error',
        data: { code: 'INVALID_CONVERSATION_ID', message: 'conversationId is required and must be a string' },
      });
    });
  });

  describe('message:send', () => {
    it('should store a user message and emit to the conversation room', async () => {
      const payload = {
        conversationId: 'conv-001',
        content: 'Hello, agents!',
        agentId: 'agent-001',
        messageType: 'text',
      };

      const storedMessage = {
        id: 'msg-001',
        conversationId: 'conv-001',
        role: 'user',
        content: 'Hello, agents!',
        agentId: 'agent-001',
        messageType: 'text',
        parentId: null,
        createdAt: new Date(),
      };

      mockPrismaService.message.create.mockResolvedValue(storedMessage);

      const result = await gateway.handleMessageSend(mockClient as any, payload);

      expect(mockPrismaService.message.create).toHaveBeenCalledWith({
        data: {
          conversationId: 'conv-001',
          role: 'user',
          content: 'Hello, agents!',
          agentId: 'agent-001',
          messageType: 'text',
          parentId: null,
        },
      });

      expect(mockServer.to).toHaveBeenCalledWith('conversation:conv-001');
      expect(mockServer.emit).toHaveBeenCalledWith('message:send', storedMessage);

      expect(result).toEqual({
        event: 'message:send',
        data: storedMessage,
      });
    });

    it('should handle message:send without optional fields', async () => {
      const payload = {
        conversationId: 'conv-002',
        content: 'Hi',
      };

      const storedMessage = {
        id: 'msg-002',
        conversationId: 'conv-002',
        role: 'user',
        content: 'Hi',
        agentId: null,
        messageType: 'text',
        parentId: null,
        createdAt: new Date(),
      };

      mockPrismaService.message.create.mockResolvedValue(storedMessage);

      const result = await gateway.handleMessageSend(mockClient as any, payload);

      expect(mockPrismaService.message.create).toHaveBeenCalledWith({
        data: {
          conversationId: 'conv-002',
          role: 'user',
          content: 'Hi',
          agentId: null,
          messageType: 'text',
          parentId: null,
        },
      });

      expect(result).toEqual({
        event: 'message:send',
        data: storedMessage,
      });
    });

    it('should reject invalid messageType', async () => {
      const payload = {
        conversationId: 'conv-001',
        content: 'test',
        messageType: 'invalid_type',
      };

      const result = await gateway.handleMessageSend(mockClient as any, payload);

      expect(result).toEqual({
        event: 'error',
        data: { code: 'INVALID_MESSAGE_TYPE', message: 'Invalid messageType: invalid_type' },
      });
      expect(mockPrismaService.message.create).not.toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      const payload = {
        conversationId: 'conv-001',
        content: 'test',
      };

      mockPrismaService.message.create.mockRejectedValue(new Error('DB connection failed'));

      const result = await gateway.handleMessageSend(mockClient as any, payload);

      expect(result).toEqual({
        event: 'error',
        data: { code: 'MESSAGE_STORE_FAILED', message: 'DB connection failed' },
      });
      expect(mockClient.emit).toHaveBeenCalledWith('error', {
        code: 'MESSAGE_STORE_FAILED',
        message: 'DB connection failed',
      });
    });
  });

  describe('approval:response', () => {
    it('should approve an approval request and create audit trail', async () => {
      const payload = {
        approvalId: 'approval-001',
        decision: 'approved' as const,
      };

      const existingApproval = {
        id: 'approval-001',
        agentId: 'agent-001',
        conversationId: 'conv-001',
        target: '/etc/passwd',
        operation: 'read_file',
        toolName: 'read_file',
        riskLevel: 'high',
        status: 'pending',
      };

      const updatedApproval = {
        id: 'approval-001',
        status: 'approved',
        userDecision: 'approved',
        resolvedAt: expect.any(Date),
      };

      const auditRecord = {
        id: 'audit-001',
        action: 'approval:approved',
      };

      mockPrismaService.approvalRequest.findUnique.mockResolvedValue(existingApproval);
      mockPrismaService.approvalRequest.update.mockResolvedValue(updatedApproval);
      mockPrismaService.auditTrail.create.mockResolvedValue(auditRecord);
      mockPrismaService.$transaction.mockImplementation((fns: Promise<unknown>[]) =>
        Promise.all(fns),
      );

      const result = await gateway.handleApprovalResponse(mockClient as any, payload);

      expect(mockPrismaService.approvalRequest.findUnique).toHaveBeenCalledWith({
        where: { id: 'approval-001' },
      });

      expect(mockPrismaService.$transaction).toHaveBeenCalled();

      expect(result).toEqual({
        event: 'approval:response',
        data: updatedApproval,
      });
    });

    it('should reject an approval request', async () => {
      const payload = {
        approvalId: 'approval-002',
        decision: 'rejected' as const,
      };

      const existingApproval = {
        id: 'approval-002',
        agentId: 'agent-001',
        conversationId: 'conv-001',
        target: '/tmp/test',
        operation: 'write_file',
        toolName: 'write_file',
        riskLevel: 'medium',
        status: 'pending',
      };

      const updatedApproval = {
        id: 'approval-002',
        status: 'rejected',
        userDecision: 'rejected',
        resolvedAt: expect.any(Date),
      };

      mockPrismaService.approvalRequest.findUnique.mockResolvedValue(existingApproval);
      mockPrismaService.approvalRequest.update.mockResolvedValue(updatedApproval);
      mockPrismaService.auditTrail.create.mockResolvedValue({});
      mockPrismaService.$transaction.mockImplementation((fns: Promise<unknown>[]) =>
        Promise.all(fns),
      );

      const result = await gateway.handleApprovalResponse(mockClient as any, payload);

      expect(result).toEqual({
        event: 'approval:response',
        data: updatedApproval,
      });
    });

    it('should return error if approval request not found', async () => {
      mockPrismaService.approvalRequest.findUnique.mockResolvedValue(null);

      const result = await gateway.handleApprovalResponse(mockClient as any, {
        approvalId: 'nonexistent',
        decision: 'approved',
      });

      expect(result).toEqual({
        event: 'error',
        data: { code: 'APPROVAL_NOT_FOUND', message: 'Approval request nonexistent not found' },
      });
    });

    it('should return error if approval already resolved', async () => {
      mockPrismaService.approvalRequest.findUnique.mockResolvedValue({
        id: 'approval-001',
        status: 'approved',
      });

      const result = await gateway.handleApprovalResponse(mockClient as any, {
        approvalId: 'approval-001',
        decision: 'approved',
      });

      expect(result).toEqual({
        event: 'error',
        data: { code: 'APPROVAL_ALREADY_RESOLVED', message: 'Approval request approval-001 is already approved' },
      });
    });
  });

  describe('emit helper methods', () => {
    it('should emit message:stream to conversation room', () => {
      gateway.emitMessageStream('conv-001', {
        agentId: 'agent-001',
        content: 'Hello world',
        messageId: 'msg-001',
      });

      expect(mockServer.to).toHaveBeenCalledWith('conversation:conv-001');
      expect(mockServer.emit).toHaveBeenCalledWith('message:stream', {
        agentId: 'agent-001',
        content: 'Hello world',
        messageId: 'msg-001',
      });
    });

    it('should emit message:complete to conversation room', () => {
      gateway.emitMessageComplete('conv-001', {
        messageId: 'msg-001',
        agentId: 'agent-001',
        content: 'Full reply',
        messageType: 'text',
      });

      expect(mockServer.to).toHaveBeenCalledWith('conversation:conv-001');
      expect(mockServer.emit).toHaveBeenCalledWith('message:complete', {
        messageId: 'msg-001',
        agentId: 'agent-001',
        content: 'Full reply',
        messageType: 'text',
      });
    });

    it('should emit agent:thinking to conversation room', () => {
      gateway.emitAgentThinking('conv-001', {
        agentId: 'agent-001',
        content: 'thinking...',
      });

      expect(mockServer.to).toHaveBeenCalledWith('conversation:conv-001');
      expect(mockServer.emit).toHaveBeenCalledWith('agent:thinking', {
        agentId: 'agent-001',
        content: 'thinking...',
      });
    });

    it('should emit tool:start to conversation room', () => {
      gateway.emitToolStart('conv-001', {
        agentId: 'agent-001',
        toolName: 'read_file',
        input: { path: '/tmp/test.txt' },
      });

      expect(mockServer.to).toHaveBeenCalledWith('conversation:conv-001');
      expect(mockServer.emit).toHaveBeenCalledWith('tool:start', {
        agentId: 'agent-001',
        toolName: 'read_file',
        input: { path: '/tmp/test.txt' },
      });
    });

    it('should emit tool:end to conversation room', () => {
      gateway.emitToolEnd('conv-001', {
        agentId: 'agent-001',
        toolName: 'read_file',
        result: 'file content',
      });

      expect(mockServer.to).toHaveBeenCalledWith('conversation:conv-001');
      expect(mockServer.emit).toHaveBeenCalledWith('tool:end', {
        agentId: 'agent-001',
        toolName: 'read_file',
        result: 'file content',
      });
    });

    it('should emit approval:request to conversation room', () => {
      gateway.emitApprovalRequest('conv-001', {
        approvalId: 'approval-001',
        agentId: 'agent-001',
        target: '/etc/passwd',
        operation: 'read_file',
        toolName: 'read_file',
        reason: 'Agent needs to read the file',
        riskLevel: 'high',
      });

      expect(mockServer.to).toHaveBeenCalledWith('conversation:conv-001');
      expect(mockServer.emit).toHaveBeenCalledWith('approval:request', {
        approvalId: 'approval-001',
        agentId: 'agent-001',
        target: '/etc/passwd',
        operation: 'read_file',
        toolName: 'read_file',
        reason: 'Agent needs to read the file',
        riskLevel: 'high',
      });
    });

    it('should emit error to conversation room when conversationId is provided', () => {
      gateway.emitError('conv-001', {
        code: 'ERR_001',
        message: 'Something went wrong',
      });

      expect(mockServer.to).toHaveBeenCalledWith('conversation:conv-001');
      expect(mockServer.emit).toHaveBeenCalledWith('error', {
        code: 'ERR_001',
        message: 'Something went wrong',
      });
    });

    it('should emit error globally when conversationId is null', () => {
      gateway.emitError(null, {
        code: 'ERR_GLOBAL',
        message: 'Global error',
      });

      expect(mockServer.emit).toHaveBeenCalledWith('error', {
        code: 'ERR_GLOBAL',
        message: 'Global error',
      });
    });

    it('should emit dream:status globally', () => {
      gateway.emitDreamStatus({
        agentId: 'agent-001',
        status: 'running',
        stage: 'light_sleep',
        message: 'Starting dream cycle',
      });

      expect(mockServer.emit).toHaveBeenCalledWith('dream:status', {
        agentId: 'agent-001',
        status: 'running',
        stage: 'light_sleep',
        message: 'Starting dream cycle',
      });
    });

    it('should emit ace:status globally', () => {
      gateway.emitAceStatus({
        agentId: 'agent-001',
        status: 'running',
        stage: 'generator',
        message: 'Generating strategy cards',
      });

      expect(mockServer.emit).toHaveBeenCalledWith('ace:status', {
        agentId: 'agent-001',
        status: 'running',
        stage: 'generator',
        message: 'Generating strategy cards',
      });
    });
  });
});
