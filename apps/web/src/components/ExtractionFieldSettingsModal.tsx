import { useEffect, useState } from 'react';
import { Button, Checkbox, Divider, Input, Modal, Select, Space, Tag, Typography, message } from 'antd';
import { DeleteOutlined, PlusOutlined, RobotOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { FieldDef, FieldSection, FieldSettings } from '../types';

const LEVEL_OPTIONS = [
  { value: 'study', label: '论文级（一篇一条）' },
  { value: 'arm', label: '组级（每个处理组一条）' },
  { value: 'outcome', label: '结局级（每组每个结局一条）' },
];
const APPLIES_OPTIONS = [
  { value: 'all', label: '所有组' },
  { value: 'experiment', label: '仅实验组（非对照）' },
  { value: 'control', label: '仅对照组' },
];

export default function ExtractionFieldSettingsModal({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [sections, setSections] = useState<FieldSection[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      api.getFieldSettings(projectId).then((s) => setSections(s.sections)).catch(() => undefined);
    }
  }, [projectId, open]);

  const setSection = (i: number, patch: Partial<FieldSection>) =>
    setSections((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setField = (si: number, fi: number, patch: Partial<FieldDef>) =>
    setSections((s) => s.map((sec, j) => (j === si ? { ...sec, fields: sec.fields.map((f, k) => (k === fi ? { ...f, ...patch } : f)) } : sec)));
  const addField = (si: number) =>
    setSections((s) => s.map((sec, j) => (j === si ? { ...sec, fields: [...sec.fields, { key: `f_${Date.now()}`, label: '' }] } : sec)));
  const removeField = (si: number, fi: number) =>
    setSections((s) => s.map((sec, j) => (j === si ? { ...sec, fields: sec.fields.filter((_, k) => k !== fi) } : sec)));
  const addSection = () =>
    setSections((s) => [...s, { id: `sec_${Date.now()}`, name: '', level: 'arm', appliesTo: 'all', fields: [] }]);
  const removeSection = (si: number) => setSections((s) => s.filter((_, j) => j !== si));

  const generate = async () => {
    const g = await api.generateFieldSettings(projectId);
    setSections(g.sections);
    message.success('已生成默认分段字段');
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.saveFieldSettings(projectId, { sections });
      message.success('字段设置已保存');
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="字段提取设置" open={open} onCancel={onClose} onOk={() => void save()} okText="保存" cancelText="取消" confirmLoading={saving} width={760}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Button size="small" icon={<RobotOutlined />} onClick={() => void generate()}>按协议生成默认</Button>
        <Button size="small" icon={<PlusOutlined />} onClick={addSection}>添加分段</Button>
      </Space>

      <Space direction="vertical" size={12} style={{ width: '100%', maxHeight: '60vh', overflow: 'auto' }}>
        {sections.map((sec, si) => (
          <div key={sec.id} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12 }}>
            <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
              <Space wrap>
                <Input placeholder="段名" value={sec.name} onChange={(e) => setSection(si, { name: e.target.value })} style={{ width: 140 }} />
                <Select size="small" style={{ width: 200 }} value={sec.level} onChange={(v) => setSection(si, { level: v })} options={LEVEL_OPTIONS} />
                {sec.level === 'arm' && (
                  <Select size="small" style={{ width: 160 }} value={sec.appliesTo ?? 'all'} onChange={(v) => setSection(si, { appliesTo: v })} options={APPLIES_OPTIONS} />
                )}
                {sec.level === 'outcome' && (
                  <Checkbox checked={!!sec.repeatPerOutcome} onChange={(e) => setSection(si, { repeatPerOutcome: e.target.checked })}>按结局重复</Checkbox>
                )}
              </Space>
              <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeSection(si)}>删段</Button>
            </Space>

            <Divider style={{ margin: '10px 0' }} />
            {sec.level === 'outcome' && (sec.outcomes?.length ? (
              <div style={{ marginBottom: 8 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>结局（每个结局重复下面字段）：</Typography.Text>{' '}
                {sec.outcomes.map((o) => <Tag key={o}>{o}</Tag>)}
              </div>
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>结局列表：请先在①协议填写结局指标，再点「按协议生成默认」</Typography.Text>
            ))}
            {sec.fields.map((f, fi) => (
              <Space.Compact key={fi} style={{ width: '100%', marginBottom: 6 }}>
                <Input placeholder="字段名" value={f.label} onChange={(e) => setField(si, fi, { label: e.target.value })} style={{ width: 160 }} />
                <Input placeholder="说明（含单位）" value={f.description ?? ''} onChange={(e) => setField(si, fi, { description: e.target.value })} />
                <Button danger icon={<DeleteOutlined />} onClick={() => removeField(si, fi)} />
              </Space.Compact>
            ))}
            <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => addField(si)}>添加字段</Button>
          </div>
        ))}
        {sections.length === 0 && <Typography.Text type="secondary">暂无分段，点「添加分段」或「按协议生成默认」</Typography.Text>}
      </Space>
    </Modal>
  );
}
