/** 跨组件数据刷新事件（轻量，避免引入状态管理库） */
export type DataChangedKind = 'strategies' | 'protocol' | 'extraction' | 'screening';

export function emitDataChanged(kind: DataChangedKind): void {
  window.dispatchEvent(new CustomEvent('meta:data-changed', { detail: kind }));
}

export function onDataChanged(kind: DataChangedKind, handler: () => void): () => void {
  const listener = (e: Event) => {
    if ((e as CustomEvent).detail === kind) handler();
  };
  window.addEventListener('meta:data-changed', listener);
  return () => window.removeEventListener('meta:data-changed', listener);
}
