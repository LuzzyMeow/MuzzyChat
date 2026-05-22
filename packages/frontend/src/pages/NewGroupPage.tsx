import { useNavigate } from "react-router-dom";
import {
  Form,
  Input,
  Button,
  Select,
  Switch,
  Card,
  message,
} from "antd";
import { SaveOutlined, ArrowLeftOutlined } from "@ant-design/icons";
import { createGroup } from "@/api/groups";
import type { CreateChatGroupInput } from "@/types/chat-group";

export default function NewGroupPage() {
  const navigate = useNavigate();
  const [form] = Form.useForm();

  const handleSubmit = async (values: Record<string, unknown>) => {
    try {
      const group = await createGroup(values as unknown as CreateChatGroupInput);
      message.success("群聊创建成功");
      navigate(`/chat/${group.conversationId}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "创建失败");
    }
  };

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
      </Card>
    </div>
  );
}