import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { api } from '../api';
import type { AppSettings, ProviderConfig, ProviderPreset } from '../types';

type ProviderFormValues = Omit<ProviderConfig, 'id'>;

const KIND_LABELS: Record<ProviderConfig['kind'], string> = {
  'openai-compatible': 'OpenAI 兼容',
  anthropic: 'Anthropic',
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testingMineru, setTestingMineru] = useState(false);
  const [form] = Form.useForm<ProviderFormValues>();

  useEffect(() => {
    api.getSettings().then(setSettings).catch((e) => message.error(String(e)));
    api.getPresets().then(setPresets).catch((e) => message.error(String(e)));
  }, []);

  if (!settings) return <Typography.Text>加载中…</Typography.Text>;

  const save = async () => {
    try {
      const next = await api.putSettings(settings);
      setSettings(next);
      message.success('设置已保存');
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  };

  const openAdd = (preset: ProviderPreset) => {
    setEditingId(null);
    form.setFieldsValue({
      name: preset.name,
      kind: preset.kind,
      baseUrl: preset.baseUrl,
      model: preset.model,
      apiKey: '',
      temperature: undefined,
      timeoutMs: undefined,
    });
    setModalOpen(true);
  };

  const openEdit = (p: ProviderConfig) => {
    setEditingId(p.id);
    form.setFieldsValue({
      name: p.name,
      kind: p.kind,
      baseUrl: p.baseUrl,
      model: p.model,
      apiKey: p.apiKey,
      temperature: p.temperature,
      timeoutMs: p.timeoutMs,
    });
    setModalOpen(true);
  };

  const submitProvider = (values: ProviderFormValues) => {
    const id = editingId ?? `p-${Date.now()}`;
    const provider: ProviderConfig = { ...values, id };
    const providers = editingId
      ? settings.providers.map((p) => (p.id === editingId ? provider : p))
      : [...settings.providers, provider];
    setSettings({ ...settings, providers });
    setModalOpen(false);
  };

  const removeProvider = (id: string) => {
    setSettings({
      ...settings,
      providers: settings.providers.filter((p) => p.id !== id),
      activeProviderId: settings.activeProviderId === id ? null : settings.activeProviderId,
    });
  };

  const setActive = (id: string) => setSettings({ ...settings, activeProviderId: id });

  const test = async (p: ProviderConfig) => {
    setTestingId(p.id);
    try {
      const r = await api.testLLM(p);
      message.success(`连接成功：${r.reply ?? 'OK'}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setTestingId(null);
    }
  };

  const testMineru = async () => {
    setTestingMineru(true);
    try {
      const r = await api.testMineru({ token: settings.mineruToken, baseUrl: settings.mineruBaseUrl });
      if (r.ok) message.success(r.message);
      else message.error(r.message);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setTestingMineru(false);
    }
  };

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      <Card
        title="大模型 Provider"
        extra={
          <Button type="primary" icon={<SaveOutlined />} onClick={() => void save()}>
            保存设置
          </Button>
        }
      >
        <Space wrap style={{ marginBottom: 16 }}>
          <Typography.Text type="secondary">快速添加：</Typography.Text>
          {presets.map((p) => (
            <Button key={p.name} icon={<PlusOutlined />} onClick={() => openAdd(p)}>
              {p.name}
            </Button>
          ))}
          <Button onClick={() => openAdd({ name: '自定义', kind: 'openai-compatible', baseUrl: '', model: '', needsKey: true })}>
            自定义
          </Button>
        </Space>

        <div style={{ marginBottom: 16, maxWidth: 480 }}>
          <Typography.Text strong>项目 Agent 默认模型</Typography.Text>
          <Typography.Paragraph type="secondary" style={{ margin: '4px 0' }}>
            每个项目的「项目 Agent」对话默认使用该模型；项目里未单独设置时也以此为准。
          </Typography.Paragraph>
          <Select
            style={{ width: '100%' }}
            placeholder="选择默认模型"
            allowClear
            value={settings.activeProviderId ?? undefined}
            onChange={(v) => setSettings({ ...settings, activeProviderId: v ?? null })}
            options={settings.providers.map((p) => ({ value: p.id, label: `${p.name} (${p.model})` }))}
          />
        </div>

        <div style={{ marginBottom: 16, maxWidth: 480 }}>
          <Typography.Text strong>筛选专用模型（可选）</Typography.Text>
          <Typography.Paragraph type="secondary" style={{ margin: '4px 0' }}>
            批量初筛建议将使用该模型；留空则跟随「项目 Agent 默认」模型。适合用一个更便宜/更快的小模型做批量判断。
          </Typography.Paragraph>
          <Select
            style={{ width: '100%' }}
            placeholder="跟随默认模型"
            allowClear
            value={settings.screeningProviderId ?? undefined}
            onChange={(v) => setSettings({ ...settings, screeningProviderId: v ?? null })}
            options={settings.providers.map((p) => ({ value: p.id, label: `${p.name} (${p.model})` }))}
          />
        </div>

        <Table<ProviderConfig>
          rowKey="id"
          dataSource={settings.providers}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: '尚未配置任何 Provider，请点击上方按钮添加' }}
          columns={[
            {
              title: '名称',
              dataIndex: 'name',
              render: (v: string, r) => (
                <Space>
                  {v}
                  {settings.activeProviderId === r.id && <Tag color="green">项目 Agent 默认</Tag>}
                </Space>
              ),
            },
            {
              title: '协议',
              dataIndex: 'kind',
              width: 140,
              render: (v: ProviderConfig['kind']) => KIND_LABELS[v],
            },
            { title: '模型', dataIndex: 'model', width: 160 },
            { title: 'Base URL', dataIndex: 'baseUrl', ellipsis: true },
            {
              title: '操作',
              width: 300,
              render: (_, r) => (
                <Space wrap>
                  {settings.activeProviderId !== r.id && (
                    <Button size="small" icon={<CheckOutlined />} onClick={() => setActive(r.id)}>
                      设为默认
                    </Button>
                  )}
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
                    编辑
                  </Button>
                  <Button
                    size="small"
                    icon={<ThunderboltOutlined />}
                    loading={testingId === r.id}
                    onClick={() => void test(r)}
                  >
                    测试
                  </Button>
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeProvider(r.id)}>
                    删除
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Card title="MinerU 在线服务">
        <Form layout="vertical" style={{ maxWidth: 520 }}>
          <Form.Item label="API Token" extra="在 https://mineru.net/apiManage/token 免费获取">
            <Input.Password
              value={settings.mineruToken}
              placeholder="粘贴 MinerU API Token"
              onChange={(e) => setSettings({ ...settings, mineruToken: e.target.value })}
            />
          </Form.Item>
          <Form.Item label="API Base URL">
            <Input
              value={settings.mineruBaseUrl ?? ''}
              onChange={(e) => setSettings({ ...settings, mineruBaseUrl: e.target.value })}
            />
          </Form.Item>
          <Button
            icon={<ThunderboltOutlined />}
            loading={testingMineru}
            onClick={() => void testMineru()}
          >
            测试连通性
          </Button>
        </Form>
      </Card>

      <Modal
        title={editingId ? '编辑 Provider' : '添加 Provider'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        okText="确定"
        cancelText="取消"
      >
        <Form<ProviderFormValues>
          form={form}
          layout="vertical"
          onFinish={submitProvider}
          initialValues={{ kind: 'openai-compatible' }}
        >
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="kind" label="协议" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'openai-compatible', label: 'OpenAI 兼容 (DeepSeek/OpenAI/Qwen/Ollama)' },
                { value: 'anthropic', label: 'Anthropic' },
              ]}
            />
          </Form.Item>
          <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true, message: '请输入 Base URL' }]}>
            <Input placeholder="如 https://api.deepseek.com" />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key">
            <Input.Password placeholder="Ollama 等本地服务可留空" />
          </Form.Item>
          <Form.Item name="model" label="模型" rules={[{ required: true, message: '请输入模型名' }]}>
            <Input placeholder="如 deepseek-chat" />
          </Form.Item>
          <Form.Item name="temperature" label="温度（可选）">
            <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="timeoutMs"
            label="单次请求超时（毫秒，可选）"
            extra="默认 120000（2 分钟）。超时后自动重试，避免请求挂起拖死接口。"
          >
            <InputNumber min={5000} max={600000} step={10000} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
