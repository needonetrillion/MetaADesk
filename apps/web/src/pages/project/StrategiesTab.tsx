import { useEffect, useState } from 'react';
import {
  Button,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  RobotOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { api } from '../../api';
import { onDataChanged } from '../../events';
import type {
  ImportBatch,
  ProjectSource,
  SearchSkill,
  StrategyWithDatabase,
} from '../../types';

const { TextArea } = Input;

export default function StrategiesTab({ projectId }: { projectId: string }) {
  const [sources, setSources] = useState<ProjectSource[]>([]);
  const [presets, setPresets] = useState<Array<{ presetKey?: string; name: string; url?: string; note?: string }>>([]);
  const [skills, setSkills] = useState<SearchSkill[]>([]);
  const [strategies, setStrategies] = useState<StrategyWithDatabase[]>([]);
  const [batches, setBatches] = useState<ImportBatch[]>([]);

  const [sourceModal, setSourceModal] = useState(false);
  const [sourceName, setSourceName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceNote, setSourceNote] = useState('');
  const [sourcePreset, setSourcePreset] = useState<string>();

  const [strategyModal, setStrategyModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [databaseId, setDatabaseId] = useState<string>();
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState('');
  const [aiGenerated, setAiGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  const [importStrategy, setImportStrategy] = useState<StrategyWithDatabase | null>(null);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);

  const load = async () => {
    try {
      const [s, p, sk, str, b] = await Promise.all([
        api.getDatabases(projectId),
        api.getDatabasePresets(),
        api.getSearchSkills(),
        api.getStrategies(projectId),
        api.getImportBatches(projectId),
      ]);
      setSources(s);
      setPresets(p);
      setSkills(sk);
      setStrategies(str);
      setBatches(b);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => onDataChanged('strategies', () => void load()), [projectId]);

  const currentSkill = skills.find((s) => s.id === databaseId) ??
    skills.find((s) => s.name.toLowerCase() === (sources.find((x) => x.id === databaseId)?.name ?? '').toLowerCase());

  const openAddSource = () => {
    setSourceModal(true);
    setSourceName('');
    setSourceUrl('');
    setSourceNote('');
    setSourcePreset(undefined);
  };

  const addSource = async () => {
    if (!sourceName.trim()) return message.warning('请输入数据库名称');
    try {
      const preset = presets.find((p) => p.presetKey === sourcePreset);
      await api.addDatabase(projectId, {
        name: sourceName.trim(),
        url: sourceUrl || preset?.url || undefined,
        note: sourceNote || preset?.note || undefined,
        presetKey: sourcePreset,
      });
      message.success('来源库已添加');
      setSourceModal(false);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const removeSource = async (id: string) => {
    try {
      await api.deleteDatabase(projectId, id);
      message.success('已删除该来源库及其条目');
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const openAddStrategy = () => {
    setEditingId(null);
    setDatabaseId(undefined);
    setQuery('');
    setNotes('');
    setAiGenerated(false);
    setStrategyModal(true);
  };

  const openEditStrategy = (s: StrategyWithDatabase) => {
    setEditingId(s.id);
    setDatabaseId(s.databaseId);
    setQuery(s.query);
    setNotes(s.notes ?? '');
    setAiGenerated(s.generatedBy === 'ai');
    setStrategyModal(true);
  };

  const generate = async () => {
    if (!databaseId) return message.warning('请先选择来源库');
    setGenerating(true);
    try {
      const r = await api.generateStrategy(projectId, databaseId);
      setQuery(r.query);
      setNotes(r.notes ?? '');
      setAiGenerated(true);
      message.success('已生成，请核对后可保存');
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const saveStrategy = async () => {
    if (!databaseId) return message.warning('请选择来源库');
    if (!query.trim()) return message.warning('检索式不能为空');
    setSaving(true);
    try {
      if (editingId) {
        await api.updateStrategy(editingId, { query, notes });
      } else {
        await api.createStrategy(projectId, { databaseId, query, notes, generatedBy: aiGenerated ? 'ai' : 'manual' });
      }
      message.success('已保存');
      setStrategyModal(false);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const removeStrategy = async (id: string) => {
    try {
      await api.deleteStrategy(id);
      message.success('已删除该检索式及其导入条目');
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success('已复制检索式');
    } catch {
      message.error('复制失败');
    }
  };

  const importNow = async (strategyId: string, text: string, format?: 'ris' | 'medline' | 'bibtex') => {
    if (!text.trim()) return message.warning('请粘贴题录文本');
    setImporting(true);
    try {
      const r = await api.importReferences(projectId, text.trim(), { strategyId, format });
      message.success(`已导入 ${r.imported} 条原始记录（尚未去重）`);
      setImportText('');
      setImportStrategy(null);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const importFile = async (strategyId: string, file: File) => {
    try {
      const r = await api.importReferencesFile(projectId, file, strategyId);
      message.success(`已导入 ${r.imported} 条原始记录（尚未去重）`);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const removeBatch = async (id: string) => {
    try {
      await api.deleteImportBatch(id);
      message.success('已撤销该批次');
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space wrap>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAddSource}>添加来源库</Button>
        <Button icon={<PlusOutlined />} onClick={openAddStrategy}>添加检索式</Button>
      </Space>

      <Table<ProjectSource>
        rowKey="id"
        dataSource={sources}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '尚未添加来源库。点击上方「添加来源库」从预设或自定义添加' }}
        columns={[
          { title: '来源库', dataIndex: 'name' },
          { title: '预设', dataIndex: 'presetKey', width: 100, render: (v: string) => v ? <Tag color="blue">{v}</Tag> : <Tag>自定义</Tag> },
          { title: '检索式数', dataIndex: 'strategyCount', width: 100 },
          {
            title: '操作',
            width: 180,
            render: (_, s) => (
              <Space>
                <Button size="small" icon={<PlusOutlined />} onClick={() => { setDatabaseId(s.id); setEditingId(null); setQuery(''); setNotes(''); setAiGenerated(false); setStrategyModal(true); }}>加检索式</Button>
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeSource(s.id)}>删除库</Button>
              </Space>
            ),
          },
        ]}
      />

      <Table<StrategyWithDatabase>
        rowKey="id"
        dataSource={strategies}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '暂无检索式' }}
        columns={[
          { title: '数据库', dataIndex: 'databaseName', width: 140 },
          { title: '检索式', dataIndex: 'query', ellipsis: true, render: (q: string) => <Typography.Text code ellipsis={{ tooltip: q }} style={{ maxWidth: 420 }}>{q}</Typography.Text> },
          { title: '已导入', dataIndex: 'importedCount', width: 80, render: (n: number) => <Tag color={n > 0 ? 'green' : 'default'}>{n}</Tag> },
          { title: '来源', dataIndex: 'generatedBy', width: 80, render: (v: string) => v === 'ai' ? <Tag color="blue">AI</Tag> : <Tag>手动</Tag> },
          {
            title: '操作',
            width: 300,
            render: (_, s) => (
              <Space wrap>
                <Button size="small" icon={<CopyOutlined />} onClick={() => void copy(s.query)}>复制</Button>
                <Upload accept=".ris,.txt,.bib,.bibtex" showUploadList={false} customRequest={async (options) => { const f = options.file as File; await importFile(s.id, f); options.onSuccess?.({}); }}>
                  <Button size="small" icon={<UploadOutlined />}>导入文件</Button>
                </Upload>
                <Button size="small" icon={<EditOutlined />} onClick={() => setImportStrategy(s)}>导入文本</Button>
                <Button size="small" icon={<EditOutlined />} onClick={() => openEditStrategy(s)}>编辑</Button>
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => void removeStrategy(s.id)}>删除</Button>
              </Space>
            ),
          },
        ]}
      />

      {batches.length > 0 && (
        <Table<ImportBatch>
          rowKey="id"
          size="small"
          dataSource={batches}
          pagination={false}
          scroll={{ x: 'max-content' }}
          title={() => <Typography.Text strong>导入批次（可撤销）</Typography.Text>}
          columns={[
            { title: '数据库', dataIndex: 'databaseName', render: (v: string) => v ?? '—' },
            { title: '导入数', dataIndex: 'importedCount', width: 90 },
            { title: '时间', dataIndex: 'createdAt', render: (v: string) => new Date(v).toLocaleString() },
            { title: '操作', width: 80, render: (_, b) => <Button size="small" danger onClick={() => void removeBatch(b.id)}>撤销</Button> },
          ]}
        />
      )}

      <Modal title="添加来源库" open={sourceModal} onCancel={() => setSourceModal(false)} onOk={() => void addSource()} okText="添加" cancelText="取消">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Select
            placeholder="从预设选择（可选）"
            style={{ width: '100%' }}
            value={sourcePreset}
            onChange={(v) => {
              setSourcePreset(v);
              const p = presets.find((x) => x.presetKey === v);
              if (p) { setSourceName(p.name); setSourceUrl(p.url ?? ''); setSourceNote(p.note ?? ''); }
            }}
            allowClear
            options={presets.map((p) => ({ value: p.presetKey, label: p.name }))}
          />
          <Input placeholder="数据库名称" value={sourceName} onChange={(e) => setSourceName(e.target.value)} />
          <Input placeholder="网址（可选）" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
          <Input placeholder="备注（可选）" value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} />
        </Space>
      </Modal>

      <Modal title={editingId ? '编辑检索式' : '添加检索式'} open={strategyModal} onCancel={() => setStrategyModal(false)} onOk={() => void saveStrategy()} okText="保存" cancelText="取消" confirmLoading={saving} width={680}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Select
            placeholder="选择来源库"
            style={{ width: '100%' }}
            value={databaseId}
            onChange={setDatabaseId}
            disabled={!!editingId}
            options={sources.map((s) => ({ value: s.id, label: s.name }))}
          />
          {currentSkill && (
            <div style={{ padding: 8, background: '#fafafa', borderRadius: 6, fontSize: 12, color: '#666' }}>
              <div><b>字段：</b>{currentSkill.fieldSyntax}</div>
              <div style={{ marginTop: 4 }}><b>同义词 OR：</b>{currentSkill.orWithinField}</div>
            </div>
          )}
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Text strong>检索式</Typography.Text>
            <Button size="small" icon={<RobotOutlined />} loading={generating} onClick={() => void generate()} disabled={!!editingId}>AI 生成</Button>
          </Space>
          <TextArea rows={6} style={{ fontFamily: 'monospace' }} value={query} onChange={(e) => { setQuery(e.target.value); setAiGenerated(false); }} placeholder="粘贴或 AI 生成" />
          <Input placeholder="备注（可选）" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Space>
      </Modal>

      <Modal title={`导入题录 · ${importStrategy?.databaseName ?? ''}`} open={!!importStrategy} onCancel={() => setImportStrategy(null)} onOk={() => importStrategy && void importNow(importStrategy.id, importText)} okText="导入" cancelText="取消" confirmLoading={importing} width={680}>
        <Upload.Dragger accept=".ris,.txt,.bib,.bibtex" showUploadList={false} multiple={false} beforeUpload={(f) => { f.text().then((t) => { setImportText(t); message.info(`已读取 ${f.name}`); }); return false; }}>
          <p className="ant-upload-drag-icon"><UploadOutlined /></p>
          <p className="ant-upload-text">点击或拖拽题录文件</p>
        </Upload.Dragger>
        <TextArea rows={8} style={{ marginTop: 12, fontFamily: 'monospace', fontSize: 12 }} placeholder="或粘贴 RIS / MEDLINE / BibTeX" value={importText} onChange={(e) => setImportText(e.target.value)} />
      </Modal>
    </Space>
  );
}
