import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import '../../markdown.css';
import { Button, Card, Collapse, Divider, Empty, Input, Modal, Popconfirm, Segmented, Select, Space, Table, Tag, Typography, message } from 'antd';
import { RobotOutlined, DownloadOutlined, SettingOutlined, DeleteOutlined, FilePdfOutlined, FileTextOutlined } from '@ant-design/icons';
import { api } from '../../api';
import FigureDigitizer from '../../components/FigureDigitizer';
import ExtractionFieldSettingsModal from '../../components/ExtractionFieldSettingsModal';
import type { FieldSettings, FulltextItem, PairedEntry, RawArm, RawExtraction, RawOutcome, TreatmentClassification } from '../../types';

const { TextArea } = Input;

export default function ExtractionTab({ projectId }: { projectId: string }) {
  const [view, setView] = useState<'workspace' | 'paired'>('workspace');
  const [items, setItems] = useState<FulltextItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [raw, setRaw] = useState<RawExtraction | null>(null);
  const [cls, setCls] = useState<TreatmentClassification | null>(null);
  const [entries, setEntries] = useState<PairedEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [pairedRows, setPairedRows] = useState<Array<{ referenceId: string; title: string; entries: PairedEntry[] }>>([]);
  const [prompt, setPrompt] = useState('');
  const [promptModal, setPromptModal] = useState(false);
  const [digitizerOpen, setDigitizerOpen] = useState(false);
  const [digitizingIndex, setDigitizingIndex] = useState<number | null>(null);
  const [fieldSettingsOpen, setFieldSettingsOpen] = useState(false);
  const [fieldSettings, setFieldSettings] = useState<FieldSettings>({ sections: [] });
  const [mdOpen, setMdOpen] = useState(false);
  const [markdown, setMarkdown] = useState('');

  const load = async () => {
    try {
      const list = await api.getFulltext(projectId);
      setItems(list.filter((x) => x.status === 'ft_included' || x.status === 'extracted'));
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const loadPaired = async () => {
    try {
      setPairedRows(await api.listPairedEntries(projectId));
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load();
    void loadPaired();
    api.getFieldSettings(projectId).then(setFieldSettings).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const select = async (item: FulltextItem) => {
    setSelectedId(item.id);
    setRaw(await api.getRawExtraction(item.id));
    setCls(await api.getClassification(item.id));
    const pe = await api.getPairedEntries(item.id);
    setEntries(pe.entries);
  };

  const removeRef = async (id: string) => {
    try {
      await api.deleteReference(id);
      message.success('已删除该条目');
      if (selectedId === id) setSelectedId(null);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const clearExt = async () => {
    if (!selectedId) return;
    try {
      await api.clearExtraction(selectedId);
      setRaw(null);
      setCls(null);
      setEntries([]);
      message.success('已清空提取数据，状态退回全文纳入');
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const viewMd = async () => {
    if (!selectedId) return;
    try {
      const r = await api.getMarkdown(selectedId);
      setMarkdown(r.markdown);
      setMdOpen(true);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const viewPdf = () => {
    if (!selectedId) return;
    window.open(`/api/references/${selectedId}/document/file`, '_blank');
  };

  const runExtract = async () => {
    if (!selectedId) return;
    setRunning(true);
    try {
      const r = await api.runRawExtraction(selectedId);
      setRaw(r);
      message.success('原始提取完成，可编辑后保存');
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const suggest = async () => {
    if (!selectedId) return;
    setSuggesting(true);
    try {
      const c = await api.suggestClassification(selectedId);
      setCls(c);
      message.success('已建议处理组分类与配对，可修改后保存');
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggesting(false);
    }
  };

  /** 手动开始分类：从原始数据里的处理组自动建组，用户自己设类型并配对 */
  const startManual = () => {
    if (!raw) return message.warning('请先完成原始提取');
    const groups = raw.arms.map((a) => ({
      name: armName(a.id),
      type: (a.values?.['isControl'] === '是' ? 'control' : a.values?.['isControl'] === '否' ? 'experiment' : 'other') as 'experiment' | 'control' | 'other',
    }));
    setCls({ groups, pairings: [] });
    message.info('已从原始数据生成处理组，请设置类型并添加配对');
  };

  const saveCls = async () => {
    if (!selectedId || !cls) return;
    try {
      await api.saveClassification(selectedId, cls);
      message.success('分类已保存');
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const generate = async () => {
    if (!selectedId) return;
    try {
      const r = await api.generatePairedEntries(selectedId);
      setEntries(r.entries);
      await loadPaired();
      message.success('已生成成对条目');
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const saveRaw = async () => {
    if (!selectedId || !raw) return;
    try {
      await api.saveRawExtraction(selectedId, raw);
      message.success('原始提取已保存');
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const genPrompt = async () => {
    try {
      const r = await api.generateExtractionPrompt(projectId);
      setPrompt(r.prompt);
      message.success('已生成提取提示词初稿');
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const savePrompt = async () => {
    try {
      await api.saveAiSettings(projectId, { extractionSystemPrompt: prompt });
      message.success('提取提示词已保存');
      setPromptModal(false);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const setArmValue = (i: number, key: string, val: string) =>
    setRaw((r) => (r ? { ...r, arms: r.arms.map((a, j) => (j === i ? { ...a, values: { ...(a.values ?? {}), [key]: val } } : a)) } : r));
  const setOutcomeValue = (i: number, key: string, val: string) =>
    setRaw((r) => (r ? { ...r, outcomes: r.outcomes.map((o, j) => (j === i ? { ...o, values: { ...(o.values ?? {}), [key]: val } } : o)) } : r));

  const selected = items.find((x) => x.id === selectedId) ?? null;
  const armName = (id: string) => raw?.arms.find((a) => a.id === id)?.values?.name ?? id;

  const studyFields = fieldSettings.sections.filter((s) => s.level === 'study').flatMap((s) => s.fields);
  const armFields = fieldSettings.sections.filter((s) => s.level === 'arm').flatMap((s) => s.fields);
  const outcomeFields = fieldSettings.sections.filter((s) => s.level === 'outcome').flatMap((s) => s.fields);

  return (
    <div>
      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented
          value={view}
          onChange={(v) => setView(v as 'workspace' | 'paired')}
          options={[
            { label: '提取工作台', value: 'workspace' },
            { label: '成对表', value: 'paired' },
          ]}
        />
        <Button icon={<SettingOutlined />} onClick={() => setPromptModal(true)}>提取提示词</Button>
        <Button icon={<SettingOutlined />} onClick={() => setFieldSettingsOpen(true)}>字段提取设置</Button>
      </Space>

      {view === 'workspace' ? (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <Card title="全文纳入文献" style={{ width: 380, flexShrink: 0 }}>
            <Table<FulltextItem>
              rowKey="id"
              dataSource={items}
              pagination={{ pageSize: 20 }}
              size="small"
              locale={{ emptyText: '暂无全文纳入文献' }}
              onRow={(r) => ({ onClick: () => void select(r), style: { cursor: 'pointer', background: r.id === selectedId ? '#e6f4ff' : undefined } })}
              columns={[
                { title: '标题', dataIndex: 'title', ellipsis: true },
                { title: '状态', width: 110, render: (_, r) => (r.status === 'extracted' ? <Tag color="orange">待检查完善</Tag> : <Tag>待提取</Tag>) },
                {
                  title: '操作',
                  width: 70,
                  render: (_, r) => (
                    <Popconfirm title="删除该条目？将同时删除全文与提取数据" onConfirm={() => void removeRef(r.id)}>
                      <Button size="small" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
                    </Popconfirm>
                  ),
                },
              ]}
            />
          </Card>

          <Card
            title={selected?.title ?? '选择文献'}
            style={{ flex: 1, minWidth: 0 }}
            extra={
              selected && (
                <Space wrap>
                  <Button icon={<FileTextOutlined />} disabled={!selected?.documentState || selected.documentState !== 'done'} onClick={() => void viewMd()}>查看MD</Button>
                  <Button icon={<FilePdfOutlined />} disabled={!selected?.documentState} onClick={() => void viewPdf()}>查看PDF</Button>
                  <Button type="primary" icon={<RobotOutlined />} loading={running} onClick={() => void runExtract()}>AI 提取</Button>
                  <Button onClick={() => void saveRaw()}>保存原始</Button>
                  <Popconfirm title="清空该文献的提取数据并退回全文纳入？" onConfirm={() => void clearExt()}>
                    <Button danger>清空提取</Button>
                  </Popconfirm>
                  <Button icon={<RobotOutlined />} loading={suggesting} onClick={() => void suggest()}>AI 建议配对</Button>
                  <Button onClick={() => void saveCls()}>保存分类</Button>
                  <Button type="primary" onClick={() => void generate()}>生成成对条目</Button>
                </Space>
              )
            }
          >
            {!selected ? (
              <Empty description="点击左侧文献进行提取" style={{ padding: 40 }} />
            ) : (
              <Collapse
                size="small"
                defaultActiveKey={['study', 'arm', 'outcome', 'pair']}
                items={[
                  {
                    key: 'study',
                    label: '文献信息',
                    children: (
                      <Table
                        size="small"
                        pagination={false}
                        rowKey="key"
                        dataSource={studyFields}
                        columns={[
                          { title: '字段', dataIndex: 'label', width: 160 },
                          {
                            title: '值', render: (_, f) => (
                              <Input size="small" value={raw?.study[f.key] ?? ''} onChange={(e) => setRaw((x) => x ? { ...x, study: { ...x.study, [f.key]: e.target.value } } : x)} />
                            ),
                          },
                        ]}
                      />
                    ),
                  },
                  {
                    key: 'arm',
                    label: '背景信息（处理组）',
                    children: (
                      <Table<RawArm>
                        size="small"
                        pagination={false}
                        rowKey="id"
                        dataSource={raw?.arms ?? []}
                        scroll={{ x: 'max-content' }}
                        columns={armFields.map((f) => ({
                          title: f.label,
                          ellipsis: true,
                          render: (_: unknown, _r: RawArm, i: number) => (
                            <Input size="small" value={raw?.arms[i]?.values?.[f.key] ?? ''} onChange={(e) => setArmValue(i, f.key, e.target.value)} />
                          ),
                        }))}
                      />
                    ),
                  },
                  {
                    key: 'outcome',
                    label: '结局信息',
                    children: (
                      <Table<RawOutcome>
                        size="small"
                        pagination={false}
                        rowKey="id"
                        dataSource={raw?.outcomes ?? []}
                        scroll={{ x: 'max-content' }}
                        columns={[
                          { title: '处理组', width: 130, render: (_, r) => <Tag>{armName(r.armId)}</Tag> },
                          { title: '结局', width: 140, render: (_, r) => r.outcome },
                          ...outcomeFields.map((f) => ({
                            title: f.label,
                            ellipsis: true,
                            render: (_: unknown, _r: RawOutcome, i: number) => (
                              <Input size="small" value={raw?.outcomes[i]?.values?.[f.key] ?? ''} onChange={(e) => setOutcomeValue(i, f.key, e.target.value)} />
                            ),
                          })),
                          {
                            title: '操作',
                            width: 70,
                            render: (_: unknown, _r: RawOutcome, i: number) => (
                              <Button size="small" onClick={() => { setDigitizingIndex(i); setDigitizerOpen(true); }}>取点</Button>
                            ),
                          },
                        ]}
                      />
                    ),
                  },
                  {
                    key: 'pair',
                    label: '处理组分类与配对',
                    children: cls ? (
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        {cls.groups.map((g, i) => (
                          <Space key={i}>
                            <Tag>{g.name}</Tag>
                            <Select
                              size="small"
                              style={{ width: 100 }}
                              value={g.type}
                              onChange={(x) => setCls((c) => c ? { ...c, groups: c.groups.map((gg, j) => (j === i ? { ...gg, type: x } : gg)) } : c)}
                              options={[{ value: 'experiment', label: '实验组' }, { value: 'control', label: '对照组' }, { value: 'other', label: '其它' }]}
                            />
                          </Space>
                        ))}
                        <Divider style={{ margin: '4px 0' }} />
                        <Typography.Text type="secondary">配对（实验组 vs 对照组）</Typography.Text>
                        {cls.pairings.map((p, i) => {
                          const exps = cls.groups.filter((g) => g.type === 'experiment').map((g) => g.name);
                          const ctrls = cls.groups.filter((g) => g.type === 'control').map((g) => g.name);
                          return (
                            <Space.Compact key={i} style={{ width: '100%' }}>
                              <Select size="small" style={{ width: 160 }} value={p.treatment} onChange={(v) => setCls((c) => c ? { ...c, pairings: c.pairings.map((pp, j) => (j === i ? { ...pp, treatment: v } : pp)) } : c)} options={exps.map((n) => ({ value: n, label: n }))} placeholder="实验组" />
                              <Tag style={{ margin: 0 }}>vs</Tag>
                              <Select size="small" style={{ width: 160 }} value={p.control} onChange={(v) => setCls((c) => c ? { ...c, pairings: c.pairings.map((pp, j) => (j === i ? { ...pp, control: v } : pp)) } : c)} options={ctrls.map((n) => ({ value: n, label: n }))} placeholder="对照组" />
                              <Button size="small" danger onClick={() => setCls((c) => c ? { ...c, pairings: c.pairings.filter((_, j) => j !== i) } : c)}>删</Button>
                            </Space.Compact>
                          );
                        })}
                        <Button size="small" type="dashed" onClick={() => setCls((c) => c ? { ...c, pairings: [...c.pairings, { treatment: '', control: '' }] } : c)}>添加配对</Button>
                      </Space>
                    ) : (
                      <Space direction="vertical" size={8}>
                        <Typography.Text type="secondary">尚未分类。</Typography.Text>
                        <Space>
                          <Button size="small" icon={<RobotOutlined />} loading={suggesting} onClick={() => void suggest()}>AI 建议配对</Button>
                          <Button size="small" onClick={() => void startManual()}>手动开始</Button>
                        </Space>
                      </Space>
                    ),
                  },
                  ...(entries.length > 0
                    ? [{
                        key: 'entries',
                        label: `已生成成对条目（${entries.length}）`,
                        children: (
                          <Table<PairedEntry>
                            size="small" pagination={false} rowKey="id" dataSource={entries}
                            columns={[
                              { title: '实验组', dataIndex: 'treatment' },
                              { title: '对照组', dataIndex: 'control' },
                              { title: '结局', dataIndex: 'outcome' },
                              { title: '实验均值', dataIndex: 'treatmentMean', width: 90 },
                              { title: '对照均值', dataIndex: 'controlMean', width: 90 },
                              { title: '共享对照', width: 90, render: (_, r) => (r.sharedControl ? '是' : '否') },
                            ]}
                          />
                        ),
                      }]
                    : []),
                ]}
              />
            )}
          </Card>
        </div>
      ) : (
        <Card
          title="成对表（全项目）"
          extra={<Button icon={<DownloadOutlined />} href={api.exportPairedCSV(projectId)}>导出 CSV</Button>}
        >
          <Table
            rowKey="id"
            dataSource={pairedRows.flatMap((r) => r.entries.map((e) => ({ ...e, title: r.title })))}
            pagination={{ pageSize: 50 }}
            size="small"
            columns={[
              { title: '文献', dataIndex: 'title', ellipsis: true },
              { title: '实验组', dataIndex: 'treatment', width: 130 },
              { title: '对照组', dataIndex: 'control', width: 130 },
              { title: '结局', dataIndex: 'outcome', width: 130 },
              { title: '实验N', dataIndex: 'treatmentN', width: 80 },
              { title: '对照N', dataIndex: 'controlN', width: 80 },
              { title: '实验均值', dataIndex: 'treatmentMean', width: 90 },
              { title: '对照均值', dataIndex: 'controlMean', width: 90 },
              { title: '共享对照', width: 90, render: (_, r) => (r.sharedControl ? '是' : '否') },
            ]}
          />
        </Card>
      )}

      <Modal title="数据提取提示词" open={promptModal} onCancel={() => setPromptModal(false)} onOk={() => void savePrompt()} okText="保存" cancelText="取消" width={720}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Button size="small" icon={<RobotOutlined />} onClick={() => void genPrompt()}>根据协议自动生成</Button>
          <TextArea rows={14} style={{ fontFamily: 'monospace', fontSize: 12 }} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </Space>
      </Modal>

      <FigureDigitizer
        open={digitizerOpen}
        onClose={() => { setDigitizerOpen(false); setDigitizingIndex(null); }}
        onResult={(v) => {
          if (digitizingIndex !== null) {
            if (v.mean !== undefined) setOutcomeValue(digitizingIndex, 'mean', String(v.mean));
            if (v.sd !== undefined) setOutcomeValue(digitizingIndex, 'sd', String(v.sd));
            message.success(`已回填：均值 ${v.mean}${v.sd !== undefined ? `，SD ${v.sd}` : ''}`);
          }
        }}
      />

      <Modal title={`全文 · ${selected?.title ?? ''}`} open={mdOpen} onCancel={() => setMdOpen(false)} footer={null} width={900}>
        <div className="markdown-body" style={{ maxHeight: '70vh', overflow: 'auto', padding: '12px 16px', border: '1px solid #f0f0f0', borderRadius: 8 }}>
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
            {markdown || '（加载中或尚未转换）'}
          </ReactMarkdown>
        </div>
      </Modal>

      <ExtractionFieldSettingsModal projectId={projectId} open={fieldSettingsOpen} onClose={() => { setFieldSettingsOpen(false); api.getFieldSettings(projectId).then(setFieldSettings).catch(() => undefined); }} />
    </div>
  );
}
