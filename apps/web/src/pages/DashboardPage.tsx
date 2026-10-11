import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Input,
  message,
  Popconfirm,
  Steps,
  Table,
  Typography,
  Space,
} from 'antd';
import { ArrowRightOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { Project } from '../types';

const STAGES = [
  { title: '协议制定', description: 'PICO / 纳入排除标准' },
  { title: '检索策略', description: '数据库 + 检索式确立' },
  { title: '题摘初筛', description: 'AI 辅助判断' },
  { title: '全文上传', description: 'PDF → MinerU → Markdown' },
  { title: '全文判断与提取', description: '文本/表格提取，图表人工定位' },
  { title: '结果展示', description: '数据汇总与导出' },
];

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const navigate = useNavigate();

  const load = async () => {
    try {
      setProjects(await api.getProjects());
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    if (!name.trim()) {
      message.warning('请输入项目名称');
      return;
    }
    try {
      await api.createProject(name.trim(), desc.trim() || undefined);
      setName('');
      setDesc('');
      message.success('项目已创建');
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      <Card title="研究流程">
        <Steps
          current={-1}
          items={STAGES}
          responsive
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
          系统按上述流程推进：协议 → 检索 → 初筛 → 全文 → 提取 → 结果展示。AI 只提供建议，纳入/排除均由研究者人工拍板。
        </Typography.Paragraph>
      </Card>

      <Card
        title="研究项目"
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
        }
      >
        <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
          <Input
            placeholder="项目名称，如：某某药物治疗某某疾病的 Meta 分析"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={() => void create()}
          />
          <Input
            placeholder="描述（可选）"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onPressEnter={() => void create()}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => void create()}>
            新建项目
          </Button>
        </Space.Compact>

        <Table<Project>
          rowKey="id"
          dataSource={projects}
          pagination={false}
          columns={[
            {
              title: '项目名称',
              dataIndex: 'name',
              render: (v: string, r) => (
                <Typography.Link onClick={() => navigate(`/projects/${r.id}`)}>
                  {v}
                </Typography.Link>
              ),
            },
            {
              title: '文献数',
              dataIndex: 'referenceCount',
              width: 100,
            },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              width: 200,
              render: (v: string) => new Date(v).toLocaleString(),
            },
            {
              title: '操作',
              width: 160,
              render: (_, r) => (
                <Space>
                  <Button
                    size="small"
                    type="link"
                    icon={<ArrowRightOutlined />}
                    onClick={() => navigate(`/projects/${r.id}`)}
                  >
                    打开
                  </Button>
                  <Popconfirm
                    title="删除该项目？"
                    description="将同时删除其文献、判定与提取数据"
                    onConfirm={async () => {
                      try {
                        await api.deleteProject(r.id);
                        message.success('已删除');
                        await load();
                      } catch (err) {
                        message.error(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  >
                    <Button size="small" type="link" danger icon={<DeleteOutlined />}>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );
}
