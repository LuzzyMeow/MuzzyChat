import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button, Card, Spin, Tag, Typography, Space, Empty, Drawer, List, Avatar, Select, Divider, message, Popconfirm, Switch, Input, Dropdown } from "antd";
import { ArrowLeftOutlined, TeamOutlined, UserAddOutlined, DeleteOutlined, UserOutlined, SwapOutlined, RobotOutlined } from "@ant-design/icons";
import { Markdown } from "@lobehub/ui";
import { ChatItem, ChatInputArea } from "@lobehub/ui/chat";
import type { MetaData } from "@lobehub/ui";
import { io, Socket } from "socket.io-client";
import { useConversation } from "@/api/conversations";
import { useGroup, useGroupMembers, updateGroup } from "@/api/groups";
import { addMember, removeMember } from "@/api/groups";
import { useAgents } from "@/api/agents";
import { TaskBoard, useTaskBoard } from "@/components/TaskBoard";
import { post } from "@/api/client";

const { Text } = Typography;
const { TextArea } = Input;

interface ChatMessage {
  id?: string;
  role: string;
  content: string;
  agentId?: string;
  agentName?: string;
  timestamp: string;
}

let msgCounter = 0;
function genMsgId() {
  return `msg-${++msgCounter}-${Date.now()}`;
}

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: conversation, isLoading: convLoading } = useConversation(id);
  const { data: group, mutate: mutateGroup } = useGroup(id);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [connected, setConnected] = useState(false);
  const [agentThinking, setAgentThinking] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingAgentId, setStreamingAgentId] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // TaskBoard (Supervisor mode)
  const { tasks, completedCount } = useTaskBoard(socketRef);

  // Member management
  const [memberDrawerOpen, setMemberDrawerOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [addingMember, setAddingMember] = useState(false);
  const [recruitInput, setRecruitInput] = useState("");
  const [recruiting, setRecruiting] = useState(false);
  const { data: members, isLoading: membersLoading, mutate: mutateMembers } = useGroupMembers(group?.id);
  const { data: allAgents } = useAgents();

  const handleAddMember = useCallback(async () => {
    if (!group?.id || !selectedAgentId) return;
    setAddingMember(true);
    try {
      await addMember(group.id, selectedAgentId);
      message.success("成员已添加");
      setSelectedAgentId(null);
      mutateMembers();
    } catch (err) {
      message.error(String(err));
    } finally {
      setAddingMember(false);
    }
  }, [group?.id, selectedAgentId, mutateMembers]);

  const handleRecruitMembers = useCallback(async () => {
    if (!group?.id || !recruitInput.trim()) return;
    setRecruiting(true);
    try {
      const res = await post<{ success: boolean; data: { name: string; avatarStyle: string; profession: string; personality: string; background: string; scenario: string }[]; message?: string }>(
        `/api/groups/${group.id}/agents/parse`,
        { description: recruitInput.trim() },
      );

      if (res.success && res.data) {
        // Batch create agents for group
        await post<{ agents: { agentId: string; name: string }[] }>(
          `/api/groups/${group.id}/agents/batch`,
          { agents: res.data },
        );
        message.success(`已添加 ${res.data.length} 个成员`);
        setRecruitInput("");
        mutateMembers();
        mutateGroup();
      } else {
        message.warning(res.message ?? "解析失败，请手动选择 Agent");
      }
    } catch (err) {
      message.error(String(err));
    } finally {
      setRecruiting(false);
    }
  }, [group?.id, recruitInput, mutateMembers, mutateGroup]);

  const handleRemoveMember = useCallback(
    async (agentId: string) => {
      if (!group?.id) return;
      try {
        await removeMember(group.id, agentId);
        message.success("成员已移除");
        mutateMembers();
      } catch (err) {
        message.error(String(err));
      }
    },
    [group?.id, mutateMembers],
  );

  // Build member list with agent names
  const memberList = (members ?? []).map((m) => ({
    ...m,
    agentName: m.agent?.name ?? m.agentId,
  }));

  // Agent options for adding new members (exclude existing members)
  const existingAgentIds = new Set((members ?? []).map((m) => m.agentId));
  const addableAgents = (allAgents ?? []).filter((a) => !existingAgentIds.has(a.id));

  // Mode switching
  const handleSwitchMode = useCallback(async () => {
    if (!group?.id) return;
    const newMode = group.orchestrationMode === "parallel" ? "supervisor" : "parallel";
    try {
      await updateGroup(group.id, { orchestrationMode: newMode });
      message.success(`已切换为${newMode === "parallel" ? "自由发言" : "按需发言"}模式`);
      mutateGroup();
    } catch (err) {
      message.error(String(err));
    }
  }, [group, mutateGroup]);

  // Dynamic discussion toggle
  const handleToggleDynamicDiscussion = useCallback(async (checked: boolean) => {
    if (!group?.id) return;
    try {
      await updateGroup(group.id, { dynamicDiscussionEnabled: checked });
      mutateGroup();
    } catch (err) {
      message.error(String(err));
    }
  }, [group?.id, mutateGroup]);

  useEffect(() => {
    if (!id) return;

    const socket = io("/chat", {
      path: "/socket.io",
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join_room", { conversationId: id });
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on("message:complete", (payload: { message: ChatMessage }) => {
      setStreamingContent("");
      setStreamingAgentId(null);
      setMessages((prev) => [...prev, payload.message]);
    });

    socket.on("message:stream", (payload: { content: string; agentId: string }) => {
      setStreamingContent(payload.content);
      setStreamingAgentId(payload.agentId);
    });

    socket.on("agent:thinking", (payload?: { content?: string }) => {
      setAgentThinking(payload?.content !== undefined);
    });

    // Phase 3: group:member_joined event
    socket.on("group:member_joined", (payload: { agentId: string; agentName: string }) => {
      setMessages((prev) => [
        ...prev,
        {
          id: genMsgId(),
          role: "system",
          content: `${payload.agentName} 加入了群聊`,
          timestamp: new Date().toISOString(),
        },
      ]);
      mutateMembers();
    });

    socket.on("error", (payload: { message: string }) => {
      setMessages((prev) => [
        ...prev,
        {
          id: genMsgId(),
          role: "system",
          content: `错误: ${payload.message}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    });

    socketRef.current = socket;

    return () => {
      socket.emit("leave_room", { conversationId: id });
      socket.disconnect();
    };
  }, [id, mutateMembers]);

  const handleSend = () => {
    const content = inputValue.trim();
    if (!content || !socketRef.current || !id) return;

    setMessages((prev) => [
      ...prev,
      { id: genMsgId(), role: "user", content, timestamp: new Date().toISOString() },
    ]);
    setInputValue("");

    socketRef.current.emit("message:send", {
      conversationId: id,
      content,
      messageType: "text",
    });
  };

  const title = group?.name ?? conversation?.title ?? "聊天";

  // Build all display messages: persisted + streaming placeholder
  const displayMessages = [...messages];
  if (streamingContent && streamingAgentId) {
    displayMessages.push({
      id: "streaming",
      role: "assistant",
      content: streamingContent,
      agentId: streamingAgentId,
      timestamp: new Date().toISOString(),
    });
  }

  const messageListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [displayMessages.length, streamingContent]);

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", display: "flex", flexDirection: "column", height: "calc(100vh - 48px)" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 0",
          flexShrink: 0,
        }}
      >
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate("/")}
        />
        <h2 style={{ margin: 0 }}>{title}</h2>
        {group && (
          <>
            <Tag color={group.orchestrationMode === "parallel" ? "blue" : "purple"}>
              {group.orchestrationMode === "parallel" ? "自由发言" : "按需发言"}
            </Tag>
            <Dropdown
              menu={{
                items: [
                  {
                    key: "toggle",
                    label: `切换为${group.orchestrationMode === "parallel" ? "按需发言 (Supervisor)" : "自由发言 (Parallel)"}`,
                    icon: <SwapOutlined />,
                    onClick: handleSwitchMode,
                  },
                ],
              }}
            >
              <Button size="small" icon={<SwapOutlined />}>切换模式</Button>
            </Dropdown>
          </>
        )}
        <Space style={{ marginLeft: "auto" }}>
          {group && (
            <Button
              icon={<TeamOutlined />}
              onClick={() => setMemberDrawerOpen(true)}
            >
              成员 ({memberList.length})
            </Button>
          )}
          <Tag color={connected ? "green" : "red"}>
            {connected ? "已连接" : "未连接"}
          </Tag>
          {agentThinking && (
            <Tag color="orange">思考中...</Tag>
          )}
        </Space>
      </div>

      {/* Messages */}
      <Card
        styles={{ body: { padding: 0 } }}
        style={{ flex: 1, marginBottom: 12, overflow: "hidden", display: "flex", flexDirection: "column" }}
      >
        <div
          ref={messageListRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px 16px",
          }}
        >
          {convLoading ? (
            <div style={{ textAlign: "center", padding: 60 }}>
              <Spin />
            </div>
          ) : displayMessages.length === 0 ? (
            <Empty
              description="暂无消息，发送第一条消息开始对话"
              style={{ marginTop: 80 }}
            />
          ) : (
            displayMessages.map((msg) => (
              <ChatItem
                key={msg.id ?? msg.timestamp}
                avatar={
                  msg.role === "assistant"
                    ? ({
                        avatar: "🤖",
                        title: msg.agentName ?? "Agent",
                        backgroundColor: "#1677ff",
                      } satisfies MetaData)
                    : ({
                        avatar: "👤",
                        title: "你",
                        backgroundColor: "#52c41a",
                      } satisfies MetaData)
                }
                placement={msg.role === "user" ? "right" : "left"}
                showTitle={msg.role === "assistant"}
                time={new Date(msg.timestamp).getTime()}
                loading={msg.id === "streaming"}
                message={
                  msg.role === "assistant" ? (
                    <Markdown style={{ fontSize: 14 }}>{msg.content}</Markdown>
                  ) : msg.role === "system" ? (
                    <Text type="secondary" style={{ fontSize: 13, fontStyle: "italic" }}>{msg.content}</Text>
                  ) : (
                    <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 14, color: "#fff" }}>
                      {msg.content}
                    </div>
                  )
                }
              />
            ))
          )}
        </div>
      </Card>

      {/* Input */}
      <div style={{ flexShrink: 0 }}>
        <ChatInputArea
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          onInput={(val) => setInputValue(val)}
          onSend={handleSend}
          loading={agentThinking}
          style={{ width: "100%" }}
        />
      </div>

      {/* TaskBoard (Supervisor mode only) */}
      {group?.orchestrationMode === "supervisor" && (
        <TaskBoard tasks={tasks} completedCount={completedCount} />
      )}

      {/* Group Info */}
      {group && (
        <Card size="small" style={{ marginTop: 12, flexShrink: 0 }} title="群组信息">
          <Space wrap>
            <Text>模式: {group.orchestrationMode === "parallel" ? "自由发言" : "按需发言"}</Text>
            <Space>
              <Text>动态讨论:</Text>
              <Switch
                size="small"
                checked={group.dynamicDiscussionEnabled}
                onChange={handleToggleDynamicDiscussion}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {group.dynamicDiscussionEnabled ? "已开启" : "已关闭"}
              </Text>
            </Space>
            {group.supervisorAgentId && (
              <Text>
                <RobotOutlined /> 主管: {group.supervisorAgentId}
              </Text>
            )}
          </Space>
        </Card>
      )}

      {/* Member Management Drawer */}
      <Drawer
        title={`群组成员 (${memberList.length})`}
        open={memberDrawerOpen}
        onClose={() => setMemberDrawerOpen(false)}
        width={420}
        extra={
          <Button
            type="primary"
            icon={<UserAddOutlined />}
            loading={addingMember}
            disabled={!selectedAgentId}
            onClick={handleAddMember}
          >
            添加
          </Button>
        }
      >
        {/* Natural language recruit */}
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: "block", marginBottom: 8 }}>
            <RobotOutlined /> 自然语言添加成员
          </Text>
          <TextArea
            style={{ width: "100%", marginBottom: 8 }}
            placeholder='例如："帮我添加一个擅长写文案的Agent"'
            value={recruitInput}
            onChange={(e) => setRecruitInput(e.target.value)}
            rows={2}
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
          <Button
            type="dashed"
            icon={<RobotOutlined />}
            loading={recruiting}
            disabled={!recruitInput.trim()}
            onClick={handleRecruitMembers}
            block
          >
            智能添加
          </Button>
        </div>

        <Divider>或手动选择</Divider>

        {/* Manual select */}
        <div style={{ marginBottom: 16 }}>
          <Select
            style={{ width: "100%" }}
            placeholder="选择 Agent..."
            value={selectedAgentId}
            onChange={setSelectedAgentId}
            options={addableAgents.map((a) => ({
              value: a.id,
              label: a.name,
            }))}
            showSearch
            optionFilterProp="label"
            notFoundContent={addableAgents.length === 0 ? "所有 Agent 已在群组中" : undefined}
          />
        </div>

        <Divider />

        {/* Member list */}
        {membersLoading ? (
          <div style={{ textAlign: "center", padding: 40 }}><Spin /></div>
        ) : memberList.length === 0 ? (
          <Empty description="暂无成员" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <List
            dataSource={memberList}
            renderItem={(member) => (
              <List.Item
                actions={[
                  <Popconfirm
                    key="remove"
                    title="确定移除此成员？"
                    onConfirm={() => handleRemoveMember(member.agentId)}
                  >
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      type="text"
                    />
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  avatar={
                    <Avatar icon={<UserOutlined />} style={{ backgroundColor: "#1677ff" }} />
                  }
                  title={member.agentName}
                  description={
                    <Space size={4}>
                      <Tag color={member.enabled ? "green" : "default"}>
                        {member.enabled ? "已启用" : "已禁用"}
                      </Tag>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {new Date(member.joinedAt).toLocaleDateString("zh-CN")}
                      </Text>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Drawer>
    </div>
  );
}
