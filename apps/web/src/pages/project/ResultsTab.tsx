import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Descriptions,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '../../api';
import type {
  ExtractionFieldDef,
  PrismaSummary,
  ReasonCount,
  ResultsRow,
  SourceStat,
  StageReasonSummary,
} from '../../types';

export default function ResultsTab({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<ResultsRow[]>([]);
  const [template, setTemplate] = useState<ExtractionFieldDef[]>([]);
  const [prisma, setPrisma] = useState<PrismaSummary | null>(null);
  const [sourceStats, setSourceStats] = useState<SourceStat[]>([]);

  const load = async () => {
    try {
      const [r, t, p, s] = await Promise.all([
        api.getExtractions(projectId),
        api.getExtractionTemplate(projectId),
        api.getPrismaSummary(projectId),
        api.getSourceStats(projectId),
      ]);
      setRows(r);
      setTemplate(t ?? []);
      setPrisma(p);
      setSourceStats(s);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const columns = useMemo(() => {
    return [
      {
        title: '标题',
        dataIndex: 'title',
        fixed: 'left' as const,
        width: 220,
        render: (t: string) => (
          <Typography.Text strong ellipsis={{ tooltip: t }} style={{ maxWidth: 200 }}>{t}</Typography.Text>
        ),
      },
      { title: '年份', dataIndex: 'year', width: 80 },
      ...template.map((f) => ({
        title: f.label,
        width: 150,
        render: (_: unknown, r: ResultsRow) => r.values[f.key] || '—',
      })),
    ];
  }, [template]);

  const exportCSV = async () => {
    try {
      const { csv } = await api.exportResults(projectId);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'extraction-results.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const reasonColumns = [
    { title: '排除理由', dataIndex: 'label' },
    { title: '篇数', dataIndex: 'count', width: 90, align: 'right' as const },
  ];

  const reasonCard = (title: string, summary?: StageReasonSummary) => (
    <Card size="small" title={title} style={{ height: '100%' }}>
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Typography.Text type="secondary">
          已排除 {summary?.excluded ?? 0} 篇
          {summary && summary.withoutReason > 0 ? `（其中 ${summary.withoutReason} 篇未填写理由）` : ''}
        </Typography.Text>
        <Table<ReasonCount>
          rowKey="code"
          size="small"
          pagination={false}
          scroll={{ x: 'max-content' }}
          dataSource={summary?.reasons ?? []}
          columns={reasonColumns}
          locale={{ emptyText: '暂无排除理由记录' }}
        />
      </Space>
    </Card>
  );

  const exportPrisma = () => {
    if (!prisma) return;
    const f = prisma.flow;
    const lines: string[] = [];
    lines.push('PRISMA 流程汇总');
    lines.push(`识别到的记录总数,${f.total}`);
    lines.push(`去重剔除,${f.duplicatesRemoved}`);
    lines.push(`进入题摘初筛,${f.screened}`);
    lines.push(`题摘初筛排除,${f.tasExcluded}`);
    lines.push(`题摘初筛纳入,${f.tasIncluded}`);
    lines.push(`全文评估,${f.fulltextAssessed}`);
    lines.push(`全文排除,${f.ftExcluded}`);
    lines.push(`全文纳入,${f.ftIncluded}`);
    lines.push(`完成数据提取,${f.extracted}`);
    lines.push('');
    lines.push('阶段,排除理由,篇数');
    for (const s of [prisma.exclusion.titleAbstract, prisma.exclusion.fulltext]) {
      const stage = s.stage === 'title_abstract' ? '题摘初筛' : '全文筛选';
      for (const r of s.reasons) lines.push(`${stage},${r.label},${r.count}`);
      if (s.withoutReason > 0) lines.push(`${stage},未填写理由,${s.withoutReason}`);
    }
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prisma-summary.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title="PRISMA 流程与排除理由汇总"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
            <Button icon={<DownloadOutlined />} disabled={!prisma} onClick={exportPrisma}>
              导出汇总
            </Button>
          </Space>
        }
      >
        {!prisma ? (
          <Typography.Text type="secondary">加载中…</Typography.Text>
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Row gutter={[16, 16]}>
              <Col xs={12} md={6} lg={4}>
                <Statistic title="识别记录" value={prisma.flow.total} />
              </Col>
              <Col xs={12} md={6} lg={4}>
                <Statistic title="去重剔除" value={prisma.flow.duplicatesRemoved} />
              </Col>
              <Col xs={12} md={6} lg={4}>
                <Statistic title="进入初筛" value={prisma.flow.screened} />
              </Col>
              <Col xs={12} md={6} lg={4}>
                <Statistic title="题摘排除" value={prisma.flow.tasExcluded} />
              </Col>
              <Col xs={12} md={6} lg={4}>
                <Statistic title="题摘纳入" value={prisma.flow.tasIncluded} />
              </Col>
              <Col xs={12} md={6} lg={4}>
                <Statistic title="全文评估" value={prisma.flow.fulltextAssessed} />
              </Col>
              <Col xs={12} md={6} lg={4}>
                <Statistic title="全文排除" value={prisma.flow.ftExcluded} />
              </Col>
              <Col xs={12} md={6} lg={4}>
                <Statistic title="全文纳入" value={prisma.flow.ftIncluded} />
              </Col>
              <Col xs={12} md={6} lg={4}>
                <Statistic title="完成提取" value={prisma.flow.extracted} />
              </Col>
            </Row>

            <Descriptions size="small" column={{ xs: 1, sm: 3 }} bordered>
              <Descriptions.Item label="待初筛">
                <Tag color={prisma.flow.awaitingScreening > 0 ? 'orange' : 'default'}>
                  {prisma.flow.awaitingScreening} 篇
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="待全文上传/判定">
                <Tag color={prisma.flow.awaitingFulltext > 0 ? 'orange' : 'default'}>
                  {prisma.flow.awaitingFulltext} 篇
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="待数据提取">
                <Tag color={prisma.flow.awaitingExtraction > 0 ? 'orange' : 'default'}>
                  {prisma.flow.awaitingExtraction} 篇
                </Tag>
              </Descriptions.Item>
            </Descriptions>

            <Row gutter={[16, 16]}>
              <Col xs={24} lg={12}>
                {reasonCard('题摘初筛排除理由', prisma.exclusion.titleAbstract)}
              </Col>
              <Col xs={24} lg={12}>
                {reasonCard('全文筛选排除理由', prisma.exclusion.fulltext)}
              </Col>
            </Row>
          </Space>
        )}
      </Card>

      <Card title="来源库统计" extra={<Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>}>
        <Table<SourceStat>
          rowKey="sourceId"
          size="small"
          dataSource={sourceStats}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: '暂无来源库统计' }}
          columns={[
            { title: '来源库', dataIndex: 'name' },
            { title: '原始命中', dataIndex: 'rawImported', align: 'right' },
            { title: '唯一贡献', dataIndex: 'uniqueKept', align: 'right' },
            { title: '重复剔除', dataIndex: 'duplicateRemoved', align: 'right' },
          ]}
        />
      </Card>

      <Card
        title={`数据结果（${rows.length} 篇已提取）`}
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
            <Button type="primary" icon={<DownloadOutlined />} onClick={() => void exportCSV()}>导出 CSV</Button>
          </Space>
        }
      >
        {template.length === 0 ? (
          <Typography.Text type="secondary">
            尚未定义提取字段表，请先在「⑤ 提取」中生成/保存字段表。
          </Typography.Text>
        ) : (
          <Table<ResultsRow>
            rowKey="referenceId"
            dataSource={rows}
            scroll={{ x: 'max-content' }}
            pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 篇` }}
            locale={{ emptyText: '暂无提取结果。请先在「⑤ 提取」中执行 AI 提取' }}
            columns={columns}
            expandable={{
              expandedRowRender: (r) => (
                <div>
                  <Typography.Text strong>图表</Typography.Text>
                  {r.figures.length === 0 ? (
                    <Typography.Text type="secondary">（无）</Typography.Text>
                  ) : (
                    r.figures.map((f) => (
                      <div key={f.id}>
                        <Tag color="blue">第 {f.index} 幅图</Tag>
                        {f.caption && <Typography.Text type="secondary">{f.caption} </Typography.Text>}
                        {f.status === 'extracted' ? (
                          <Tag color="green">已提取{f.extractedValueNote ? `：${f.extractedValueNote}` : ''}</Tag>
                        ) : f.status === 'pending' ? (
                          <Tag color="orange">待人工提取</Tag>
                        ) : (
                          <Tag>已跳过</Tag>
                        )}
                      </div>
                    ))
                  )}
                </div>
              ),
            }}
          />
        )}
      </Card>
    </Space>
  );
}
