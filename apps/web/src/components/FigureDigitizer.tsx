import { useRef, useState } from 'react';
import { Button, Input, Modal, Space, Typography, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';

interface Pt {
  x: number;
  y: number;
  value?: number;
}

export default function FigureDigitizer({
  open,
  onClose,
  onResult,
}: {
  open: boolean;
  onClose: () => void;
  onResult: (v: { mean?: number; sd?: number }) => void;
}) {
  const [src, setSrc] = useState('');
  const [calib, setCalib] = useState<[Pt, Pt] | null>(null);
  const [calibPts, setCalibPts] = useState<Pt[]>([]);
  const [mean, setMean] = useState<Pt | null>(null);
  const [endpoint, setEndpoint] = useState<Pt | null>(null);
  const [v1, setV1] = useState('');
  const [v2, setV2] = useState('');
  const svgRef = useRef<SVGSVGElement>(null);

  const reset = () => { setCalib(null); setCalibPts([]); setMean(null); setEndpoint(null); };

  const toValue = (y: number): number | null => {
    if (!calib || !v1 || !v2) return null;
    const c1 = Number(v1);
    const c2 = Number(v2);
    if (Number.isNaN(c1) || Number.isNaN(c2)) return null;
    const dy = calib[1].y - calib[0].y;
    if (dy === 0 || c2 === c1) return null;
    const k = (c2 - c1) / dy;
    return c1 + (y - calib[0].y) * k;
  };

  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (!calib) {
      const next = [...calibPts, { x, y }];
      if (next.length === 2) {
        setCalib([next[0]!, next[1]!]);
        setCalibPts([]);
      } else {
        setCalibPts(next);
      }
      return;
    }
    if (!mean) setMean({ x, y });
    else if (!endpoint) setEndpoint({ x, y });
  };

  const finish = () => {
    if (!mean) return message.warning('请先点均值点');
    if (!endpoint) return message.warning('请再点误差棒端点（得到 SD/SE）');
    const m = toValue(mean.y);
    const e = toValue(endpoint.y);
    if (m === null || e === null) return message.warning('请先完成 Y 轴校准并填写两个参考值');
    if (!Number.isFinite(m) || !Number.isFinite(e)) return message.warning('校准数值有误，请检查参考值');
    const sd = Math.abs(e - m);
    onResult({ mean: m, sd });
    message.success('已取点');
    onClose();
  };

  return (
    <Modal title="图表取点工具" open={open} onCancel={onClose} onOk={finish} okText="完成取点" width={760} destroyOnClose>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap>
          <Input
            placeholder="图表图片 URL（可粘贴）"
            style={{ width: 320 }}
            value={src}
            onChange={(e) => setSrc(e.target.value)}
            onPressEnter={() => reset()}
          />
          <label>
            <Button icon={<UploadOutlined />} onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*';
              input.onchange = () => {
                const f = input.files?.[0];
                if (f) { setSrc(URL.createObjectURL(f)); reset(); }
              };
              input.click();
            }}>上传图片</Button>
          </label>
          <Button onClick={reset}>重置</Button>
        </Space>

        {src && (
          <div style={{ position: 'relative' }}>
            <svg ref={svgRef} width="100%" height={480} style={{ border: '1px solid #eee', cursor: 'crosshair' }} onClick={onClick}>
              <image href={src} width="100%" height={480} preserveAspectRatio="xMidYMid meet" />
              {calibPts.map((p, i) => <circle key={`c${i}`} cx={p.x} cy={p.y} r={5} fill="blue" />)}
              {calib?.map((p, i) => <circle key={`b${i}`} cx={p.x} cy={p.y} r={5} fill="blue" />)}
              {mean && <circle cx={mean.x} cy={mean.y} r={6} fill="red" />}
              {endpoint && <circle cx={endpoint.x} cy={endpoint.y} r={6} fill="orange" />}
            </svg>
          </div>
        )}

        {!calib && src && <Typography.Text>请点击图上两个参考点做 Y 轴校准</Typography.Text>}
        {calib && (
          <Space>
            <Typography.Text>参考值 1：</Typography.Text>
            <Input style={{ width: 100 }} value={v1} onChange={(e) => setV1(e.target.value)} />
            <Typography.Text>参考值 2：</Typography.Text>
            <Input style={{ width: 100 }} value={v2} onChange={(e) => setV2(e.target.value)} />
            <Typography.Text type="secondary">（两参考点的真实 Y 值，如 0 和 100）</Typography.Text>
          </Space>
        )}
        {calib && <Typography.Text>点击红色均值点，再点橙色误差棒端点（得到 SD/SE）</Typography.Text>}
      </Space>
    </Modal>
  );
}
