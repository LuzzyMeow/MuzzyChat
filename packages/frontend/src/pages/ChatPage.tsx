import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Input, Button, Card, Spin, Tag, Typography, Space, Empty } from "antd";
import { SendOutlined, ArrowLeftOutlined } from "@ant-design/icons";
import { io, Socket } from "socket.io-client";
import { useConversation } from "@/api/conversations";
import { useGroup } from "@/api/groups";

const { Text } = Typography;

interface ChatMessage {
  role: string;
  content: string;
  agentId?: string;
  agentName?: string;
  timestamp: string;
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
      setMessages((prev) => [...prev, payload.message]);
    });

    socket.on("message:stream", (payload: { content: string; agentId: string }) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && last.agentId === payload.agentId) {
          // Backend uses streamMode:'updates', sending full content each update.
          // Replace last assistant message content instead of appending.
          const updated = { ...last, content: payload.content };
          return [...prev.slice(0, -1), updated];
        }
        return [
          ...prev,
          {
            role: "assistant",
            content: payload.content,
            agentId: payload.agentId,
            timestamp: new Date().toISOString(),
          },
        ];
      });
    });

    socket.on("agent:thinking", (payload?: { content?: string }) => {
      setAgentThinking(payload?.content !== undefined);
    });

    socket.on("error", (payload: { message: string }) => {
      setMessages((prev) => [
        ...prev,
        {
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

    const userMsg: ChatMessage = {
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");

    socketRef.current.emit("message:send", {
      conversationId: id,
      content,
      messageType: "text",
    });
  };

  const title = group?.name ?? conversation?.title ?? "聊天";

  return (
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
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
            <Tag color="orange">Agent 思考中...</Tag>
          )}
        </Space>
      </div>

      <Card
        styles={{ body: { padding: 12 } }}
        style={{ marginBottom: 12 }}
      >
        <div
          style={{
            minHeight: 400,
            maxHeight: "calc(100vh - 280px)",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {convLoading ? (
            <div style={{ textAlign: "center", padding: 60 }}>
              <Spin />
            </div>
          ) : messages.length === 0 ? (
            <Empty
              description="暂无消息，发送第一条消息开始对话"
              style={{ marginTop: 80 }}
            />
          ) : (
            messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  alignSelf:
                    msg.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "80%",
                  background:
                    msg.role === "user"
                      ? "#1677ff"
                      : msg.role === "system"
                        ? "#fff2e8"
                        : "#f5f5f5",
                  color: msg.role === "user" ? "#fff" : undefined,
                  borderRadius: 8,
                  padding: "8px 14px",
                }}
              >
                {msg.role === "assistant" && msg.agentName && (
                  <div>
                    <Text strong style={{ fontSize: 12, color: "#1677ff" }}>
                      {msg.agentName}
                    </Text>
                  </div>
                )}
                <div
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {msg.content}
                </div>
                <Text
                  type="secondary"
                  style={{
                    fontSize: 11,
                    display: "block",
                    marginTop: 4,
                    color: msg.role === "user" ? "rgba(255,255,255,0.7)" : undefined,
                  }}
                >
                  {new Date(msg.timestamp).toLocaleTimeString("zh-CN")}
                </Text>
              </div>
            ))
          )}
        </div>
      </Card>

      <div style={{ display: "flex", gap: 8 }}>
        <Input.TextArea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="输入消息，按 Enter 发送，Shift+Enter 换行"
          rows={2}
          disabled={!connected}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          disabled={!connected || !inputValue.trim()}
        >
          发送
        </Button>
      </div>

      {group && (
        <Card size="small" style={{ marginTop: 12 }} title="群组信息">
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