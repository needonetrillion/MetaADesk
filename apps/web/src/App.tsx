import { useEffect, useState } from 'react';
import { Button, Layout, Typography } from 'antd';
import { DoubleLeftOutlined, DoubleRightOutlined } from '@ant-design/icons';
import { Route, Routes, useMatch } from 'react-router-dom';
import ProjectList from './components/ProjectList';
import AgentPanel from './components/AgentPanel';
import ProjectPage from './pages/ProjectPage';
import SettingsPage from './pages/SettingsPage';
import HelpPage from './pages/HelpPage';
import SkillsPage from './pages/SkillsPage';

const { Sider, Content } = Layout;

function Welcome() {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 8,
        color: '#999',
      }}
    >
      <Typography.Title level={4} style={{ color: '#bbb' }}>
        欢迎使用 Meta 分析辅助系统
      </Typography.Title>
      <Typography.Text type="secondary">
        在左侧新建或选择一个项目开始，右侧「项目 Agent」可随时对话并辅助填充。
      </Typography.Text>
    </div>
  );
}

export default function App() {
  const match = useMatch('/projects/:id');
  const projectId = match?.params.id;

  const [agentWidth, setAgentWidth] = useState(360);
  const [agentCollapsed, setAgentCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const w = window.innerWidth - e.clientX;
      setAgentWidth(Math.min(Math.max(w, 300), 640));
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  return (
    <Layout style={{ minHeight: '100vh', minWidth: 0 }}>
      <Sider
        width={220}
        theme="dark"
        style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden', flexShrink: 0 }}
      >
        <ProjectList />
      </Sider>

      <Layout style={{ minWidth: 0 }}>
        <Content style={{ padding: 16, height: '100vh', overflow: 'auto', minWidth: 0 }}>
          <Routes>
            <Route path="/projects/:id" element={<ProjectPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/skills" element={<SkillsPage />} />
            <Route path="*" element={<Welcome />} />
          </Routes>
        </Content>
      </Layout>

      {/* 右侧项目 Agent：仅在进入项目时显示 */}
      {projectId && (
        <div
          style={{
            flexShrink: 0,
            height: '100vh',
            position: 'sticky',
            top: 0,
            background: '#fff',
            borderLeft: '1px solid #f0f0f0',
            display: agentCollapsed ? 'none' : 'block',
            width: agentWidth,
          }}
        >
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            style={{
              position: 'absolute',
              left: -3,
              top: 0,
              bottom: 0,
              width: 6,
              cursor: 'col-resize',
              zIndex: 10,
            }}
          />
          <AgentPanel projectId={projectId} />
        </div>
      )}

      {/* 折叠/展开 Agent 的悬浮按钮 */}
      {projectId && (
        <Button
          size="small"
          type="text"
          icon={agentCollapsed ? <DoubleLeftOutlined /> : <DoubleRightOutlined />}
          onClick={() => setAgentCollapsed((v) => !v)}
          title={agentCollapsed ? '展开 Agent' : '折叠 Agent'}
          style={{
            position: 'fixed',
            right: agentCollapsed ? 8 : agentWidth + 8,
            top: 12,
            zIndex: 20,
            background: '#fff',
            boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
          }}
        />
      )}
    </Layout>
  );
}
