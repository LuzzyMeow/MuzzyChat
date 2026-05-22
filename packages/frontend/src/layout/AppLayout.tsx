import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { Layout, Menu } from "antd";
import {
  RobotOutlined,
  ThunderboltOutlined,
  DatabaseOutlined,
  SettingOutlined,
  HomeOutlined,
  PlusOutlined,
} from "@ant-design/icons";

const { Sider, Content } = Layout;

const menuItems = [
  { key: "/", icon: <HomeOutlined />, label: "首页" },
  { key: "/agents", icon: <RobotOutlined />, label: "Agent 工坊" },
  { key: "/new-group", icon: <PlusOutlined />, label: "创建团队" },
  { key: "/skills", icon: <ThunderboltOutlined />, label: "技能库" },
  { key: "/memories", icon: <DatabaseOutlined />, label: "记忆浏览器" },
  { key: "/settings", icon: <SettingOutlined />, label: "设置" },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const selectedKey =
    menuItems.find((item) => location.pathname.startsWith(item.key))?.key ?? "/";

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        breakpoint="lg"
        collapsedWidth={64}
        theme="light"
        style={{ borderRight: "1px solid #f0f0f0" }}
      >
        <div
          style={{
            height: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 18,
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          MuzzyChat
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Layout>
        <Content style={{ padding: 24, overflow: "auto" }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}