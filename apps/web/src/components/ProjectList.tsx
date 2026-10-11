import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Empty,
  Input,
  Modal,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SettingOutlined,
  BookOutlined,
  ReadOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { Project } from '../types';

export default function ProjectList() {
  const navigate = useNavigate();
  const location = useLocation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [renameName, setRenameName] = useState('');
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [deleteInput, setDeleteInput] = useState('');

  const currentId = location.pathname.match(/\/projects\/([^/]+)/)?.[1];

  const load = async () => {
    try {
      setProjects(await api.getProjects());
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    if (!name.trim()) return message.warning('请输入项目名称');
    try {
      const p = await api.createProject(name.trim());
      setName('');
      await load();
      navigate(`/projects/${p.id}`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const submitRename = async () => {
    if (!renaming) return;
    if (!renameName.trim()) return message.warning('请输入项目名称');
    try {
      await api.renameProject(renaming.id, renameName.trim());
      message.success('已重命名');
      setRenaming(null);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const submitDelete = async () => {
    if (!deleting) return;
    if (deleteInput.trim() !== deleting.name) {
      return message.warning('请输入正确的项目名以确认删除');
    }
    try {
      await api.deleteProject(deleting.id);
      message.success('已删除');
      setDeleting(null);
      setDeleteInput('');
      await load();
      if (currentId === deleting.id) navigate('/');
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          color: '#fff',
          fontSize: 15,
          fontWeight: 600,
          padding: '16px 16px 8px',
        }}
      >
        Meta 分析辅助
      </div>

      <div style={{ padding: '0 12px 12px' }}>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder="新建项目"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={() => void create()}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => void create()} />
        </Space.Compact>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 8px' }}>
        {projects.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<Typography.Text style={{ color: '#888' }}>暂无项目</Typography.Text>}
            style={{ marginTop: 40 }}
          />
        ) : (
          projects.map((p) => {
            const active = p.id === currentId;
            return (
              <div
                key={p.id}
                onClick={() => navigate(`/projects/${p.id}`)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '8px 10px',
                  marginBottom: 4,
                  borderRadius: 8,
                  cursor: 'pointer',
                  color: active ? '#fff' : 'rgba(255,255,255,0.75)',
                  background: active ? 'rgba(22,119,255,0.5)' : 'transparent',
                }}
              >
                <Typography.Text
                  ellipsis={{ tooltip: p.name }}
                  style={{ flex: 1, color: 'inherit', fontSize: 13 }}
                >
                  {p.name}
                </Typography.Text>
                <Tag style={{ marginInlineEnd: 0 }}>{p.referenceCount}</Tag>
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  title="重命名"
                  style={{ color: 'rgba(255,255,255,0.6)' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenaming(p);
                    setRenameName(p.name);
                  }}
                />
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  style={{ color: 'rgba(255,255,255,0.6)' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleting(p);
                    setDeleteInput('');
                  }}
                />
              </div>
            );
          })
        )}
      </div>

      <div style={{ padding: 12, borderTop: '1px solid rgba(255,255,255,0.15)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Button
          block
          icon={<SettingOutlined />}
          onClick={() => navigate('/settings')}
          type={location.pathname === '/settings' ? 'primary' : 'default'}
        >
          设置
        </Button>
        <Button
          block
          icon={<ReadOutlined />}
          onClick={() => navigate('/skills')}
          type={location.pathname === '/skills' ? 'primary' : 'default'}
        >
          技能库
        </Button>
        <Button
          block
          icon={<BookOutlined />}
          onClick={() => navigate('/help')}
          type={location.pathname === '/help' ? 'primary' : 'default'}
        >
          使用手册
        </Button>
      </div>

      <Modal
        title="重命名项目"
        open={!!renaming}
        onOk={() => void submitRename()}
        onCancel={() => setRenaming(null)}
        okText="确定"
        cancelText="取消"
        destroyOnHidden
      >
        <Input
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          onPressEnter={() => void submitRename()}
          placeholder="输入新的项目名"
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
          重命名会同步修改磁盘文件夹名，其中的数据不受影响。
        </Typography.Paragraph>
      </Modal>

      <Modal
        title="删除项目"
        open={!!deleting}
        onOk={() => void submitDelete()}
        onCancel={() => {
          setDeleting(null);
          setDeleteInput('');
        }}
        okText="删除"
        okButtonProps={{ danger: true, disabled: deleteInput.trim() !== deleting?.name }}
        cancelText="取消"
        destroyOnHidden
      >
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="将永久删除该项目的所有记录"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>文献条目（含重复条目）</li>
              <li>初筛 / 全文判定与排除理由</li>
              <li>数据提取表与提取结果</li>
              <li>检索式与来源库配置</li>
              <li>项目 Agent 对话记录</li>
              <li>本地 PDF / Markdown / 图片文件</li>
            </ul>
          }
        />
        <Typography.Paragraph style={{ marginBottom: 8 }}>
          项目「{deleting?.name}」删除后<strong>不可恢复</strong>。
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          请输入项目名「{deleting?.name}」以确认删除：
        </Typography.Paragraph>
        <Input
          value={deleteInput}
          onChange={(e) => setDeleteInput(e.target.value)}
          placeholder={deleting?.name}
        />
      </Modal>
    </div>
  );
}
