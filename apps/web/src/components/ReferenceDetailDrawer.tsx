import { useEffect, useState } from 'react';
import { Button, Drawer, Space, Spin, Tag, Typography } from 'antd';
import { GlobalOutlined, LinkOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { ReferenceDetail } from '../types';

const { Paragraph, Text } = Typography;

function Field({ label, value }: { label: string; value?: string | number }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{label}</Text>
      <Text style={{ wordBreak: 'break-word' }}>{value}</Text>
    </div>
  );
}

export default function ReferenceDetailDrawer({
  referenceId,
  onClose,
}: {
  referenceId: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<ReferenceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!referenceId) {
      setDetail(null);
      setError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    setDetail(null);
    api
      .getReferenceDetail(referenceId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [referenceId]);

  return (
    <Drawer
      title="文献详情"
      open={!!referenceId}
      onClose={onClose}
      width={520}
      destroyOnClose
    >
      {loading && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      )}
      {!loading && error && (
        <Paragraph type="secondary">{error || '文献不存在或加载失败'}</Paragraph>
      )}
      {!loading && !error && detail && (
        <div>
          <Text strong style={{ fontSize: 16 }}>{detail.title}</Text>

          <div style={{ margin: '12px 0' }}>
            <Space wrap>
              {detail.doi && (
                <Button
                  size="small"
                  icon={<LinkOutlined />}
                  onClick={() => window.open(`https://doi.org/${detail.doi}`, '_blank')}
                >
                  DOI
                </Button>
              )}
              {detail.pmid && (
                <Button
                  size="small"
                  icon={<LinkOutlined />}
                  onClick={() => window.open(`https://pubmed.ncbi.nlm.nih.gov/${detail.pmid}/`, '_blank')}
                >
                  PubMed
                </Button>
              )}
              <Button
                size="small"
                icon={<GlobalOutlined />}
                onClick={() =>
                  window.open(`https://scholar.google.com/scholar?q=${encodeURIComponent(detail.title)}`, '_blank')
                }
              >
                Google Scholar
              </Button>
            </Space>
          </div>

          <Field label="作者" value={detail.authors.join('、')} />
          <Field label="期刊" value={detail.journal} />
          <Field label="年份" value={detail.year} />
          <Field label="DOI" value={detail.doi} />
          <Field label="PMID" value={detail.pmid} />
          <Field label="URL" value={detail.url} />
          <Field label="来源库" value={detail.sourceName} />

          <div style={{ marginTop: 12 }}>
            <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>摘要</Text>
            <div style={{ maxHeight: '45vh', overflow: 'auto', marginTop: 4 }}>
              {detail.abstract ? (
                <Paragraph style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {detail.abstract}
                </Paragraph>
              ) : (
                <Tag>无摘要</Tag>
              )}
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}
