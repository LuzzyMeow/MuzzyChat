import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button, Card, Tag, Typography, Empty } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { Markdown } from "@lobehub/ui";
import { ChatItem, ChatInputArea } from "@lobehub/ui/chat";
import type { MetaData } from "@lobehub/ui";
import { io, Socket } from "socket.io-client";
import { useConversation } from "@/api/conversations";
import { useAgent } from "@/api/agents";

const { Text } = Typography;

interface ChatMessage {
  id?: string;
  role: string;
  content: string;
  agentId?: string;
  agentName?: string;
  timestamp: string;
}

let dmMsgCounter = 0;
function genDmMsgId() {
  return `dm-${++dmMsgCounter}-${Date.now()}`;
}

export default function DMPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [connected, setConnected] = useState(false);
  const [agentThinking, setAgentThinking] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingAgentId, setStreamingAgentId] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const { data: agentObj } = useAgent(agentId);
  const { data: _conversation } = useConversation(
    conversationId ?? undefined
  );

  useEffect(() => {
    if (!agentId) return;

    const socket = io("/chat", {
      path: "/socket.io",
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join_room", { conversationId: agentId });
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on(
      "message:complete",
      (payload: { message: ChatMessage; conversationId: string }) => {
        if (!conversationId) setConversationId(payload.conversationId);
        setStreamingContent("");
        setStreamingAgentId(null);
        setMessages((prev) => [...prev, payload.message]);
      }
    );

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
          id: genDmMsgId(),
          role: "system",
          content: `错误: ${payload.message}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    });

    socketRef.current = socket;

    return () => {
      socket.emit("leave_room", { conversationId: conversationId ?? agentId });
      socket.disconnect();
    };
  }, [agentId, conversationId]);

  const handleSend = () => {
    const content = inputValue.trim();
    if (!content || !socketRef.current || !agentId) return;

    setMessages((prev) => [
      ...prev,
      { id: genDmMsgId(), role: "user", content, timestamp: new Date().toISOString() },
    ]);
    setInputValue("");

    socketRef.current.emit("message:send", {
      conversationId: conversationId ?? agentId,
      agentId,
      content,
      messageType: "text",
    });
  };

  const title = agentObj?.name ?? "私聊";

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
        <Tag color={connected ? "green" : "red"}>
          {connected ? "已连接" : "未连接"}
        </Tag>
        {agentThinking && (
          <Tag color="orange">思考中...</Tag>
        )}
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
          {displayMessages.length === 0 ? (
            <Empty
              description={`向 ${title} 发送消息开始对话`}
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
                        title: msg.agentName ?? title,
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
          placeholder={`向 ${title} 发送消息，Enter 发送，Shift+Enter 换行`}
          onInput={(val) => setInputValue(val)}
          onSend={handleSend}
          loading={agentThinking}
          style={{ width: "100%" }}
        />
      </div>
    </div>
  );
}
