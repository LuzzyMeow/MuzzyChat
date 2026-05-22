import { useState, useCallback } from "react";
import {
  Tabs,
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  Tag,
  Space,
  Popconfirm,
  Descriptions,
  Typography,
  message,
  Spin,
  Empty,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ApiOutlined,
  SafetyOutlined,
  InfoCircleOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useProviders, createProvider, updateProvider, deleteProvider } from "@/api/providers";
import { createModel, deleteModel } from "@/api/providers";
import { useAllSettings, setSetting } from "@/api/settings";
import { SETTING_KEYS } from "@/types/settings";
import type {
  ModelProvider,
  ProviderModel,
  CreateProviderInput,
  UpdateProviderInput,
  CreateModelInput,
} from "@/types/provider";

const { Text, Title } = Typography;

// ─── Tab 1: Model Provider Management ──────────────────────────

function ProviderTab() {
  const { data: providers, error, isLoading } = useProviders();
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ModelProvider | null>(null);
  const [addModelModalOpen, setAddModelModalOpen] = useState(false);
  const [modelTargetProvider, setModelTargetProvider] = useState<string | null>(null);
  const [providerForm] = Form.useForm();
  const [modelForm] = Form.useForm();

  const handleAddProvider = useCallback(async () => {
    try {
      const values = await providerForm.validateFields();
      await createProvider(values as CreateProviderInput);
      message.success("供应商添加成功");
      setAddModalOpen(false);
      providerForm.resetFields();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(String(err));
    }
  }, [providerForm]);

  const handleEditProvider = useCallback(
    (provider: ModelProvider) => {
      setEditingProvider(provider);
      providerForm.setFieldsValue({
        name: provider.name,
        apiBase: provider.apiBase,
        apiKeyEncrypted: provider.apiKeyEncrypted,
      });
      setEditModalOpen(true);
    },
    [providerForm],
  );

  const handleSaveEdit = useCallback(async () => {
    if (!editingProvider) return;
    try {
      const values = await providerForm.validateFields();
      await updateProvider(editingProvider.id, values as UpdateProviderInput);
      message.success("供应商更新成功");
      setEditModalOpen(false);
      setEditingProvider(null);
      providerForm.resetFields();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(String(err));
    }
  }, [editingProvider, providerForm]);

  const handleDeleteProvider = useCallback(async (id: string) => {
    try {
      await deleteProvider(id);
      message.success("供应商已删除");
    } catch (err) {
      message.error(String(err));
    }
  }, []);

  const handleAddModel = useCallback(async () => {
    if (!modelTargetProvider) return;
    try {
      const values = await modelForm.validateFields();
      await createModel(modelTargetProvider, values as CreateModelInput);
      message.success("模型添加成功");
      setAddModelModalOpen(false);
      setModelTargetProvider(null);
      modelForm.resetFields();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(String(err));
    }
  }, [modelTargetProvider, modelForm]);

  const handleDeleteModel = useCallback(
    async (providerId: string, modelId: string) => {
      try {
        await deleteModel(providerId, modelId);
        message.success("模型已删除");
      } catch (err) {
        message.error(String(err));
      }
    },
    [],
  );

  const providerColumns: ColumnsType<ModelProvider> = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      width: 200,
    },
    {
      title: "API Base",
      dataIndex: "apiBase",
      key: "apiBase",
      ellipsis: true,
      render: (val: string) => (
        <Text copyable style={{ fontSize: 12 }}>
          {val}
        </Text>
      ),
    },
    {
      title: "模型数量",
      key: "modelCount",
      width: 100,
      render: (_, record) => (
        <Tag color="blue">{record.models?.length ?? 0}</Tag>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 260,
      render: (_, record) => (
        <Space>
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => {
              setModelTargetProvider(record.id);
              modelForm.resetFields();
              setAddModelModalOpen(true);
            }}
          >
            添加模型
          </Button>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEditProvider(record)}
          />
          <Popconfirm
            title="确定要删除此供应商吗？将同时删除其下所有模型。"
            onConfirm={() => handleDeleteProvider(record.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const modelColumns: ColumnsType<ProviderModel> = [
    {
      title: "模型标识",
      dataIndex: "modelId",
      key: "modelId",
      width: 180,
    },
    {
      title: "显示名称",
      dataIndex: "displayName",
      key: "displayName",
    },
    {
      title: "上下文",
      key: "context",
      width: 120,
      render: (_, r) =>
        r.contextWindow ? `${(r.contextWindow / 1000).toFixed(0)}K` : "-",
    },
    {
      title: "Function Calling",
      dataIndex: "supportsFunctionCalling",
      key: "supportsFunctionCalling",
      width: 120,
      render: (val: boolean) => (val ? <Tag color="green">支持</Tag> : <Tag>不支持</Tag>),
    },
    {
      title: "角色",
      dataIndex: "roleHints",
      key: "roleHints",
      width: 200,
      render: (hints: string[]) =>
        hints.length > 0
          ? hints.map((h) => (
              <Tag key={h} color="purple" style={{ fontSize: 11 }}>
                {h}
              </Tag>
            ))
          : "-",
    },
    {
      title: "操作",
      key: "actions",
      width: 80,
      render: (_, record) => (
        <Popconfirm
          title="确定删除此模型？"
          onConfirm={() => handleDeleteModel(record.providerId, record.id)}
        >
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  const expandedRowRender = (provider: ModelProvider) => {
    const models = provider.models ?? [];
    return (
      <div style={{ padding: "0 24px" }}>
        <Text strong style={{ marginBottom: 8, display: "block" }}>
          模型列表
        </Text>
        {models.length > 0 ? (
          <Table
            columns={modelColumns}
            dataSource={models}
            rowKey="id"
            pagination={false}
            size="small"
          />
        ) : (
          <Empty description="暂无模型" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </div>
    );
  };

  if (isLoading) return <Spin style={{ display: "block", margin: "40px auto" }} />;
  if (error) return <Text type="danger">加载失败: {String(error)}</Text>;

  const providerFormContent = (
    <Form form={providerForm} layout="vertical">
      <Form.Item
        name="name"
        label="供应商名称"
        rules={[{ required: true, message: "请输入供应商名称" }, { max: 50 }]}
      >
        <Input placeholder="如 OpenAI、Anthropic、DeepSeek" />
      </Form.Item>
      <Form.Item
        name="apiBase"
        label="API Base URL"
        rules={[{ required: true, message: "请输入 API Base URL" }]}
      >
        <Input placeholder="https://api.openai.com/v1" />
      </Form.Item>
      <Form.Item
        name="apiKeyEncrypted"
        label="API Key"
        rules={[{ required: true, message: "请输入 API Key" }]}
      >
        <Input.Password placeholder="sk-..." />
      </Form.Item>
    </Form>
  );

  const modelFormContent = (
    <Form form={modelForm} layout="vertical">
      <Form.Item
        name="modelId"
        label="模型标识"
        rules={[{ required: true, message: "请输入模型标识" }]}
      >
        <Input placeholder="如 gpt-4o, claude-sonnet-4-20250514" />
      </Form.Item>
      <Form.Item
        name="displayName"
        label="显示名称"
        rules={[{ required: true, message: "请输入显示名称" }, { max: 100 }]}
      >
        <Input placeholder="如 GPT-4o" />
      </Form.Item>
      <Form.Item name="contextWindow" label="上下文窗口 (tokens)">
        <Input type="number" placeholder="如 128000" />
      </Form.Item>
      <Form.Item name="tokenLimit" label="输出 Token 上限">
        <Input type="number" placeholder="如 16384" />
      </Form.Item>
      <Form.Item name="supportsFunctionCalling" label="支持 Function Calling" valuePropName="checked" initialValue={true}>
        <Switch />
      </Form.Item>
      <Form.Item name="roleHints" label="角色标签 (role hints)">
        <Select
          mode="tags"
          placeholder="输入角色标签后回车添加"
          options={[
            { label: "大模型 (large)", value: "large" },
            { label: "小模型 (small)", value: "small" },
            { label: "嵌入模型 (embedding)", value: "embedding" },
            { label: "视觉 (vision)", value: "vision" },
          ]}
        />
      </Form.Item>
    </Form>
  );

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
        <Text strong style={{ fontSize: 16 }}>
          模型供应商
        </Text>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            providerForm.resetFields();
            setAddModalOpen(true);
          }}
        >
          添加供应商
        </Button>
      </div>

      <Table
        columns={providerColumns}
        dataSource={providers ?? []}
        rowKey="id"
        expandable={{ expandedRowRender, defaultExpandAllRows: false }}
        pagination={false}
        locale={{ emptyText: <Empty description="暂无供应商，点击上方按钮添加" /> }}
      />

      {/* Add Provider Modal */}
      <Modal
        title="添加模型供应商"
        open={addModalOpen}
        onOk={handleAddProvider}
        onCancel={() => {
          setAddModalOpen(false);
          providerForm.resetFields();
        }}
        okText="添加"
        cancelText="取消"
      >
        {providerFormContent}
      </Modal>

      {/* Edit Provider Modal */}
      <Modal
        title="编辑模型供应商"
        open={editModalOpen}
        onOk={handleSaveEdit}
        onCancel={() => {
          setEditModalOpen(false);
          setEditingProvider(null);
          providerForm.resetFields();
        }}
        okText="保存"
        cancelText="取消"
      >
        {providerFormContent}
      </Modal>

      {/* Add Model Modal */}
      <Modal
        title="添加模型"
        open={addModelModalOpen}
        onOk={handleAddModel}
        onCancel={() => {
          setAddModelModalOpen(false);
          setModelTargetProvider(null);
          modelForm.resetFields();
        }}
        okText="添加"
        cancelText="取消"
      >
        {modelFormContent}
      </Modal>
    </div>
  );
}

// ─── Tab 2: Default Model Configuration ────────────────────────

function DefaultModelTab() {
  const { data: settings, isLoading } = useAllSettings();
  const { data: providers } = useProviders();
  const [saving, setSaving] = useState(false);

  // Build model options from all providers' models
  const allModels = (providers ?? []).flatMap((p) =>
    (p.models ?? []).map((m) => ({
      value: m.id,
      label: `${m.displayName} (${m.modelId})`,
      provider: p.name,
    })),
  );

  const modelOptions = allModels.map((m) => ({
    value: m.value,
    label: `${m.label}`,
  }));

  const handleChange = useCallback(
    async (key: string, value: string) => {
      setSaving(true);
      try {
        await setSetting(key, value);
        message.success("设置已保存");
      } catch (err) {
        message.error(String(err));
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  if (isLoading) return <Spin style={{ display: "block", margin: "40px auto" }} />;

  return (
    <div>
      <Text strong style={{ fontSize: 16, display: "block", marginBottom: 16 }}>
        默认模型配置
      </Text>
      <Descriptions column={1} bordered size="middle">
        <Descriptions.Item label="大模型 (主对话)">
          <Select
            style={{ width: 380 }}
            placeholder="选择大模型..."
            value={settings?.[SETTING_KEYS.MODEL_DEFAULT_LARGE] ?? undefined}
            loading={saving}
            onChange={(val) => handleChange(SETTING_KEYS.MODEL_DEFAULT_LARGE, val)}
            options={modelOptions}
            allowClear
            showSearch
            optionFilterProp="label"
          />
        </Descriptions.Item>
        <Descriptions.Item label="小模型 (工具调用)">
          <Select
            style={{ width: 380 }}
            placeholder="选择小模型..."
            value={settings?.[SETTING_KEYS.MODEL_DEFAULT_SMALL] ?? undefined}
            loading={saving}
            onChange={(val) => handleChange(SETTING_KEYS.MODEL_DEFAULT_SMALL, val)}
            options={modelOptions}
            allowClear
            showSearch
            optionFilterProp="label"
          />
        </Descriptions.Item>
        <Descriptions.Item label="嵌入模型">
          <Select
            style={{ width: 380 }}
            placeholder="选择嵌入模型..."
            value={settings?.[SETTING_KEYS.MODEL_DEFAULT_EMBEDDING] ?? undefined}
            loading={saving}
            onChange={(val) => handleChange(SETTING_KEYS.MODEL_DEFAULT_EMBEDDING, val)}
            options={modelOptions}
            allowClear
            showSearch
            optionFilterProp="label"
          />
        </Descriptions.Item>
      </Descriptions>
      <Text type="secondary" style={{ display: "block", marginTop: 12 }}>
        请先在「模型供应商」标签中添加供应商和模型，然后在此选择默认模型。
      </Text>
    </div>
  );
}

// ─── Tab 3: Approval Settings ──────────────────────────────────

function ApprovalTab() {
  const { data: settings, isLoading } = useAllSettings();
  const [saving, setSaving] = useState(false);

  const bypassAll = settings?.[SETTING_KEYS.APPROVAL_BYPASS_ALL] === "true";

  const handleToggle = useCallback(
    async (checked: boolean) => {
      setSaving(true);
      try {
        await setSetting(SETTING_KEYS.APPROVAL_BYPASS_ALL, String(checked));
        message.success(checked ? "已开启无审查模式" : "已关闭无审查模式");
      } catch (err) {
        message.error(String(err));
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  if (isLoading) return <Spin style={{ display: "block", margin: "40px auto" }} />;

  return (
    <div>
      <Text strong style={{ fontSize: 16, display: "block", marginBottom: 16 }}>
        工具审批设置
      </Text>
      <Descriptions column={1} bordered size="middle">
        <Descriptions.Item
          label={
            <Space>
              <SafetyOutlined />
              <span>禁用所有工具审批</span>
              <Tag color="red">不推荐</Tag>
            </Space>
          }
        >
          <Switch
            checked={bypassAll}
            loading={saving}
            onChange={handleToggle}
          />
        </Descriptions.Item>
      </Descriptions>
      <div style={{ marginTop: 16 }}>
        <Text type="secondary">
          开启后，Agent 的所有工具调用（包括文件写入、命令执行、代码执行等高风险操作）将不经审批直接执行。
          仅建议在完全可控的离线/开发环境中开启。
        </Text>
      </div>
      <Descriptions
        column={1}
        size="small"
        style={{ marginTop: 16 }}
        title="审批机制说明"
        bordered
      >
        <Descriptions.Item label="第一层：路径守卫">
          仅预置的最小化高风险清单（如 rm -rf、/etc/passwd）触发审批，其余操作默认放行。
        </Descriptions.Item>
        <Descriptions.Item label="第二层：会话白名单">
          同一会话内，已批准过的具体命令/路径再次出现时直接放行。
        </Descriptions.Item>
        <Descriptions.Item label="第三层：全局无审查模式（本开关）">
          开启后所有工具调用不经审批直接执行。
        </Descriptions.Item>
      </Descriptions>
    </div>
  );
}

// ─── Tab 4: About ──────────────────────────────────────────────

function AboutTab() {
  return (
    <div>
      <Text strong style={{ fontSize: 16, display: "block", marginBottom: 16 }}>
        关于 MuzzyChat
      </Text>
      <Descriptions column={1} bordered size="middle">
        <Descriptions.Item label="项目名称">MuzzyChat</Descriptions.Item>
        <Descriptions.Item label="版本">v0.0.2 (Phase 2)</Descriptions.Item>
        <Descriptions.Item label="描述">
          多智能体群聊协作平台 —— 从零构建的一套本地运行的多 Agent 群聊系统
        </Descriptions.Item>
        <Descriptions.Item label="技术栈">
          <Space wrap>
            <Tag>React 19</Tag>
            <Tag>NestJS</Tag>
            <Tag>LangGraph.js</Tag>
            <Tag>PostgreSQL + pgvector</Tag>
            <Tag>Socket.IO</Tag>
            <Tag>Prisma</Tag>
            <Tag>SWR</Tag>
            <Tag>Ant Design 5.x</Tag>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="架构">
          pnpm Monorepo（packages/backend + packages/frontend）
        </Descriptions.Item>
        <Descriptions.Item label="许可证">MIT</Descriptions.Item>
      </Descriptions>
    </div>
  );
}

// ─── Main Settings Page ────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div style={{ maxWidth: 900 }}>
      <Title level={4} style={{ marginBottom: 24 }}>
        <SettingOutlined /> 设置
      </Title>
      <Tabs
        defaultActiveKey="providers"
        items={[
          {
            key: "providers",
            label: (
              <span>
                <ApiOutlined /> 模型供应商
              </span>
            ),
            children: <ProviderTab />,
          },
          {
            key: "default-models",
            label: "默认模型",
            children: <DefaultModelTab />,
          },
          {
            key: "approval",
            label: (
              <span>
                <SafetyOutlined /> 审批设置
              </span>
            ),
            children: <ApprovalTab />,
          },
          {
            key: "about",
            label: (
              <span>
                <InfoCircleOutlined /> 关于
              </span>
            ),
            children: <AboutTab />,
          },
        ]}
      />
    </div>
  );
}
