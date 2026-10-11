import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import '../../markdown.css';
import {
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  GlobalOutlined,
  LinkOutlined,
  MinusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SettingOutlined,
  SyncOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { api } from '../../api';
import ExclusionReasonsModal from '../../components/ExclusionReasonsModal';
import type { ExclusionReason, FulltextItem, ReferenceDetail } from '../../types';

const { TextArea } = Input;

const DECISION_LABELS = { include: '纳入', exclude: '排除', undecided: '待定' } as const;
const DECISION_COLORS = { include: 'green', exclude: 'red', undecided: 'default' } as const;

function docTag(state?: string, error?: string) {
  if (!state) return <Tag>未上传</Tag>;
  if (state === 'pending') return <Tag color="blue">待转换</Tag>;
  if (state === 'converting') return <Tag color="processing" icon={<SyncOutlined spin />}>转换中</Tag>;
  if (state === 'done') return <Tag color="green">已转换</Tag>;
  if (state === 'failed') return <Tag color="red" title={error}>失败</Tag>;
  return <Tag>{state}</Tag>;
}

export default function FulltextTab({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<FulltextItem[]>([]);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [suggestingId, setSuggestingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReferenceDetail | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [tab, setTab] = useState<'md' | 'pdf'>('md');
  const [decision, setDecision] = useState<'include' | 'exclude' | 'undecided'>('undecided');
  const [reasons, setReasons] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [ftAiModal, setFtAiModal] = useState(false);
  const [ftPrompt, setFtPrompt] = useState('');
  const [reasonsList, setReasonsList] = useState<ExclusionReason[]>([]);
  const [reasonsModal, setReasonsModal] = useState(false);
  const pollingRef = useRef<Set<string>>(new Set());
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guardTimersRef = useRef<Set<ReturnType<typeof setInterval>>>(new Set());
  const timeoutRef = useRef<number>(900 + 60);

  const load = async (autoPoll = false) => {
    try {
      const list = await api.getFulltext(projectId);
      setItems(list);
      const converting = list.filter((x) => x.documentState === 'converting').map((x) => x.id);
      if (converting.length && (autoPoll || pollingRef.current.size === 0)) {
        for (const id of converting) pollingRef.current.add(id);
        schedulePoll(0);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const loadAiSettings = async () => {
    try {
      const a = await api.getAiSettings(projectId);
      setFtPrompt(a?.fulltextSystemPrompt ?? '');
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
    void load(true);
    void loadAiSettings();
    void loadReasons();
    return () => {
      pollingRef.current.clear();
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
      for (const t of guardTimersRef.current) clearInterval(t);
      guardTimersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const patchItem = (id: string, patch: Partial<FulltextItem>) =>
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const schedulePoll = (delay = 3000) => {
    if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
    batchTimerRef.current = setTimeout(async () => {
      const ids = [...pollingRef.current];
      if (ids.length === 0) return;
      try {
        const res = await api.getDocumentStates(ids);
        if (res.mineruTimeoutSeconds) timeoutRef.current = res.mineruTimeoutSeconds + 60;
        const byId = new Map(res.documents.map((d) => [d.referenceId, d]));
        for (const id of ids) {
          const doc = byId.get(id);
          if (!doc) continue;
          patchItem(id, { documentState: doc.state, documentError: doc.error });
          if (doc.state === 'done' || doc.state === 'failed') {
            pollingRef.current.delete(id);
            if (doc.state === 'done') message.success('全文转换完成');
            else message.error(`全文转换失败：${doc.error ?? '未知原因'}`);
          }
        }
      } catch {
        // 网络抖动：保留轮询集合，下轮继续
      }
      if (pollingRef.current.size > 0) schedulePoll(3000);
    }, delay);
  };

  const convertAll = async () => {
    try {
      const r = await api.convertAllDocuments(projectId);
      message.success(`已开始转换 ${r.started} 篇全文`);
      await load(true);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const convert = async (id: string) => {
    try {
      const doc = await api.convertDocument(id);
      patchItem(id, { documentState: doc.state, documentError: undefined });
      message.info('已开始转换，请稍候…');
      pollingRef.current.add(id);
      const startedAt = Date.now();
      const guard = setInterval(() => {
        if (!pollingRef.current.has(id)) {
          clearInterval(guard);
          guardTimersRef.current.delete(guard);
          return;
        }
        if (Date.now() - startedAt > timeoutRef.current * 1000) {
          clearInterval(guard);
          guardTimersRef.current.delete(guard);
          pollingRef.current.delete(id);
          message.warning('转换耗时超出预期，已停止自动刷新，可点击「重试」或刷新查看状态');
        }
      }, 5000);
      guardTimersRef.current.add(guard);
      schedulePoll(3000);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
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

  const select = async (item: FulltextItem) => {
    setSelectedId(item.id);
    setDecision(item.decision ?? 'undecided');
    setReasons(item.reasons ?? []);
    setNote(item.note ?? '');
    setDetail(null);
    setMarkdown('');
    setTab('md');
    api.getReferenceDetail(item.id).then(setDetail).catch(() => setDetail(null));
    if (item.documentState === 'done') {
      api.getMarkdown(item.id).then((r) => setMarkdown(r.markdown)).catch(() => setMarkdown(''));
    }
  };

  const suggest = async (id: string) => {
    setSuggestingId(id);
    try {
      await api.fulltextSuggest(id);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggestingId(null);
    }
  };

  const saveDecision = async () => {
    if (!selectedId) return;
    try {
      await api.fulltextDecision(selectedId, {
        decision,
        reasons: decision === 'exclude' ? reasons : [],
        note,
      });
      message.success('判定已保存');
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const genFtPrompt = async () => {
    try {
      const r = await api.generateFulltextPrompt(projectId);
      setFtPrompt(r.prompt);
      message.success('已生成全文提示词初稿，可编辑后保存');
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const saveFtPrompt = async () => {
    try {
      await api.saveAiSettings(projectId, { fulltextSystemPrompt: ftPrompt });
      message.success('全文 AI 提示词已保存');
      setFtAiModal(false);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const selected = items.find((x) => x.id === selectedId) ?? null;
  const reasonOptions = reasonsList.map((r) => ({ value: r.label, label: r.label }));

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <Card
        title="全文筛选（初筛纳入后的文献）"
        style={{ flex: 1, minWidth: 0 }}
        extra={
          <Space wrap>
            <Button icon={<SettingOutlined />} onClick={() => setFtAiModal(true)}>全文 AI 设置</Button>
            <Button icon={<SettingOutlined />} onClick={() => setReasonsModal(true)}>排除理由</Button>
            <Button icon={<SyncOutlined />} onClick={() => void convertAll()}>全部转换</Button>
          </Space>
        }
      >
        <Table<FulltextItem>
          rowKey="id"
          dataSource={items}
          scroll={{ x: 'max-content' }}
          pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 篇` }}
          locale={{ emptyText: '暂无初筛纳入的文献。请先在「③ 初筛」中纳入文献' }}
          onRow={(r) => ({
            onClick: () => void select(r),
            style: { cursor: 'pointer', background: r.id === selectedId ? '#e6f4ff' : undefined },
          })}
          columns={[
            {
              title: '标题',
              dataIndex: 'title',
              ellipsis: true,
              render: (t: string, r) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text strong ellipsis={{ tooltip: t }} style={{ maxWidth: 420 }}>{t}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {[r.year, r.journal].filter(Boolean).join(' · ')}
                  </Typography.Text>
                </Space>
              ),
            },
            { title: '全文', width: 110, render: (_, r) => docTag(r.documentState, r.documentError) },
            { title: 'AI 建议', width: 110, render: (_, r) => r.aiSuggestion ? <Tag color={DECISION_COLORS[r.aiSuggestion]}>{DECISION_LABELS[r.aiSuggestion]}</Tag> : <Typography.Text type="secondary">—</Typography.Text> },
            { title: '判定', width: 90, render: (_, r) => r.decision ? <Tag color={DECISION_COLORS[r.decision]}>{DECISION_LABELS[r.decision]}</Tag> : <Tag>未判定</Tag> },
            {
              title: '操作',
              width: 220,
              render: (_, r) => (
                <Space wrap onClick={(e) => e.stopPropagation()}>
                  <Upload
                    accept=".pdf"
                    showUploadList={false}
                    customRequest={async (options) => {
                      const file = options.file as File;
                      try {
                        setUploadingId(r.id);
                        await api.uploadDocument(r.id, file);
                        message.success('PDF 已上传');
                        await load();
                        options.onSuccess?.({});
                      } catch (e) {
                        message.error(e instanceof Error ? e.message : String(e));
                        options.onError?.(e as Error);
                      } finally {
                        setUploadingId(null);
                      }
                    }}
                  >
                    <Button size="small" icon={<UploadOutlined />} loading={uploadingId === r.id}>上传</Button>
                  </Upload>
                  <Button
                    size="small"
                    icon={r.documentState === 'failed' ? <ReloadOutlined /> : <SyncOutlined />}
                    disabled={!r.documentState || r.documentState === 'converting'}
                    onClick={() => void convert(r.id)}
                  >
                    {r.documentState === 'failed' ? '重试' : r.documentState === 'converting' ? '转换中' : '转换'}
                  </Button>
                  <Popconfirm title="删除该条目？将同时删除其全文文件与提取数据" onConfirm={() => void removeRef(r.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Card title="文献全文" style={{ width: 560, flexShrink: 0, position: 'sticky', top: 16, maxHeight: 'calc(100vh - 100px)', overflow: 'auto' }}>
        {!selected ? (
          <Empty description="点击左侧文献查看全文并判定" style={{ padding: '40px 0' }} />
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <div>
              <Typography.Text strong style={{ fontSize: 15 }}>{selected.title}</Typography.Text>
              <div style={{ marginTop: 4 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {selected.authors.join('、')}
                  {[selected.year, selected.journal].filter(Boolean).length ? ' · ' + [selected.year, selected.journal].filter(Boolean).join(' · ') : ''}
                </Typography.Text>
              </div>
            </div>

            <Space wrap>
              {detail?.doi && (
                <Button size="small" icon={<LinkOutlined />} onClick={() => window.open(`https://doi.org/${detail.doi}`, '_blank', 'noopener,noreferrer')}>DOI</Button>
              )}
              {detail?.pmid && (
                <Button size="small" icon={<LinkOutlined />} onClick={() => window.open(`https://pubmed.ncbi.nlm.nih.gov/${detail.pmid}/`, '_blank', 'noopener,noreferrer')}>PubMed</Button>
              )}
              <Button size="small" icon={<GlobalOutlined />} onClick={() => window.open(`https://scholar.google.com/scholar?q=${encodeURIComponent(selected.title)}`, '_blank', 'noopener,noreferrer')}>Google Scholar</Button>
            </Space>

            {detail?.abstract && (
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, maxHeight: 120, overflow: 'auto', marginBottom: 0 }}>
                <strong>摘要：</strong>{detail.abstract}
              </Typography.Paragraph>
            )}

            <Space wrap>
              <Button size="small" type={tab === 'md' ? 'primary' : 'default'} icon={<FileTextOutlined />} disabled={selected.documentState !== 'done'} onClick={() => setTab('md')}>查看MD</Button>
              <Button size="small" icon={<FilePdfOutlined />} disabled={!selected.documentState} onClick={() => window.open(`/api/references/${selected.id}/document/file`, '_blank')}>查看PDF</Button>
              <Button size="small" icon={<RobotOutlined />} disabled={selected.documentState !== 'done'} loading={suggestingId === selected.id} onClick={() => void suggest(selected.id)}>AI 建议</Button>
            </Space>

            {selected.aiSuggestion && (
              <div>
                <Tag color={DECISION_COLORS[selected.aiSuggestion]}>AI：{DECISION_LABELS[selected.aiSuggestion]}</Tag>
                {selected.aiReason && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{selected.aiReason}</Typography.Text>}
              </div>
            )}

            {tab === 'md' && selected.documentState === 'done' && (
              <div className="markdown-body" style={{ maxHeight: '60vh', overflow: 'auto', padding: '8px 12px', border: '1px solid #f0f0f0', borderRadius: 8, fontSize: 13, lineHeight: 1.7 }}>
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {markdown || '（加载中或尚未转换）'}
                </ReactMarkdown>
              </div>
            )}

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

      <Modal title="全文 AI 设置" open={ftAiModal} onCancel={() => setFtAiModal(false)} onOk={() => void saveFtPrompt()} okText="保存" cancelText="取消" width={720}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Text strong>全文系统提示词</Typography.Text>
            <Button size="small" icon={<RobotOutlined />} onClick={() => void genFtPrompt()}>根据协议自动生成（全文版）</Button>
          </Space>
          <TextArea rows={14} style={{ fontFamily: 'monospace', fontSize: 12 }} value={ftPrompt} onChange={(e) => setFtPrompt(e.target.value)} />
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
            全文 AI 建议使用项目初筛模型 + 这里的全文提示词；留空则用内置全文提示词。
          </Typography.Paragraph>
        </Space>
      </Modal>

      <ExclusionReasonsModal projectId={projectId} open={reasonsModal} onClose={() => setReasonsModal(false)} onSaved={() => void loadReasons()} />
    </div>
  );
}
