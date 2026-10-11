import { useEffect, useState } from 'react';
import { Space, Tabs, Typography } from 'antd';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import ProtocolTab from './project/ProtocolTab';
import StrategiesTab from './project/StrategiesTab';
import ScreeningTab from './project/ScreeningTab';
import FulltextTab from './project/FulltextTab';
import ExtractionTab from './project/ExtractionTab';
import ResultsTab from './project/ResultsTab';

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [name, setName] = useState('');

  useEffect(() => {
    if (!id) return;
    api.getProject(id).then((p) => setName(p.name)).catch(() => undefined);
  }, [id]);

  if (!id) return null;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {name || '项目详情'}
      </Typography.Title>

      <Tabs
        destroyOnHidden
        items={[
          { key: 'protocol', label: '① 协议制定', children: <ProtocolTab projectId={id} /> },
          { key: 'search', label: '② 检索策略', children: <StrategiesTab projectId={id} /> },
          { key: 'screen', label: '③ 初筛判断', children: <ScreeningTab projectId={id} /> },
          { key: 'fulltext', label: '④ 全文判断', children: <FulltextTab projectId={id} /> },
          { key: 'extract', label: '⑤ 全文数据提取', children: <ExtractionTab projectId={id} /> },
          { key: 'results', label: '⑥ 结果', children: <ResultsTab projectId={id} /> },
        ]}
      />
    </Space>
  );
}
