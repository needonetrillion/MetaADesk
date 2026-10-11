import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Card,
  Input,
  Popconfirm,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  RobotOutlined,
  SendOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { api } from '../api';
import { emitDataChanged } from '../events';
import type { AgentMessage, AgentProposal } from '../types';

interface ProposalItem {
  key: string;
  proposal: AgentProposal;
}

export default function AgentPanel({ projectId }: { projectId?: string }) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [quickLoading, setQuickLoading] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ProposalItem[]>([]);
  const [modelOptions, setModelOptions] = useState<Array<{ id: string; name: string; model: string }>>([]);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setProposals([]);
    if (projectId) {
      api
        .getAgentHistory(projectId)
        .then((h) => setMessages(h.messages))
        .catch(() => setMessages([]));
      api
        .getSettings()
        .then((s) => {
          setModelOptions(s.providers.map((p) => ({ id: p.id, name: p.name, model: p.model })));
          setActiveModelId(s.activeProviderId);
        })
        .catch(() => undefined);
    } else {
      setMessages([]);
    }
  }, [projectId]);

  const changeModel = async (id: string) => {
    setActiveModelId(id);
    try {
      const s = await api.getSettings();
      await api.putSettings({ ...s, activeProviderId: id });
      message.success('已切换项目 Agent 模型');
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, proposals, loading]);

  const send = async () => {
    if (!projectId) return;
    const text = input.trim();
    if (!text) return;
    setInput('');
    const next = [...messages, { role: 'user' as const, content: text }];
    setMessages(next);
    setLoading(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const r = await api.agentChat(projectId, next, ctrl.signal);
      const updated: AgentMessage[] = [...next, { role: 'assistant', content: r.reply }];
      setMessages(updated);
      api.putAgentHistory(projectId, updated).catch(() => undefined);
      setProposals((prev) => [
        ...prev,
        ...r.proposals.map((p, i) => ({ key: `${Date.now()}-${i}`, proposal: p })),
      ]);
    } catch (e) {
      if (ctrl.signal.aborted) return; // 用户主动停止，不追加错误回复
      message.error(e instanceof Error ? e.message : String(e));
      const errReply: AgentMessage = {
        role: 'assistant',
        content: `出错了：${e instanceof Error ? e.message : String(e)}`,
      };
      setMessages([...next, errReply]);
    } finally {
      setLoading(false);
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const deleteFrom = (index: number) => {
    const next = messages.slice(0, index);
    setMessages(next);
    api.putAgentHistory(projectId!, next).catch(() => undefined);
  };

  // 一键直达：直接生成方案（不依赖模型意图识别），产出待确认提案
  const quick = async (type: 'search_strategy' | 'extraction_table') => {
    if (!projectId) return;
    setQuickLoading(type);
    try {
      const r = await api.agentQuick(projectId, type);
      if (r.proposals.length === 0) {
        message.warning('当前无法生成，请确认已填写协议（PICO / 结局指标）');
      } else {
        setProposals((prev) => [
          ...prev,
          ...r.proposals.map((p, i) => ({ key: `${Date.now()}-${i}`, proposal: p })),
        ]);
        setMessages((prev) => {
          const next: AgentMessage[] = [
            ...prev,
            {
              role: 'assistant',
              content:
                type === 'search_strategy'
                  ? '已为你设计整体检索策略（多库），请在下方「待确认」卡片中核对后应用。'
                  : '已为你生成数据提取表，请在下方「待确认」卡片中核对后应用。',
            },
          ];
          api.putAgentHistory(projectId!, next).catch(() => undefined);
          return next;
        });
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setQuickLoading(null);
    }
  };

  const confirm = async (item: ProposalItem) => {
    let done = '';
    try {
      if (item.proposal.kind === 'protocol') {
        const p = item.proposal.payload;
        await api.putProtocol(projectId!, {
          title: p.title,
          objective: p.objective,
          pico: p.pico,
          criteria: p.criteria,
          outcomes: p.outcomes,
        });
        done = '协议已写入「① 协议制定」';
        emitDataChanged('protocol');
      } else if (item.proposal.kind === 'search_query') {
        const p = item.proposal.payload;
        await api.createStrategy(projectId!, {
          databaseId: p.databaseId,
          query: p.query,
          notes: p.notes,
          generatedBy: 'ai',
        });
        done = `检索式已写入「② 检索策略」（${p.databaseName}）`;
        emitDataChanged('strategies');
      } else if (item.proposal.kind === 'search_strategy') {
        const queries = item.proposal.payload.queries;
        for (const q of queries) {
          await api.createStrategy(projectId!, {
            databaseId: q.databaseId,
            query: q.query,
            notes: q.notes,
            generatedBy: 'ai',
          });
        }
        done = `已写入 ${queries.length} 条检索式到「② 检索策略」`;
        emitDataChanged('strategies');
      } else if (item.proposal.kind === 'screening_prompt') {
        await api.saveAiSettings(projectId!, {
          screeningSystemPrompt: item.proposal.payload.prompt,
        });
        done = '初筛系统提示词已写入「③ 初筛」';
        emitDataChanged('screening');
      } else {
        await api.putExtractionTemplate(projectId!, item.proposal.payload.fields);
        done = '提取表已写入「⑤ 提取」';
        emitDataChanged('extraction');
      }
      message.success(done);
      // 把「已执行」写回对话历史（并持久化），让 Agent 记住实际结果
      setMessages((prev) => {
        const next: AgentMessage[] = [
          ...prev,
          { role: 'assistant', content: `✅ 已执行：${done}` },
        ];
        api.putAgentHistory(projectId!, next).catch(() => undefined);
        return next;
      });
      setProposals((prev) => prev.filter((x) => x.key !== item.key));
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  const ignore = (key: string) => setProposals((prev) => prev.filter((x) => x.key !== key));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
        <Space>
          <RobotOutlined style={{ color: '#1677ff' }} />
          <Typography.Text strong>项目 Agent</Typography.Text>
        </Space>
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {projectId ? '可感知当前项目全部内容，可对话并自动填充字段' : '请先选择左侧项目'}
          </Typography.Text>
        </div>
        <Select
          size="small"
          style={{ width: '100%', marginTop: 8 }}
          value={activeModelId ?? undefined}
          placeholder="项目 Agent 模型"
          onChange={(v) => void changeModel(v)}
          options={modelOptions.map((p) => ({ value: p.id, label: `${p.name} (${p.model})` }))}
        />
        <Space wrap size={4} style={{ marginTop: 8 }}>
          <Button
            size="small"
            icon={<RobotOutlined />}
            loading={quickLoading === 'search_strategy'}
            disabled={!projectId}
            onClick={() => void quick('search_strategy')}
          >
            设计检索策略
          </Button>
          <Button
            size="small"
            icon={<RobotOutlined />}
            loading={quickLoading === 'extraction_table'}
            disabled={!projectId}
            onClick={() => void quick('extraction_table')}
          >
            生成提取表
          </Button>
        </Space>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 12, background: '#fafafa' }}>
        {messages.length === 0 && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            试试说：「根据研究问题生成协议草案」「为 PubMed 生成检索式」等。
          </Typography.Text>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              marginBottom: 8,
            }}
          >
            <div
              style={{
                maxWidth: '85%',
                padding: '8px 12px',
                borderRadius: 10,
                background: m.role === 'user' ? '#1677ff' : '#fff',
                color: m.role === 'user' ? '#fff' : 'rgba(0,0,0,0.85)',
                border: m.role === 'user' ? 'none' : '1px solid #f0f0f0',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: 13,
              }}
            >
              <Space align="start">
                {m.role === 'user' ? <UserOutlined style={{ marginTop: 3 }} /> : <RobotOutlined style={{ marginTop: 3, color: '#1677ff' }} />}
                <span>{m.content}</span>
                <Popconfirm
                  title="删除这条及其后的所有对话？"
                  onConfirm={() => deleteFrom(i)}
                >
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    title="删除这条及其后所有消息"
                    style={{ marginLeft: 4, fontSize: 12, height: 22, padding: '0 6px' }}
                  >
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            </div>
          </div>
        ))}

        {proposals.map((item) => (
          <Card
            key={item.key}
            size="small"
            style={{ marginBottom: 8, borderColor: '#91caff', background: '#e6f4ff' }}
            title={
              <Space>
                <Tag color="blue">{item.proposal.title}</Tag>
                <Tag color="orange">待确认</Tag>
              </Space>
            }
            extra={
              <Space>
                <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => void confirm(item)}>
                  确认应用
                </Button>
                <Button size="small" icon={<CloseOutlined />} onClick={() => ignore(item.key)}>
                  忽略
                </Button>
              </Space>
            }
          >
            {item.proposal.kind === 'protocol' ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                标题：{item.proposal.payload.title}（含 PICO / 纳入排除 / 结局指标）
              </Typography.Text>
            ) : item.proposal.kind === 'search_query' ? (
              <Typography.Text type="secondary" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                {item.proposal.payload.databaseName}：{item.proposal.payload.query.slice(0, 120)}
                {item.proposal.payload.query.length > 120 ? '…' : ''}
              </Typography.Text>
            ) : item.proposal.kind === 'search_strategy' ? (
              <Space direction="vertical" size={2}>
                {item.proposal.payload.queries.map((q) => (
                  <Typography.Text key={q.databaseId} type="secondary" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                    <Tag style={{ marginRight: 4 }}>{q.databaseName}</Tag>
                    {q.query.slice(0, 90)}{q.query.length > 90 ? '…' : ''}
                  </Typography.Text>
                ))}
              </Space>
            ) : item.proposal.kind === 'screening_prompt' ? (
              <Typography.Text type="secondary" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                {item.proposal.payload.prompt.slice(0, 200)}
                {item.proposal.payload.prompt.length > 200 ? '…' : ''}
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                共 {item.proposal.payload.fields.length} 个字段：
                {item.proposal.payload.fields.slice(0, 8).map((f) => f.label).join('、')}
                {item.proposal.payload.fields.length > 8 ? '…' : ''}
              </Typography.Text>
            )}
          </Card>
        ))}

        {loading && <Typography.Text type="secondary" style={{ fontSize: 12 }}>思考中…</Typography.Text>}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: 12, borderTop: '1px solid #f0f0f0', background: '#fff' }}>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder={projectId ? '向 Agent 提问或下达任务…' : '请先选择项目'}
            value={input}
            disabled={!projectId}
            onChange={(e) => setInput(e.target.value)}
            onPressEnter={(e) => {
              // 中文输入法组词时的回车不发送，避免误触
              if (e.nativeEvent.isComposing || (e.nativeEvent as unknown as { keyCode?: number }).keyCode === 229) {
                return;
              }
              void send();
            }}
          />
          {loading ? (
            <Button danger icon={<CloseOutlined />} onClick={stop}>
              停止
            </Button>
          ) : (
            <Button type="primary" icon={<SendOutlined />} disabled={!projectId} onClick={() => void send()}>
              发送
            </Button>
          )}
        </Space.Compact>
      </div>
    </div>
  );
}
