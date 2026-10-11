import { useEffect, useRef, useState, type Key } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Radio,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  RobotOutlined,
  CheckOutlined,
  CloseOutlined,
  GlobalOutlined,
  LinkOutlined,
  MinusOutlined,
  SearchOutlined,
  SettingOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { api } from '../../api';
import { onDataChanged } from '../../events';
import ExclusionReasonsModal from '../../components/ExclusionReasonsModal';
import type {
  AiSettings,
  ExclusionReason,
  ScreeningCounts,
  ScreeningItem,
  StrategyWithDatabase,
} from '../../types';

const { TextArea } = Input;

const DECISION_LABELS = { include: '纳入', exclude: '排除', undecided: '待定' } as const;
const DECISION_COLORS = { include: 'green', exclude: 'red', undecided: 'default' } as const;

const EMPTY_COUNTS: ScreeningCounts = { total: 0, pending: 0, included: 0, excluded: 0, duplicates: 0 };

type ScreeningFilter = 'all' | 'pending' | 'included' | 'excluded';

export default function ScreeningTab({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<ScreeningItem[]>([]);
  const [counts, setCounts] = useState<ScreeningCounts>(EMPTY_COUNTS);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<ScreeningFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Key[]>([]);
  const [suggestingId, setSuggestingId] = useState<string | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [merging, setMerging] = useState(false);

  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const [aiModal, setAiModal] = useState(false);
  const [screeningProviderId, setScreeningProviderId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [providers, setProviders] = useState<Array<{ id: string; name: string; model: string }>>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [decision, setDecision] = useState<'include' | 'exclude' | 'undecided'>('undecided');
  const [reasons, setReasons] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const [reasonsList, setReasonsList] = useState<ExclusionReason[]>([]);
  const [reasonsModal, setReasonsModal] = useState(false);

  const paramsRef = useRef({ filter, page, pageSize, search, includeDuplicates });
  useEffect(() => {
    paramsRef.current = { filter, page, pageSize, search, includeDuplicates };
  }, [filter, page, pageSize, search, includeDuplicates]);

  const load = async () => {
    try {
      const p = paramsRef.current;
      const res = await api.getReferences(projectId, {
        status: p.filter,
        search: p.search || undefined,
        page: p.page,
        pageSize: p.pageSize,
        includeDuplicates: p.includeDuplicates,
      });
      setItems(res.items);
      setCounts(res.counts);
      setTotal(res.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const loadAi = async () => {
    try {
      const [appSettings, ai] = await Promise.all([api.getSettings(), api.getAiSettings(projectId)]);
      setProviders(appSettings.providers.map((x) => ({ id: x.id, name: x.name, model: x.model })));
      setAiSettings(ai);
      setScreeningProviderId(ai?.screeningProviderId ?? null);
      setPrompt(ai?.screeningSystemPrompt ?? '');
    } catch {
      /* 忽略 */
    }
  };

  const loadReasons = async () => {
    try {
      setReasonsList(await api.getExclusionReasons(projectId));
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    setSelectedIds([]);
    void load();
    void loadAi();
    void loadReasons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, filter, page, pageSize, search, includeDuplicates]);

  useEffect(() => onDataChanged('screening', () => void loadAi()), [projectId]);

  const reasonOptions = reasonsList.map((r) => ({ value: r.label, label: r.label }));

  const doMerge = async () => {
    setMerging(true);
    try {
      const r = await api.mergeScreening(projectId);
      message.success(`合并完成：${r.groups} 组，重复 ${r.duplicates} 篇`);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setMerging(false);
    }
  };

  const doBatch = async (force: boolean) => {
    setBatchLoading(true);
    try {
      const ids = selectedIds.length ? (selectedIds as string[]) : undefined;
      const r = await api.suggestBatch(projectId, ids, 20, force);
      if (r.failed.length) {
        message.warning(`完成 ${r.suggestions.length} 篇，失败 ${r.failed.length} 篇：${r.failed[0]!.error.slice(0, 120)}`);
      } else {
        message.success(`完成 ${r.suggestions.length} 篇建议`);
      }
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchLoading(false);
    }
  };

  const acceptAi = async (ids?: string[]) => {
    try {
      const r = await api.acceptAiSuggestions(projectId, ids);
      message.success(`已接受 ${r.accepted} 篇${r.skipped ? `，跳过 ${r.skipped} 篇` : ''}`);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const doSuggest = async (id: string) => {
    setSuggestingId(id);
    try {
      await api.suggestReference(id);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggestingId(null);
    }
  };

  const select = (item: ScreeningItem) => {
    setSelectedId(item.id);
    setDecision(item.decision ?? 'undecided');
    setReasons(item.reasons ?? []);
    setNote(item.note ?? '');
  };

  const saveDecision = async () => {
    if (!selectedId) return;
    try {
      await api.decideReference(selectedId, { decision, reasons: decision === 'exclude' ? reasons : [], note });
      message.success('判定已保存');
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const saveAi = async () => {
    try {
      await api.saveAiSettings(projectId, { screeningProviderId, screeningSystemPrompt: prompt });
      message.success('初筛 AI 设置已保存');
      setAiModal(false);
      await loadAi();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const genPrompt = async () => {
    try {
      const r = await api.generateScreeningPrompt(projectId);
      setPrompt(r.prompt);
      message.success('已生成提示词，可继续修改');
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const decisionTag = (d?: 'include' | 'exclude' | 'undecided') =>
    d ? <Tag color={DECISION_COLORS[d]}>{DECISION_LABELS[d]}</Tag> : <Tag>未判定</Tag>;

  const selected = items.find((x) => x.id === selectedId) ?? null;

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <Card
        style={{ flex: 1, minWidth: 0 }}
        title={
          <Space wrap>
            初筛工作台
            <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
              待筛 {counts.pending} · 纳入 {counts.included} · 排除 {counts.excluded} · 去重剔除 {counts.duplicates}
            </Typography.Text>
          </Space>
        }
        extra={
          <Space wrap>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索标题/摘要/DOI/PMID"
              style={{ width: 180 }}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onPressEnter={() => { setPage(1); setSearch(searchInput.trim()); }}
            />
            <Segmented
              value={filter}
              onChange={(v) => { setPage(1); setFilter(v as ScreeningFilter); }}
              options={[
                { label: '全部', value: 'all' },
                { label: '待筛', value: 'pending' },
                { label: '已纳入', value: 'included' },
                { label: '已排除', value: 'excluded' },
              ]}
            />
            <Button icon={<SyncOutlined />} loading={merging} onClick={() => void doMerge()}>重新合并</Button>
            <Button icon={<SettingOutlined />} onClick={() => setAiModal(true)}>初筛 AI 设置</Button>
            <Button icon={<SettingOutlined />} onClick={() => setReasonsModal(true)}>排除理由</Button>
            <Button icon={<RobotOutlined />} loading={batchLoading} onClick={() => void doBatch(false)}>
              批量建议{selectedIds.length ? `（已选 ${selectedIds.length}）` : '（跳过已判）'}
            </Button>
            <Button icon={<RobotOutlined />} loading={batchLoading} onClick={() => void doBatch(true)}>全部重判</Button>
            <Popconfirm title={selectedIds.length ? '接受所选 AI 判定？' : '接受全部 AI 判定？'} onConfirm={() => void acceptAi(selectedIds.length ? (selectedIds as string[]) : undefined)}>
              <Button icon={<CheckOutlined />}>接受 AI</Button>
            </Popconfirm>
          </Space>
        }
      >
        <Space style={{ marginBottom: 8 }}>
          <Checkbox checked={includeDuplicates} onChange={(e) => { setPage(1); setIncludeDuplicates(e.target.checked); }}>显示重复条目</Checkbox>
        </Space>
        <Table<ScreeningItem>
          rowKey="id"
          dataSource={items}
          scroll={{ x: 'max-content' }}
          pagination={{ current: page, pageSize, total, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (t) => `共 ${t} 篇`, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }}
          rowSelection={{ selectedRowKeys: selectedIds, onChange: setSelectedIds, preserveSelectedRowKeys: false }}
          onRow={(r) => ({ onClick: () => select(r), style: { cursor: 'pointer', background: r.id === selectedId ? '#e6f4ff' : undefined } })}
          columns={[
            {
              title: '标题 / 来源',
              dataIndex: 'title',
              ellipsis: true,
              render: (t: string, r) => (
                <Space direction="vertical" size={0}>
                  <Space size={4}>
                    {r.isDuplicate && <Tag color="orange">重复</Tag>}
                    <Typography.Text strong ellipsis={{ tooltip: t }} style={{ maxWidth: 420 }}>{t}</Typography.Text>
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {[r.sourceName, r.year, r.journal].filter(Boolean).join(' · ')}
                  </Typography.Text>
                </Space>
              ),
            },
            {
              title: 'AI 是否可接受',
              width: 110,
              render: (_, r) => r.aiSuggestion ? <Tag color={DECISION_COLORS[r.aiSuggestion]}>{DECISION_LABELS[r.aiSuggestion]}</Tag> : <Typography.Text type="secondary">—</Typography.Text>,
            },
            { title: 'AI 理由', width: 200, render: (_, r) => r.aiReason ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.aiReason}</Typography.Text> : '—' },
            { title: '我的判定', width: 100, render: (_, r) => decisionTag(r.decision) },
          ]}
        />
      </Card>

      <Card title="文献详情" style={{ width: 560, flexShrink: 0, position: 'sticky', top: 16, maxHeight: 'calc(100vh - 100px)', overflow: 'auto' }}>
        {!selected ? (
          <Empty description="点击左侧文献查看题录并判定" style={{ padding: '40px 0' }} />
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <div>
              <Space size={4}>
                {selected.isDuplicate && <Tag color="orange">重复</Tag>}
                <Typography.Text strong style={{ fontSize: 15 }}>{selected.title}</Typography.Text>
              </Space>
              <div style={{ marginTop: 4 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {selected.authors.join('、')}
                  {[selected.sourceName, selected.year, selected.journal].filter(Boolean).length ? ' · ' + [selected.sourceName, selected.year, selected.journal].filter(Boolean).join(' · ') : ''}
                </Typography.Text>
              </div>
            </div>

            <Space wrap>
              {selected.doi && (
                <Button size="small" icon={<LinkOutlined />} onClick={() => window.open(`https://doi.org/${selected.doi}`, '_blank', 'noopener,noreferrer')}>DOI</Button>
              )}
              {selected.pmid && (
                <Button size="small" icon={<LinkOutlined />} onClick={() => window.open(`https://pubmed.ncbi.nlm.nih.gov/${selected.pmid}/`, '_blank', 'noopener,noreferrer')}>PubMed</Button>
              )}
              <Button size="small" icon={<GlobalOutlined />} onClick={() => window.open(`https://scholar.google.com/scholar?q=${encodeURIComponent(selected.title)}`, '_blank', 'noopener,noreferrer')}>Google Scholar</Button>
              <Button size="small" icon={<RobotOutlined />} loading={suggestingId === selected.id} onClick={() => void doSuggest(selected.id)}>AI 建议</Button>
              {selected.aiSuggestion && !selected.decision && (
                <Button size="small" type="dashed" icon={<CheckOutlined />} onClick={() => void acceptAi([selected.id])}>接受AI</Button>
              )}
            </Space>

            {selected.aiSuggestion && (
              <div>
                <Tag color={DECISION_COLORS[selected.aiSuggestion]}>AI：{DECISION_LABELS[selected.aiSuggestion]}</Tag>
                {selected.aiReason && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{selected.aiReason}</Typography.Text>}
              </div>
            )}

            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>摘要</Typography.Text>
              <div style={{ maxHeight: '46vh', overflow: 'auto', marginTop: 4, border: '1px solid #f0f0f0', borderRadius: 8, padding: '10px 12px', fontSize: 13, lineHeight: 1.7 }}>
                {selected.abstract ? (
                  <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: 0 }}>
                    {selected.abstract}
                  </Typography.Paragraph>
                ) : (
                  <Tag>无摘要</Tag>
                )}
              </div>
            </div>

            <Card size="small" title="我的判定">
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Radio.Group value={decision} onChange={(e) => setDecision(e.target.value)}>
                  <Radio.Button value="include"><CheckOutlined /> 纳入</Radio.Button>
                  <Radio.Button value="exclude"><CloseOutlined /> 排除</Radio.Button>
                  <Radio.Button value="undecided"><MinusOutlined /> 待定</Radio.Button>
                </Radio.Group>
                {decision === 'exclude' && (
                  <Select mode="multiple" style={{ width: '100%' }} placeholder="选择排除理由" value={reasons} onChange={setReasons} options={reasonOptions} />
                )}
                <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="备注（可选）" />
                <Button type="primary" onClick={() => void saveDecision()}>保存判定</Button>
              </Space>
            </Card>
          </Space>
        )}
      </Card>

      <Modal title="初筛 AI 设置" open={aiModal} onCancel={() => setAiModal(false)} onOk={() => void saveAi()} okText="保存" cancelText="取消" width={720}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Typography.Text strong>初筛模型</Typography.Text>
            <Select
              style={{ width: '100%', marginTop: 4 }}
              placeholder="跟随全局筛选模型"
              allowClear
              value={screeningProviderId ?? undefined}
              onChange={(v) => setScreeningProviderId(v ?? null)}
              options={providers.map((p) => ({ value: p.id, label: `${p.name} (${p.model})` }))}
            />
          </div>
          <div>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Typography.Text strong>初筛系统提示词</Typography.Text>
              <Button size="small" icon={<RobotOutlined />} onClick={() => void genPrompt()}>根据协议自动生成</Button>
            </Space>
            <TextArea rows={12} style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 12 }} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </div>
        </Space>
      </Modal>

      <ExclusionReasonsModal projectId={projectId} open={reasonsModal} onClose={() => setReasonsModal(false)} onSaved={() => void loadReasons()} />
    </div>
  );
}
