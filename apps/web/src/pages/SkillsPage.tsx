import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { AgentKnowledge, AgentSkill } from '../types';

const { TextArea } = Input;

export default function SkillsPage() {
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [knowledge, setKnowledge] = useState<AgentKnowledge[]>([]);
  const [editing, setEditing] = useState<AgentSkill | null>(null);
  const [skillForm, setSkillForm] = useState({ name: '', description: '', content: '' });
  const [knowledgeForm, setKnowledgeForm] = useState({ name: '', description: '', file: null as File | null });
  const [savingSkill, setSavingSkill] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    try {
      const [s, k] = await Promise.all([api.listSkills(), api.listKnowledge()]);
      setSkills(s);
      setKnowledge(k);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openNew = () => {
    setEditing({ id: '', name: '', description: '', content: '', createdAt: '', updatedAt: '' });
    setSkillForm({ name: '', description: '', content: '' });
  };

  const openEdit = (s: AgentSkill) => {
    setEditing(s);
    setSkillForm({ name: s.name, description: s.description, content: s.content });
  };

  const saveSkill = async () => {
    if (!skillForm.name.trim()) return message.warning('请输入技能名');
    setSavingSkill(true);
    try {
      if (editing?.id) {
        await api.updateSkill(editing.id, skillForm);
      } else {
        await api.createSkill(skillForm);
      }
      message.success('已保存');
      setEditing(null);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSkill(false);
    }
  };

  const upload = async () => {
    if (!knowledgeForm.file) return message.warning('请选择文件');
    if (!knowledgeForm.name.trim()) return message.warning('请输入文档名称');
    setUploading(true);
    try {
      await api.uploadKnowledge(knowledgeForm.name.trim(), knowledgeForm.description.trim(), knowledgeForm.file);
      message.success('已导入并切块');
      setKnowledgeForm({ name: '', description: '', file: null });
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title="技能"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>
            新建技能
          </Button>
        }
      >
        <Table<AgentSkill>
          rowKey="id"
          dataSource={skills}
          pagination={false}
          locale={{ emptyText: '暂无技能。技能是 Agent 可加载的行为规则。' }}
          columns={[
            { title: '名称', dataIndex: 'name', width: 180 },
            { title: '描述', dataIndex: 'description', ellipsis: true },
            {
              title: '操作',
              width: 160,
              render: (_, r) => (
                <Space>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
                    编辑
                  </Button>
                  <Popconfirm title="删除该技能？" onConfirm={() => void api.deleteSkill(r.id).then(load)}>
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Card
        title="知识文档"
        extra={
          <Space>
            <Input
              placeholder="文档名称"
              value={knowledgeForm.name}
              onChange={(e) => setKnowledgeForm({ ...knowledgeForm, name: e.target.value })}
              style={{ width: 180 }}
            />
            <Input
              placeholder="描述（可选）"
              value={knowledgeForm.description}
              onChange={(e) => setKnowledgeForm({ ...knowledgeForm, description: e.target.value })}
              style={{ width: 180 }}
            />
            <Upload
              beforeUpload={(file) => {
                setKnowledgeForm({ ...knowledgeForm, file: file as File });
                return false;
              }}
              maxCount={1}
              showUploadList={false}
            >
              <Button icon={<UploadOutlined />}>{knowledgeForm.file?.name ?? '选择文件'}</Button>
            </Upload>
            <Button type="primary" loading={uploading} onClick={() => void upload()}>
              导入
            </Button>
          </Space>
        }
      >
        <Table<AgentKnowledge>
          rowKey="id"
          dataSource={knowledge}
          pagination={false}
          locale={{ emptyText: '暂无知识文档。支持 Markdown / 纯文本 / PDF。' }}
          columns={[
            { title: '名称', dataIndex: 'name', width: 180 },
            { title: '描述', dataIndex: 'description', ellipsis: true },
            { title: '格式', dataIndex: 'format', width: 90, render: (v: string) => <Tag>{v}</Tag> },
            { title: '切块数', dataIndex: 'chunkCount', width: 90 },
            {
              title: '操作',
              width: 100,
              render: (_, r) => (
                <Popconfirm
                  title="删除该知识文档？"
                  description="将同时删除其所有切块与本地文件"
                  onConfirm={() => void api.deleteKnowledge(r.id).then(load)}
                >
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={editing?.id ? '编辑技能' : '新建技能'}
        open={!!editing}
        onOk={() => void saveSkill()}
        onCancel={() => setEditing(null)}
        okText="保存"
        cancelText="取消"
        confirmLoading={savingSkill}
        width={640}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="名称" required>
            <Input value={skillForm.name} onChange={(e) => setSkillForm({ ...skillForm, name: e.target.value })} />
          </Form.Item>
          <Form.Item label="一句话描述（用于 Agent 选择时判断）">
            <Input value={skillForm.description} onChange={(e) => setSkillForm({ ...skillForm, description: e.target.value })} />
          </Form.Item>
          <Form.Item label="正文（Markdown，行为规则）" required>
            <TextArea
              rows={10}
              value={skillForm.content}
              onChange={(e) => setSkillForm({ ...skillForm, content: e.target.value })}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        说明：技能与知识文档全局共用。项目 Agent 会按需选择加载：平时只看到名称与描述，需要时才注入完整内容。
      </Typography.Paragraph>
    </Space>
  );
}
