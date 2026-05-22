import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Form,
  Input,
  Button,
  Select,
  Spin,
  message,
  Card,
} from "antd";
import { SaveOutlined, ArrowLeftOutlined } from "@ant-design/icons";
import { useAgent, createAgent, updateAgent } from "@/api/agents";
import type { CreateAgentInput, UpdateAgentInput } from "@/types/agent";

const { TextArea } = Input;

const AVAILABLE_TOOLS = [
  { label: "read_file", value: "read_file" },
  { label: "list_files", value: "list_files" },
  { label: "write_file", value: "write_file" },
  { label: "execute_command", value: "execute_command" },
  { label: "web_search", value: "web_search" },
  { label: "web_fetch", value: "web_fetch" },
  { label: "code_execute", value: "code_execute" },
];

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === "new";
  const { data: agent, isLoading } = useAgent(isNew ? undefined : id);

  const [form] = Form.useForm();

  useEffect(() => {
    if (agent && !isNew) {
      form.setFieldsValue(agent);
    }
  }, [agent, isNew, form]);

  const handleSubmit = async (values: Record<string, unknown>) => {
    try {
      if (isNew) {
        await createAgent(values as unknown as CreateAgentInput);
        message.success("Agent 创建成功");
      } else {
        await updateAgent(id!, values as UpdateAgentInput);
        message.success("Agent 已更新");
      }
      navigate("/agents");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "操作失败");
    }
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720 }}>
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
          onClick={() => navigate("/agents")}
        />
        <h2 style={{ margin: 0 }}>{isNew ? "创建 Agent" : "编辑 Agent"}</h2>
      </div>

      <Card>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{ tools: [] }}
        >
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, message: "请输入 Agent 名称" },
              { max: 50, message: "不超过 50 个字符" },
            ]}
          >
            <Input placeholder="给 Agent 起个名字" />
          </Form.Item>

          <Form.Item
            name="avatarDescription"
            label="头像描述"
            rules={[{ max: 500, message: "不超过 500 个字符" }]}
          >
            <TextArea rows={2} placeholder="描述 Agent 的外观（可选）" />
          </Form.Item>

          <Form.Item
            name="systemPrompt"
            label="系统提示词"
            rules={[
              { required: true, message: "请输入系统提示词" },
              { max: 4000, message: "不超过 4000 个字符" },
            ]}
          >
            <TextArea
              rows={8}
              placeholder="定义 Agent 的角色、行为和能力..."
            />
          </Form.Item>

          <Form.Item name="assignedModelId" label="绑定模型">
            <Input placeholder="模型 ID（可选，留空使用默认模型）" />
          </Form.Item>

          <Form.Item name="tools" label="启用工具">
            <Select
              mode="multiple"
              placeholder="选择 Agent 可使用的工具"
              options={AVAILABLE_TOOLS}
            />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              block
            >
              {isNew ? "创建" : "保存"}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}