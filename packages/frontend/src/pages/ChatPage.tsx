import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button, Card, Spin, Tag, Typography, Space, Empty } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { Markdown } from "@lobehub/ui";
import { ChatItem, ChatInputArea } from "@lobehub/ui/chat";
import type { MetaData } from "@lobehub/ui";
import { io, Socket } from "socket.io-client";
import { useConversation } from "@/api/conversations";
import { useGroup } from "@/api/groups";

const { Text } = Typography;

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
  const { data: group } = useGroup(id);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [connected, setConnected] = useState(false);
  const [agentThinking, setAgentThinking] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingAgentId, setStreamingAgentId] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

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
  }, [id]);

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
          <Tag color="blue">
            {group.orchestrationMode === "parallel" ? "自由发言" : "按需发言"}
          </Tag>
        )}
        <Space style={{ marginLeft: "auto" }}>
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

      {/* Group Info */}
      {group && (
        <Card size="small" style={{ marginTop: 12, flexShrink: 0 }} title="群组信息">
          <Space wrap>
            <Text>模式: {group.orchestrationMode === "parallel" ? "自由发言" : "按需发言"}</Text>
            <Text>动态讨论: {group.dynamicDiscussionEnabled ? "开启" : "关闭"}</Text>
            {group.supervisorAgentId && (
              <Text>主管: {group.supervisorAgentId}</Text>
            )}
          </Space>
        </Card>
      )}
    </div>
  );
}
