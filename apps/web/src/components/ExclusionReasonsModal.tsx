import { useEffect, useState } from 'react';
import { Button, Input, Modal, Space, message } from 'antd';
import { DeleteOutlined, PlusOutlined, RobotOutlined } from '@ant-design/icons';
import { api } from '../api';

interface Row {
  id?: string;
  label: string;
}

export default function ExclusionReasonsModal({
  projectId,
  open,
  onClose,
  onSaved,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      api
        .getExclusionReasons(projectId)
        .then((r) => setRows(r.map((x) => ({ id: x.id, label: x.label }))))
        .catch((e) => message.error(e instanceof Error ? e.message : String(e)));
    }
  }, [projectId, open]);

  const setLabel = (i: number, label: string) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, label } : r)));

  const remove = (i: number) => setRows((prev) => prev.filter((_, j) => j !== i));

  const add = () => setRows((prev) => [...prev, { label: '' }]);

  const suggest = async () => {
    setSuggesting(true);
    try {
      const r = await api.suggestExclusionReasons(projectId);
      const existing = new Set(rows.map((x) => x.label.trim()));
      const merged = [...rows, ...r.reasons.filter((x) => x.trim() && !existing.has(x.trim())).map((label) => ({ label }))];
      setRows(merged);
      message.success('已加入 AI 建议的排除理由');
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggesting(false);
    }
  };

  const save = async () => {
    const valid = rows.map((r) => ({ id: r.id, label: r.label.trim() })).filter((r) => r.label);
    if (valid.length === 0) return message.warning('请至少保留一条排除理由');
    setSaving(true);
    try {
      await api.saveExclusionReasons(projectId, valid);
      message.success('排除理由已保存');
      onSaved?.();
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="排除理由设置"
      open={open}
      onCancel={onClose}
      onOk={() => void save()}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      width={560}
    >
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space wrap>
          <Button size="small" icon={<PlusOutlined />} onClick={add}>添加</Button>
          <Button size="small" icon={<RobotOutlined />} loading={suggesting} onClick={() => void suggest()}>AI 生成建议</Button>
        </Space>
        {rows.map((r, i) => (
          <Space.Compact key={i} style={{ width: '100%' }}>
            <Input
              value={r.label}
              onChange={(e) => setLabel(i, e.target.value)}
              placeholder="排除理由（如：研究设计不符）"
            />
            <Button icon={<DeleteOutlined />} danger onClick={() => remove(i)} />
          </Space.Compact>
        ))}
      </Space>
    </Modal>
  );
}
