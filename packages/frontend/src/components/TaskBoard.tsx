import React, { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { Card, Typography, Tag, Progress, Space, Collapse } from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  LoadingOutlined,
  ExclamationCircleOutlined,
  MinusCircleOutlined,
  LockOutlined,
} from "@ant-design/icons";

const { Text } = Typography;

// ── Types (溯源: 02-群聊设计 §4.1, §4.4.2) ─────────────────

type SubtaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

interface SubtaskInfo {
  subtaskId: string;
  planId: string;
  agentId: string;
  agentName: string;
  title: string;
  status: SubtaskStatus;
  error?: string;
}

interface TaskUpdateEvent {
  taskId: string;
  status: string;
  data?: {
    planId?: string;
    agentId?: string;
    agentName?: string;
    title?: string;
    error?: string;
  };
}

// ── Status mapping (02-群聊设计 §4.4.2) ─────────────────────

const STATUS_CONFIG: Record<
  SubtaskStatus,
  { color: string; icon: React.ReactNode; label: string }
> = {
  pending: {
    color: "#d9d9d9",
    icon: <LockOutlined />,
    label: "等待中",
  },
  ready: {
    color: "#1677ff",
    icon: <ClockCircleOutlined />,
    label: "待执行",
  },
  running: {
    color: "#1677ff",
    icon: <LoadingOutlined />,
    label: "执行中",
  },
  completed: {
    color: "#52c41a",
    icon: <CheckCircleOutlined />,
    label: "已完成",
  },
  failed: {
    color: "#ff4d4f",
    icon: <ExclamationCircleOutlined />,
    label: "失败",
  },
  skipped: {
    color: "#d9d9d9",
    icon: <MinusCircleOutlined />,
    label: "已跳过",
  },
};

interface TaskBoardProps {
  tasks: SubtaskInfo[];
  completedCount: number;
}

export function TaskBoard({ tasks, completedCount }: TaskBoardProps) {
  if (tasks.length === 0) return null;

  const totalTasks = tasks.length;
  const progressPercent =
    totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;

  return (
    <Card
      size="small"
      style={{ marginTop: 12, flexShrink: 0 }}
      title={
        <Space>
          <Text strong>任务看板</Text>
          <Tag color="blue">Supervisor 模式</Tag>
        </Space>
      }
    >
      <Progress
        percent={progressPercent}
        status={completedCount === totalTasks ? "success" : "active"}
        style={{ marginBottom: 12 }}
      />
      <Collapse
        size="small"
        items={[
          {
            key: "tasks",
            label: `子任务列表 (${completedCount}/${totalTasks})`,
            children: (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {tasks.map((task) => {
                  const config = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.pending;
                  return (
                    <Card
                      key={task.subtaskId}
                      size="small"
                      styles={{ body: { padding: "8px 12px" } }}
                    >
                      <Space direction="vertical" size={2} style={{ width: "100%" }}>
                        <Space>
                          <Tag color={config.color} icon={config.icon}>
                            {config.label}
                          </Tag>
                          <Text strong>{task.title}</Text>
                        </Space>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {task.agentName}
                        </Text>
                        {task.error && (
                          <Text type="danger" style={{ fontSize: 11 }}>
                            错误: {task.error.slice(0, 100)}
                          </Text>
                        )}
                      </Space>
                    </Card>
                  );
                })}
              </div>
            ),
          },
        ]}
      />
    </Card>
  );
}

/**
 * Hook: Listen to task:update events and build task list
 */
export function useTaskBoard(socketRef: React.MutableRefObject<Socket | null>) {
  const [tasks, setTasks] = useState<SubtaskInfo[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const [planId, setPlanId] = useState<string | null>(null);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const handleTaskUpdate = (payload: TaskUpdateEvent) => {
      setTasks((prev) => {
        const existing = prev.find((t) => t.subtaskId === payload.taskId);
        const pId = payload.data?.planId ?? planId;

        if (pId) setPlanId(pId);

        if (existing) {
          // Update existing task
          const updated = prev.map((t) =>
            t.subtaskId === payload.taskId
              ? {
                  ...t,
                  status: payload.status as SubtaskStatus,
                  error: payload.data?.error,
                }
              : t,
          );
          setCompletedCount(
            updated.filter((t) => t.status === "completed").length,
          );
          return updated;
        }

        // Add new task
        const newTask: SubtaskInfo = {
          subtaskId: payload.taskId,
          planId: pId ?? "",
          agentId: payload.data?.agentId ?? "",
          agentName: payload.data?.agentName ?? "Unknown",
          title: payload.data?.title ?? payload.taskId,
          status: payload.status as SubtaskStatus,
          error: payload.data?.error,
        };

        const updated = [...prev, newTask];
        setCompletedCount(
          updated.filter((t) => t.status === "completed").length,
        );
        return updated;
      });
    };

    socket.on("task:update", handleTaskUpdate);

    return () => {
      socket.off("task:update", handleTaskUpdate);
    };
  }, [socketRef, planId]);

  return { tasks, completedCount };
}
