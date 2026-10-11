import { Card, Space, Typography } from 'antd';

const { Title, Paragraph, Text } = Typography;

export default function HelpPage() {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card>
        <Title level={4} style={{ marginTop: 0 }}>使用手册</Title>
        <Paragraph type="secondary">
          本系统按固定流程辅助完成 Meta 分析的文献筛选与数据提取。AI 只提供建议，纳入/排除均由研究者人工拍板。
        </Paragraph>
      </Card>

      <Card title="1. 快速开始">
        <Paragraph>
          1) 在左侧「新建项目」输入项目名称创建项目；<br />
          2) 按 ①–⑥ 六个标签页依次推进；<br />
          3) 右侧「项目 Agent」可随时对话、生成检索式/提取表等。
        </Paragraph>
      </Card>

      <Card title="2. ① 协议制定">
        <Paragraph>
          填写研究目的、PICO、纳入/排除标准、结局指标。可让 AI 生成协议草案后人工修改，并可导出注册文本。
        </Paragraph>
      </Card>

      <Card title="3. ② 检索策略 + 文献导入">
        <Paragraph>
          新建项目会自动预置 PubMed、Web of Science、CNKI、万方四个来源库；也可自行添加或删除来源库。
        </Paragraph>
        <Paragraph>
          每个来源库下可创建多条检索式（即多个“版本”）。导入文献必须绑定某条检索式；支持 RIS、PubMed/MEDLINE、BibTeX 三种题录格式（文件或粘贴）。
        </Paragraph>
        <Paragraph>
          导入阶段<Text strong>不做去重</Text>；所有条目先原样入库，去重合并统一在 ③ 初筛判断完成。
        </Paragraph>
      </Card>

      <Card title="4. ③ 初筛判断（去重合并 + 审阅）">
        <Paragraph>
          进入 ③ 会自动按 DOI/标题去重合并，保留最早导入的那条作为主条目；重复条目默认隐藏、只读。
        </Paragraph>
        <Paragraph>
          审阅表采用多列大表：AI 给出「是否可接受 + 理由」，研究者给出「纳入/排除/待定 + 排除理由 + 备注」。
        </Paragraph>
        <Paragraph>
          「批量建议」默认跳过已有 AI 建议的条目；「全部重判」会重新判断所有待筛主条目。「接受 AI」支持单条、勾选、全局三种方式。
        </Paragraph>
        <Paragraph>
          排除理由可在 ③「排除理由设置」中按项目增删改。
        </Paragraph>
      </Card>

      <Card title="5. ④ 全文筛选">
        <Paragraph>
          对初筛纳入的文献上传 PDF，系统调用 MinerU 转为 Markdown 后查看全文；AI 给全文建议，研究者人工判定纳入/排除。
        </Paragraph>
      </Card>

      <Card title="6. ⑤ 数据提取">
        <Paragraph>
          先定义提取字段表（可手动或与 AI 讨论生成）；再逐篇让 AI 按字段表提取文本/表格数据。
        </Paragraph>
        <Paragraph>
          图表数据 AI 不猜测，只标记“待人工提取”；需研究者在图表工具或外部工具中取点后回填。
        </Paragraph>
      </Card>

      <Card title="7. ⑥ 结果">
        <Paragraph>
          查看 PRISMA 流程与排除理由汇总、来源库统计、已提取数据表，并导出 CSV。
        </Paragraph>
      </Card>

      <Card title="8. 设置">
        <Paragraph>
          配置大模型 Provider（可多个）；指定「项目 Agent 默认模型」和「筛选专用模型」；配置 MinerU Token 并测试连通性。
        </Paragraph>
      </Card>

      <Card title="9. 项目 Agent">
        <Paragraph>
          项目 Agent 能感知当前项目的协议、检索式、提取字段、来源统计与排除理由，可生成检索式/提取表等；生成结果以“待确认”卡片呈现，确认后才会写入。
        </Paragraph>
        <Paragraph>
          发送后可点「停止」终止生成；每条消息可删除（删除该条及其后所有消息）。
        </Paragraph>
      </Card>
    </Space>
  );
}
