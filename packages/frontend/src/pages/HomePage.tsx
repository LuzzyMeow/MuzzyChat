import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  List,
  Typography,
  Button,
  Popconfirm,
  message,
  Space,
  Tag,
  Tabs,
  Empty,
  Spin,
} from "antd";
import {
  PlusOutlined,
  TeamOutlined,
  UserOutlined,
  DeleteOutlined,
  MessageOutlined,
} from "@ant-design/icons";
import { useConversations, deleteConversation } from "@/api/conversations";
import type { Conversation } from "@/types/conversation";

const { Text } = Typography;

export default function HomePage() {
  const navigate = useNavigate();
  const { data: conversations, isLoading, error } = useConversations();
  const [tab, setTab] = useState<"group" | "dm">("group");

  const filtered = (conversations ?? []).filter((c) => c.type === tab);

  const handleDelete = async (id: string) => {
    try {
      await deleteConversation(id);
      message.success("已删除");
    } catch {
      message.error("删除失败");
    }
  };

  const handleEnter = (c: Conversation) => {
    if (c.type === "group") {
      navigate(`/chat/${c.id}`);
    } else {
      // DM: use participantAgentId if available (resume existing DM),
      // otherwise navigate via conversation id.
      navigate(`/dm/${c.participantAgentId ?? c.id}`);
    }
  };

  const tabItems = [
    {
      key: "group",
      label: (
        <span>
          <TeamOutlined /> 群聊
        </span>
      ),
    },
    {
      key: "dm",
      label: (
        <span>
          <UserOutlined /> 私聊
        </span>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: 0 }}>对话列表</h2>
        <Space>
          <Button icon={<PlusOutlined />} onClick={() => navigate("/new-group")}>
            新建群聊
          </Button>
        </Space>
      </div>

      <Tabs
        activeKey={tab}
        onChange={(key) => setTab(key as "group" | "dm")}
        items={tabItems}
      />

      {isLoading ? (
        <div style={{ textAlign: "center", padding: 60 }}>
          <Spin size="large" />
        </div>
      ) : error ? (
        <Empty description="加载失败" />
      ) : filtered.length === 0 ? (
        <Empty
          description={tab === "group" ? "暂无群聊，点击上方按钮创建" : "暂无私聊"}
        />
      ) : (
        <List
          dataSource={filtered}
          renderItem={(item) => (
            <List.Item
              actions={[
                <Button
                  key="enter"
                  type="primary"
                  icon={<MessageOutlined />}
                  onClick={() => handleEnter(item)}
                >
                  进入
                </Button>,
                <Popconfirm
                  key="delete"
                  title="确认删除此对话？"
                  onConfirm={() => handleDelete(item.id)}
                  okText="删除"
                  cancelText="取消"
                >
                  <Button danger icon={<DeleteOutlined />} />
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Text strong>
                    {item.title ?? "未命名对话"}
                  </Text>
                }
                description={
                  <Space>
                    <Tag color={item.type === "group" ? "blue" : "green"}>
                      {item.type === "group" ? "群聊" : "私聊"}
                    </Tag>
                    <Text type="secondary">
                      {new Date(item.createdAt).toLocaleString("zh-CN")}
                    </Text>
                  </Space>
                }
              />
            </List.Item>
          )}
          style={{ background: "#fff" }}
        />
      )}
    </div>
  );
}