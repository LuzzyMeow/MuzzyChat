import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Table, Button, Input, Space, Popconfirm, message, Tag } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useAgents, deleteAgent } from "@/api/agents";
import type { Agent } from "@/types/agent";

export default function AgentsPage() {
  const navigate = useNavigate();
  const { data: agents, isLoading, error } = useAgents();
  const [search, setSearch] = useState("");

  const filtered = (agents ?? []).filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = async (id: string) => {
    try {
      await deleteAgent(id);
      message.success("Agent 已删除");
    } catch {
      message.error("删除失败");
    }
  };

  const columns: ColumnsType<Agent> = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: "工具",
      dataIndex: "tools",
      key: "tools",
      render: (tools: string[]) =>
        tools.length > 0
          ? tools.map((t) => <Tag key={t}>{t}</Tag>)
          : <span style={{ color: "#bbb" }}>无</span>,
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      render: (v: string) => new Date(v).toLocaleString("zh-CN"),
      sorter: (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    },
    {
      title: "操作",
      key: "actions",
      width: 180,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            onClick={() => navigate(`/agents/${record.id}`)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除"
            description={`确定删除 Agent「${record.name}」?`}
            onConfirm={() => handleDelete(record.id)}
            okText="删除"
            cancelText="取消"
          >
            <Button type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
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
        <h2 style={{ margin: 0 }}>Agent 工坊</h2>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => navigate("/agents/new")}
        >
          创建 Agent
        </Button>
      </div>

      <Input
        placeholder="搜索 Agent 名称..."
        prefix={<SearchOutlined />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 16, maxWidth: 320 }}
        allowClear
      />

      <Table
        columns={columns}
        dataSource={filtered}
        rowKey="id"
        loading={isLoading}
        locale={{ emptyText: error ? "加载失败" : "暂无 Agent" }}
        pagination={{ pageSize: 10 }}
      />
    </div>
  );
}