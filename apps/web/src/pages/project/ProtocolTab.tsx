import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Input,
  List,
  Modal,
  Row,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  PlusOutlined,
  RobotOutlined,
  SaveOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import type { Criterion, PICO } from '@meta/core';
import { api } from '../../api';
import { onDataChanged } from '../../events';

const { TextArea } = Input;

interface FormState {
  title: string;
  objective: string;
  pico: PICO;
  criteria: Criterion[];
  outcomes: string[];
}

const EMPTY: FormState = {
  title: '',
  objective: '',
  pico: { population: '', intervention: '', comparison: '', outcome: '' },
  criteria: [],
  outcomes: [],
};

const uid = () => crypto.randomUUID();

export default function ProtocolTab({ projectId }: { projectId: string }) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [researchQuestion, setResearchQuestion] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportText, setExportText] = useState('');

  const loadProtocol = async () => {
    try {
      const p = await api.getProtocol(projectId);
      if (p) setForm({ title: p.title, objective: p.objective, pico: p.pico, criteria: p.criteria, outcomes: p.outcomes });
    } catch (e) {
      message.error(String(e));
    }
  };

  useEffect(() => {
    void loadProtocol();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Agent 确认写入协议后，实时刷新表单
  useEffect(() => onDataChanged('protocol', () => void loadProtocol()), [projectId]);

  const generate = async () => {
    if (!researchQuestion.trim()) return message.warning('请输入研究问题');
    setGenerating(true);
    try {
      const draft = await api.generateProtocol(projectId, researchQuestion.trim());
      setForm({
        title: draft.title,
        objective: draft.objective,
        pico: draft.pico,
        criteria: draft.criteria,
        outcomes: draft.outcomes,
      });
      message.success('已生成草案，可继续修改后保存');
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.putProtocol(projectId, form);
      message.success('协议已保存');
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const doExport = async () => {
    try {
      const r = await api.exportProtocol(projectId);
      setExportText(r.text);
      setExportOpen(true);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const setPico = (k: keyof PICO, v: string) =>
    setForm((f) => ({ ...f, pico: { ...f.pico, [k]: v } }));

  const setCriterion = (id: string, patch: Partial<Criterion>) =>
    setForm((f) => ({
      ...f,
      criteria: f.criteria.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));

  const addCriterion = (type: 'inclusion' | 'exclusion') =>
    setForm((f) => ({
      ...f,
      criteria: [...f.criteria, { id: uid(), type, text: '' }],
    }));

  const removeCriterion = (id: string) =>
    setForm((f) => ({ ...f, criteria: f.criteria.filter((c) => c.id !== id) }));

  const setOutcome = (i: number, v: string) =>
    setForm((f) => ({
      ...f,
      outcomes: f.outcomes.map((o, idx) => (idx === i ? v : o)),
    }));

  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      message.success('已复制');
    } catch {
      message.error('复制失败');
    }
  };

  const downloadExport = () => {
    const blob = new Blob([exportText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${form.title || 'protocol'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="研究问题 → AI 生成草案">
        <TextArea
          rows={2}
          value={researchQuestion}
          onChange={(e) => setResearchQuestion(e.target.value)}
          placeholder="例如：比较药物 X 与安慰剂治疗成人 2 型糖尿病对糖化血红蛋白影响的随机对照试验"
        />
        <Button
          type="primary"
          icon={<RobotOutlined />}
          loading={generating}
          style={{ marginTop: 12 }}
          onClick={() => void generate()}
        >
          AI 生成协议草案
        </Button>
        <Typography.Text type="secondary" style={{ marginLeft: 12 }}>
          生成后会填充下方表单，可修改后再保存
        </Typography.Text>
      </Card>

      <Card
        title="协议内容"
        extra={
          <Space>
            <Button icon={<DownloadOutlined />} onClick={() => void doExport()}>
              导出注册文本
            </Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>
              保存协议
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Typography.Text strong>研究标题</Typography.Text>
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="研究标题"
            />
          </div>
          <div>
            <Typography.Text strong>研究目的</Typography.Text>
            <TextArea
              rows={2}
              value={form.objective}
              onChange={(e) => setForm((f) => ({ ...f, objective: e.target.value }))}
              placeholder="研究目的"
            />
          </div>

          <div>
            <Typography.Text strong>PICO 要素</Typography.Text>
            <Row gutter={12} style={{ marginTop: 8 }}>
              <Col span={12}><Input addonBefore="P 研究对象" value={form.pico.population} onChange={(e) => setPico('population', e.target.value)} /></Col>
              <Col span={12}><Input addonBefore="I 干预" value={form.pico.intervention} onChange={(e) => setPico('intervention', e.target.value)} /></Col>
            </Row>
            <Row gutter={12} style={{ marginTop: 8 }}>
              <Col span={12}><Input addonBefore="C 对照" value={form.pico.comparison} onChange={(e) => setPico('comparison', e.target.value)} /></Col>
              <Col span={12}><Input addonBefore="O 结局" value={form.pico.outcome} onChange={(e) => setPico('outcome', e.target.value)} /></Col>
            </Row>
            <Row gutter={12} style={{ marginTop: 8 }}>
              <Col span={12}>
                <Input
                  addonBefore="研究设计"
                  value={form.pico.studyDesign ?? ''}
                  onChange={(e) => setPico('studyDesign', e.target.value)}
                  placeholder="可选"
                />
              </Col>
            </Row>
          </div>

          <div>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Typography.Text strong>纳入 / 排除标准</Typography.Text>
              <Space>
                <Button size="small" icon={<PlusOutlined />} onClick={() => addCriterion('inclusion')}>纳入</Button>
                <Button size="small" icon={<PlusOutlined />} onClick={() => addCriterion('exclusion')}>排除</Button>
              </Space>
            </Space>
            <List
              style={{ marginTop: 8 }}
              dataSource={form.criteria}
              renderItem={(c) => (
                <List.Item>
                  <Space.Compact style={{ width: '100%' }}>
                    <Select
                      style={{ width: 110 }}
                      value={c.type}
                      onChange={(v) => setCriterion(c.id, { type: v })}
                      options={[
                        { value: 'inclusion', label: '纳入' },
                        { value: 'exclusion', label: '排除' },
                      ]}
                    />
                    <Input value={c.text} onChange={(e) => setCriterion(c.id, { text: e.target.value })} placeholder="标准描述" />
                  </Space.Compact>
                  <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeCriterion(c.id)} />
                </List.Item>
              )}
            />
          </div>

          <div>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Typography.Text strong>结局指标</Typography.Text>
              <Button size="small" icon={<PlusOutlined />} onClick={() => setForm((f) => ({ ...f, outcomes: [...f.outcomes, ''] }))}>
                添加
              </Button>
            </Space>
            <List
              style={{ marginTop: 8 }}
              dataSource={form.outcomes}
              renderItem={(o, i) => (
                <List.Item>
                  <Input value={o} onChange={(e) => setOutcome(i, e.target.value)} placeholder="结局指标描述" />
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => setForm((f) => ({ ...f, outcomes: f.outcomes.filter((_, idx) => idx !== i) }))}
                  />
                </List.Item>
              )}
            />
          </div>
        </Space>
      </Card>

      <Modal
        title={`协议导出 · ${form.title || '未命名'}`}
        open={exportOpen}
        onCancel={() => setExportOpen(false)}
        footer={
          <Space>
            <Button icon={<CopyOutlined />} onClick={() => void copyExport()}>复制</Button>
            <Button type="primary" icon={<DownloadOutlined />} onClick={downloadExport}>下载 .md</Button>
          </Space>
        }
        width={720}
      >
        <pre style={{ maxHeight: 420, overflow: 'auto', background: '#fafafa', padding: 12, borderRadius: 8 }}>{exportText}</pre>
        <Tag color="blue" style={{ marginTop: 8 }}>提示：此为 PROSPERO 风格草稿，可粘贴到注册平台后人工核对完善</Tag>
      </Modal>
    </Space>
  );
}
