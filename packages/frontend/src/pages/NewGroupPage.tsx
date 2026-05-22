import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Form,
  Input,
  Button,
  Select,
  Switch,
  Card,
  message,
  Tabs,
  Space,
  Typography,
  List,
  Avatar,
  Tag,
} from "antd";
import {
  SaveOutlined,
  ArrowLeftOutlined,
  RobotOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { createGroup } from "@/api/groups";
import type { CreateChatGroupInput } from "@/types/chat-group";
import { post } from "@/api/client";

const { Text } = Typography;
const { TextArea } = Input;

interface RecruitAgent {
  name: string;
  avatarStyle: string;
  profession: string;
  personality: string;
  background: string;
  scenario: string;
}

export default function NewGroupPage() {
  const navigate = useNavigate();
  const [form] = Form.useForm();

  // One-line recruitment state
  const [recruitInput, setRecruitInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [previewAgents, setPreviewAgents] = useState<RecruitAgent[] | null>(null);
  const [previewGroupName, setPreviewGroupName] = useState<string>("");
  const [creating, setCreating] = useState(false);

  const handleSubmit = async (values: Record<string, unknown>) => {
    try {
      const group = await createGroup(values as unknown as CreateChatGroupInput);
      message.success("群聊创建成功");
      navigate(`/chat/${group.conversationId}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "创建失败");
    }
  };

  const handleParse = async () => {
    if (!recruitInput.trim()) return;
    setParsing(true);
    try {
      const res = await post<{
        success: boolean;
        data?: { groupName: string; agents: RecruitAgent[] };
        message?: string;
      }>("/api/recruit", { description: recruitInput.trim() });

      if (res.success && res.data) {
        setPreviewAgents(res.data.agents);
        setPreviewGroupName(res.data.groupName);
        message.success(`解析成功，生成了 ${res.data.agents.length} 个 Agent`);
      } else {
        message.warning(res.message ?? "解析失败，请手动配置");
      }
    } catch (err) {
      message.error(String(err));
    } finally {
      setParsing(false);
    }
  };

  const handleCreateFromRecruit = async () => {
    if (!previewAgents) return;
    setCreating(true);
    try {
      // Create the group first
      const group = await createGroup({
        name: previewGroupName || "AI 团队",
        orchestrationMode: "parallel",
        dynamicDiscussionEnabled: false,
      });

      // Then batch create agents
      if (group.id) {
        await post(`/api/groups/${group.id}/agents/batch`, {
          agents: previewAgents,
        });
      }

      message.success(`群聊 "${previewGroupName}" 创建成功`);
      navigate(`/chat/${group.conversationId}`);
    } catch (err) {
      message.error(String(err));
    } finally {
      setCreating(false);
    }
  };

  const tabItems = [
    {
      key: "manual",
      label: "手动配置",
      children: (
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{
            orchestrationMode: "parallel",
            dynamicDiscussionEnabled: false,
          }}
        >
          <Form.Item
            name="name"
            label="群聊名称"
            rules={[
              { required: true, message: "请输入群聊名称" },
              { max: 50, message: "不超过 50 个字符" },
            ]}
          >
            <Input placeholder="给群聊起个名字" />
          </Form.Item>

          <Form.Item
            name="orchestrationMode"
            label="发言模式"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { label: "自由发言 (Parallel)", value: "parallel" },
                { label: "按需发言 (Supervisor)", value: "supervisor" },
              ]}
            />
          </Form.Item>

          <Form.Item
            name="dynamicDiscussionEnabled"
            label="动态讨论"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>

          <Form.Item name="supervisorAgentId" label="主管 Agent（仅 Supervisor 模式）">
            <Input placeholder="Agent ID（可选）" />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              block
            >
              创建群聊
            </Button>
          </Form.Item>
        </Form>
      ),
    },
    {
      key: "recruit",
      label: (
        <span>
          <RobotOutlined /> 一句话招募
        </span>
      ),
      children: (
        <div>
          <Text strong style={{ display: "block", marginBottom: 8 }}>
            用自然语言描述你想要的 AI 团队
          </Text>
          <TextArea
            style={{ width: "100%", marginBottom: 12 }}
            placeholder='例如："组建一个市场调研团队，包含研究员、分析师和撰稿人"'
            value={recruitInput}
            onChange={(e) => setRecruitInput(e.target.value)}
            rows={3}
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
          <Button
            type="primary"
            icon={<RobotOutlined />}
            loading={parsing}
            disabled={!recruitInput.trim()}
            onClick={handleParse}
            block
            style={{ marginBottom: 16 }}
          >
            {parsing ? "解析中..." : "解析并预览"}
          </Button>

          {previewAgents && (
            <Card
              size="small"
              title={
                <Space>
                  <RobotOutlined />
                  <Text strong>{previewGroupName}</Text>
                  <Tag color="blue">{previewAgents.length} 个 Agent</Tag>
                </Space>
              }
            >
              <List
                size="small"
                dataSource={previewAgents}
                renderItem={(agent) => (
                  <List.Item>
                    <List.Item.Meta
                      avatar={
                        <Avatar icon={<UserOutlined />} style={{ backgroundColor: "#722ed1" }} />
                      }
                      title={agent.name}
                      description={
                        <Space direction="vertical" size={0}>
                          <Text style={{ fontSize: 12 }}>
                            <Tag>{agent.profession}</Tag>
                            <Text type="secondary">{agent.personality}</Text>
                          </Text>
                          <Text type="secondary" style={{ fontSize: 11 }}>{agent.background}</Text>
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={creating}
                onClick={handleCreateFromRecruit}
                block
                style={{ marginTop: 12 }}
              >
                确认创建群聊
              </Button>
            </Card>
          )}
        </div>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 600 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate("/")}
        />
        <h2 style={{ margin: 0 }}>创建群聊</h2>
      </div>

      <Card>
        <Tabs items={tabItems} />
      </Card>
    </div>
  );
}
