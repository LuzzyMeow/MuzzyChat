import { useState, useEffect } from "react";
import {
  Card,
  Table,
  Tag,
  Button,
  Space,
  Tabs,
  Typography,
  Input,
  Select,
  Progress,
  message,
} from "antd";
import {
  AppstoreOutlined,
  SearchOutlined,
  MergeCellsOutlined,
} from "@ant-design/icons";
import useSWR from "swr";
import { skillApi, type Skill } from "../api/dream-skill";
import { get } from "../api/client";
import type { Agent } from "../types/agent";

const { Title, Text } = Typography;

function useAgents() {
  return useSWR<Agent[]>("/agents", (url: string) => get<Agent[]>(url));
}

export default function SkillsPage() {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Skill[]>([]);
  const [searching, setSearching] = useState(false);
  const { data: agents } = useAgents();
  const agentId = selectedAgent || agents?.[0]?.id || "";

  const { data: skills } = useSWR(
    agentId ? `/skill/list/${agentId}` : null,
    () => skillApi.list(agentId, undefined, 50),
  );

  useEffect(() => {
    if (agents && agents.length > 0 && !selectedAgent) {
      setSelectedAgent(agents[0].id);
    }
  }, [agents, selectedAgent]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const results = await skillApi.search(searchQuery, 5);
      setSearchResults(results);
    } catch {
      message.error("搜索失败");
    } finally {
      setSearching(false);
    }
  };

  const handleCurator = async () => {
    if (!agentId) return;
    try {
      await skillApi.triggerCurator(agentId);
      message.success("Curator 审查已入队");
    } catch {
      message.error("触发失败");
    }
  };

  const statusColorMap: Record<string, string> = {
    active: "green",
    stale: "orange",
    deprecated: "red",
    archived: "default",
  };

  const trustColorMap: Record<string, string> = {
    builtin: "purple",
    trusted: "blue",
    agent_created: "cyan",
  };

  const skillColumns = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: "描述",
      dataIndex: "description",
      key: "description",
      render: (desc: string) => (
        <Text ellipsis={{ tooltip: desc }} style={{ maxWidth: 300 }}>
          {desc}
        </Text>
      ),
    },
    {
      title: "分类",
      dataIndex: "category",
      key: "category",
      render: (cat: string) => <Tag>{cat}</Tag>,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (status: string) => (
        <Tag color={statusColorMap[status] || "default"}>{status}</Tag>
      ),
    },
    {
      title: "信任级别",
      dataIndex: "trustLevel",
      key: "trustLevel",
      render: (level: string) => (
        <Tag color={trustColorMap[level] || "default"}>{level}</Tag>
      ),
    },
    {
      title: "成功率",
      dataIndex: "successRate",
      key: "successRate",
      width: 120,
      render: (rate: number) => (
        <Progress
          percent={Math.round(rate * 100)}
          size="small"
          status={rate >= 0.8 ? "success" : rate >= 0.5 ? "normal" : "exception"}
        />
      ),
    },
    {
      title: "使用次数",
      dataIndex: "usageCount",
      key: "usageCount",
      width: 80,
      sorter: (a: Skill, b: Skill) => a.usageCount - b.usageCount,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Card>
          <Space wrap>
            <Title level={4} style={{ margin: 0 }}>
              技能管理
            </Title>
            <Select
              value={agentId}
              onChange={setSelectedAgent}
              style={{ width: 200 }}
              placeholder="选择 Agent"
              options={agents?.map((a) => ({ label: a.name, value: a.id }))}
            />
            <Button icon={<MergeCellsOutlined />} onClick={handleCurator}>
              触发 Curator 审查
            </Button>
          </Space>
        </Card>

        <Tabs
          items={[
            {
              key: "list",
              label: (
                <span>
                  <AppstoreOutlined /> 技能列表
                </span>
              ),
              children: (
                <Table
                  dataSource={skills || []}
                  columns={skillColumns}
                  rowKey="id"
                  size="small"
                  pagination={{ pageSize: 15 }}
                />
              ),
            },
            {
              key: "search",
              label: (
                <span>
                  <SearchOutlined /> 语义搜索
                </span>
              ),
              children: (
                <Card>
                  <Space direction="vertical" style={{ width: "100%" }}>
                    <Space>
                      <Input
                        placeholder="输入搜索关键词..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onPressEnter={handleSearch}
                        style={{ width: 400 }}
                      />
                      <Button
                        type="primary"
                        icon={<SearchOutlined />}
                        onClick={handleSearch}
                        loading={searching}
                      >
                        搜索
                      </Button>
                    </Space>
                    {searchResults.length > 0 && (
                      <Table
                        dataSource={searchResults}
                        columns={skillColumns}
                        rowKey="id"
                        size="small"
                        pagination={false}
                      />
                    )}
                  </Space>
                </Card>
              ),
            },
          ]}
        />
      </Space>
    </div>
  );
}
