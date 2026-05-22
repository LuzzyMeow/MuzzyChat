import { useState, useEffect } from "react";
import {
  Card,
  Table,
  Tag,
  Button,
  Space,
  Tabs,
  Typography,
  Progress,
  Modal,
  Spin,
  message,
  Select,
} from "antd";
import {
  CloudOutlined,
  ThunderboltOutlined,
  ExperimentOutlined,
  ReloadOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import useSWR from "swr";
import { dreamApi, type DreamSweep, type LongTermMemory } from "../api/dream-skill";
import { get } from "../api/client";
import type { Agent } from "../types/agent";

const { Title, Text } = Typography;

function useAgents() {
  return useSWR<Agent[]>("/agents", (url: string) => get<Agent[]>(url));
}

export default function MemoriesPage() {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [previewMd, setPreviewMd] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const { data: agents } = useAgents();
  const agentId = selectedAgent || agents?.[0]?.id || "";

  const { data: sweeps, mutate: mutateSweeps } = useSWR(
    agentId ? `/dream/sweeps/${agentId}` : null,
    () => dreamApi.getSweeps(agentId, 20),
  );

  const { data: memories, mutate: mutateMemories } = useSWR(
    agentId ? `/dream/memories/${agentId}` : null,
    () => dreamApi.getMemories(agentId, 50),
  );

  useEffect(() => {
    if (agents && agents.length > 0 && !selectedAgent) {
      setSelectedAgent(agents[0].id);
    }
  }, [agents, selectedAgent]);

  const handleTriggerSweep = async () => {
    if (!agentId) return;
    try {
      await dreamApi.triggerSweep(agentId);
      message.success("梦境清扫已入队");
      setTimeout(() => mutateSweeps(), 2000);
    } catch {
      message.error("触发失败");
    }
  };

  const handleRecover = async () => {
    if (!agentId) return;
    try {
      const result = await dreamApi.recoverSweep(agentId);
      if (result.status === "recovered") {
        message.success(`已恢复 Sweep: ${result.sweepId}`);
      } else {
        message.info("无待恢复的 Sweep");
      }
      mutateSweeps();
    } catch {
      message.error("恢复失败");
    }
  };

  const handlePreviewMemory = async () => {
    if (!agentId) return;
    setPreviewLoading(true);
    try {
      const md = await dreamApi.getMemoryMd(agentId);
      setPreviewMd(md);
    } catch {
      message.error("导出失败");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePreviewDreams = async () => {
    if (!agentId) return;
    setPreviewLoading(true);
    try {
      const md = await dreamApi.getDreamsMd(agentId);
      setPreviewMd(md);
    } catch {
      message.error("导出失败");
    } finally {
      setPreviewLoading(false);
    }
  };

  const sweepColumns = [
    {
      title: "Sweep ID",
      dataIndex: "sweepId",
      key: "sweepId",
      render: (id: string) => <Text code>{id.slice(0, 8)}</Text>,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (status: string) => {
        const colorMap: Record<string, string> = {
          completed: "green",
          running: "blue",
          failed: "red",
        };
        const iconMap: Record<string, React.ReactNode> = {
          completed: <CloudOutlined />,
          running: <ThunderboltOutlined />,
          failed: <ExperimentOutlined />,
        };
        return (
          <Tag color={colorMap[status] || "default"} icon={iconMap[status]}>
            {status}
          </Tag>
        );
      },
    },
    {
      title: "开始时间",
      dataIndex: "startedAt",
      key: "startedAt",
      render: (t: string) => new Date(t).toLocaleString("zh-CN"),
    },
    {
      title: "完成时间",
      dataIndex: "completedAt",
      key: "completedAt",
      render: (t: string | null) =>
        t ? new Date(t).toLocaleString("zh-CN") : <Text type="secondary">—</Text>,
    },
  ];

  const memoryColumns = [
    {
      title: "分数",
      dataIndex: "score",
      key: "score",
      width: 120,
      render: (score: number) => (
        <Progress
          percent={Math.round(score * 100)}
          size="small"
          status={score >= 0.8 ? "success" : score >= 0.6 ? "normal" : "exception"}
        />
      ),
      sorter: (a: LongTermMemory, b: LongTermMemory) => a.score - b.score,
    },
    {
      title: "内容",
      dataIndex: "content",
      key: "content",
      render: (content: string) => (
        <Text ellipsis={{ tooltip: content }} style={{ maxWidth: 400 }}>
          {content}
        </Text>
      ),
    },
    {
      title: "频次",
      dataIndex: "frequency",
      key: "frequency",
      width: 80,
      sorter: (a: LongTermMemory, b: LongTermMemory) => a.frequency - b.frequency,
    },
    {
      title: "标签",
      dataIndex: "conceptualTags",
      key: "conceptualTags",
      width: 120,
      render: (tags: Record<string, unknown> | null) => {
        if (!tags || !Array.isArray(tags.tags)) return <Text type="secondary">—</Text>;
        return (tags.tags as string[]).map((t) => (
          <Tag key={t}>{t}</Tag>
        ));
      },
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 160,
      render: (t: string) => new Date(t).toLocaleString("zh-CN"),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Card>
          <Space wrap>
            <Title level={4} style={{ margin: 0 }}>
              记忆与梦境
            </Title>
            <Select
              value={agentId}
              onChange={setSelectedAgent}
              style={{ width: 200 }}
              placeholder="选择 Agent"
              options={agents?.map((a) => ({ label: a.name, value: a.id }))}
            />
            <Button icon={<ThunderboltOutlined />} onClick={handleTriggerSweep}>
              触发梦境清扫
            </Button>
            <Button icon={<ReloadOutlined />} onClick={handleRecover}>
              恢复中断
            </Button>
            <Button
              icon={<FileTextOutlined />}
              onClick={handlePreviewMemory}
              loading={previewLoading}
            >
              导出 MEMORY.md
            </Button>
            <Button
              icon={<FileTextOutlined />}
              onClick={handlePreviewDreams}
              loading={previewLoading}
            >
              导出 DREAMS.md
            </Button>
          </Space>
        </Card>

        <Tabs
          items={[
            {
              key: "sweeps",
              label: "梦境清扫",
              children: (
                <Table
                  dataSource={sweeps || []}
                  columns={sweepColumns}
                  rowKey="id"
                  size="small"
                  pagination={{ pageSize: 10 }}
                />
              ),
            },
            {
              key: "memories",
              label: "长期记忆",
              children: (
                <Table
                  dataSource={memories || []}
                  columns={memoryColumns}
                  rowKey="id"
                  size="small"
                  pagination={{ pageSize: 15 }}
                />
              ),
            },
          ]}
        />
      </Space>

      <Modal
        title="Markdown 预览"
        open={!!previewMd}
        onCancel={() => setPreviewMd(null)}
        width={800}
        footer={null}
      >
        <Spin spinning={previewLoading}>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, maxHeight: 500, overflow: "auto" }}>
            {previewMd}
          </pre>
        </Spin>
      </Modal>
    </div>
  );
}
