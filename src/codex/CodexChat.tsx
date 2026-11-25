import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { isDesktopRuntime } from '../export/nativeSave';
import { inspectorFrameIds, useProjectStore } from '../state/projectStore';
import { applyEditPlan, describeOperation, parseEditPlan, type EditPlan, type EditScope } from './editPlan';
import { captureCodexProject, codexPrompt } from './context';
import { renderPreviewFrame } from '../export/animationRenderer';
import { PlanReview } from './PlanReview';
import { AnimationStylePicker } from './AnimationStylePicker';
import { activeStyleTerms, readStylePreferences, saveStylePreferences } from './animationStyle';
import {
  chatDeepSeek, deepseekSystemPrompt, extractJson,
  loadDeepSeekSettings, saveDeepSeekSettings, type DeepSeekSettings,
} from './deepseek';
import './codex-chat.css';

interface Connection { path: string; version: string; loggedIn: boolean; message: string }
type Provider = 'deepseek' | 'claude' | 'codex';
const PROVIDER_LABELS: Record<Provider, string> = { deepseek: 'DeepSeek', claude: 'Claude', codex: 'Codex' };
const isProvider = (value: string): value is Provider => value in PROVIDER_LABELS;
interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  plan?: EditPlan;
  baseline?: ReturnType<typeof captureCodexProject>;
  editId?: string;
  discarded?: boolean;
  error?: string;
  scope?: EditScope;
  provider?: Provider;
}
interface FrameReference { number: number; image: string }
const stored = (key: string) => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } };
const remember = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* 偏好存储可选 */ } };

export function CodexChat({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [provider, setProvider] = useState<Provider>(() => { const saved = stored('pixel-rig:chat-provider'); return isProvider(saved) ? saved : 'deepseek'; });
  const [deepseek, setDeepseek] = useState<DeepSeekSettings>(() => loadDeepSeekSettings());
  const [claudeExecutable, setClaudeExecutable] = useState(() => stored('pixel-rig:claude-path'));
  const [claudeModel, setClaudeModel] = useState(() => stored('pixel-rig:claude-model'));
  const [claudeConnection, setClaudeConnection] = useState<Connection | null>(null);
  const [executable, setExecutable] = useState(() => stored('pixel-rig:codex-path'));
  const [model, setModel] = useState(() => stored('pixel-rig:codex-model'));
  const [connection, setConnection] = useState<Connection | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [frameTarget, setFrameTarget] = useState<'selected' | 'current' | 'group' | 'all'>('selected');
  const [nodeTarget, setNodeTarget] = useState('selected');
  const [references, setReferences] = useState<FrameReference[]>([]);
  const [preparingImages, setPreparingImages] = useState(false);
  const [stylePreferences, setStylePreferences] = useState(readStylePreferences);
  const requestRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const history = useProjectStore((state) => state.transformHistory);
  const redo = useProjectStore((state) => state.redoStack);
  const frames = useProjectStore((state) => state.frames);
  const currentFrameIndex = useProjectStore((state) => state.currentFrameIndex);
  const selectedFrameIds = useProjectStore((state) => state.selectedFrameIds);
  const selectedNodeId = useProjectStore((state) => state.selectedNodeId);
  const nodes = useProjectStore((state) => state.nodes);
  const assets = useProjectStore((state) => state.assets);
  const settings = useProjectStore((state) => state.settings);
  const roots = useProjectStore((state) => state.rootNodeIds);
  const fps = useProjectStore((state) => state.fps);
  const loop = useProjectStore((state) => state.isLooping);
  const applyPlan = useProjectStore((state) => state.applyCodexPlan);
  const undo = useProjectStore((state) => state.undoTransform);
  const redoEdit = useProjectStore((state) => state.redoTransform);
  const appliedIds = history.flatMap((entry) => 'codexEditId' in entry ? [entry.codexEditId] : []);
  const redoIds = redo.flatMap((entry) => 'codexEditId' in entry ? [entry.codexEditId] : []);
  const ready = provider === 'deepseek' ? Boolean(deepseek.apiKey.trim())
    : provider === 'claude' ? Boolean(claudeConnection?.loggedIn)
    : Boolean(connection?.loggedIn);
  const usesApi = provider === 'deepseek';
  const currentFrame = frames[currentFrameIndex];
  const currentGroup = currentFrame?.group;
  const selectedIds = inspectorFrameIds({ frames, currentFrameIndex, selectedFrameIds });
  const effectiveFrameTarget = frameTarget === 'group' && !currentGroup ? 'selected' : frameTarget;
  const scope: EditScope = {
    nodeId: nodeTarget === 'selected' ? selectedNodeId : nodeTarget === 'all' ? null : nodes[nodeTarget]?.id ?? selectedNodeId,
    frameIds: effectiveFrameTarget === 'all' ? frames.map((frame) => frame.id)
      : effectiveFrameTarget === 'group' ? frames.filter((frame) => frame.group?.id === currentGroup?.id).map((frame) => frame.id)
      : effectiveFrameTarget === 'current' && currentFrame ? [currentFrame.id] : selectedIds,
    referenceFrameId: currentFrame?.id,
  };
  const numbers = frames.flatMap((frame, index) => scope.frameIds.includes(frame.id) ? [index + 1] : []);
  const imagesSupported = !usesApi || ['deepseek-flash', 'deepseek-v4-flash-vision-exp'].includes(deepseek.model.trim());

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages, progress, visible]);
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let disposed = false;
    let release: (() => void) | undefined;
    void listen<{ requestId: string; message: string }>('codex-progress', ({ payload }) => {
      if (payload.requestId === requestRef.current && !cancelRef.current) setProgress(payload.message);
    }).then((stop) => { if (disposed) stop(); else release = stop; });
    return () => {
      disposed = true; release?.();
      abortRef.current?.abort();
      if (requestRef.current) void invoke('codex_cancel', { requestId: requestRef.current });
    };
  }, []);

  const chooseProvider = (next: Provider) => {
    setProvider(next); setError(''); remember('pixel-rig:chat-provider', next);
  };
  const persistDeepseek = () => {
    saveDeepSeekSettings(deepseek);
    setError('');
    setProgress('已保存 DeepSeek 设置');
    window.setTimeout(() => setProgress(''), 1500);
  };
  const detectClaude = async (path = claudeExecutable) => {
    if (!isDesktopRuntime()) { setError('Claude Code 连接需要桌面版，请运行桌面程序。'); return; }
    setChecking(true); setError('');
    try { setClaudeConnection(await invoke<Connection>('claude_connection_status', { executable: path })); }
    catch (e) { setClaudeConnection(null); setError(String(e)); }
    finally { setChecking(false); }
  };
  const detect = async (path = executable) => {
    if (!isDesktopRuntime()) { setError('Codex 连接需要桌面版，请运行桌面程序。'); return; }
    setChecking(true); setError('');
    try { setConnection(await invoke<Connection>('codex_connection_status', { executable: path })); }
    catch (e) { setConnection(null); setError(String(e)); }
    finally { setChecking(false); }
  };
  const attachFrames = async (mode: 'current' | 'selection') => {
    if (preparingImages || !imagesSupported) return;
    const project = captureCodexProject();
    const selected = mode === 'current' ? [currentFrameIndex + 1] : selectedIds
      .map((id) => frames.findIndex((frame) => frame.id === id) + 1);
    const candidates = selected.filter((number) => number > 0 && !references.some((item) => item.number === number));
    const limit = Math.min(candidates.length, 6 - references.length);
    if (limit <= 0) return;
    const sampled = Array.from({ length: limit }, (_, i) => candidates[Math.round(i * (candidates.length - 1) / Math.max(1, limit - 1))]);
    setPreparingImages(true);
    setError('');
    try {
      const images = await Promise.all(sampled.map(async (number) => ({
        number, image: (await renderPreviewFrame(project, number - 1, 320)).toDataURL('image/png'),
      })));
      setReferences((existing) => [...existing, ...images].slice(0, 6));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPreparingImages(false);
    }
  };
  const send = async () => {
    if (!input.trim() || busy || !ready || preparingImages || (references.length > 0 && !imagesSupported)) return;
    useProjectStore.getState().commitInspectorEdit();
    useProjectStore.getState().commitTransform();
    const baseline = captureCodexProject();
    const request = input.trim();
    const requestId = crypto.randomUUID();
    const previous = messages.slice(-12).map(({ role, text, editId, discarded }) => ({
      role, text, status: discarded ? 'discarded' : editId ? appliedIds.includes(editId) ? 'applied' : 'undone' : 'conversation or pending proposal',
    }));
    const imageData = references.map(({ image }) => image);
    const styles = activeStyleTerms(stylePreferences);
    const prompt = codexPrompt(request, previous, baseline, scope, references.map(({ number }) => number), styles);
    if (prompt.length > 1_000_000) { setError('项目较大，请减少帧数后重试。'); return; }
    const sentText = [
      request,
      styles.length ? `动画风格：${styles.map(({ label }) => label).join('、')}` : '',
      references.length ? `参考图：第 ${references.map(({ number }) => number).join('、')} 帧` : '',
    ].filter(Boolean).join('\n');
    setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'user', text: sentText }]);
    setInput(''); setReferences([]); setBusy(true); setError('');
    setProgress(usesApi ? '正在请求 DeepSeek…' : '正在连接 ' + PROVIDER_LABELS[provider] + '…');
    requestRef.current = requestId; cancelRef.current = false;
    try {
      const raw = provider === 'deepseek'
        ? await chatDeepSeek({
          settings: deepseek,
          system: deepseekSystemPrompt(),
          user: prompt,
          images: imageData,
          signal: (abortRef.current = new AbortController()).signal,
          onProgress: setProgress,
        })
        : provider === 'claude'
        // Claude Code CLI 没有 JSON Schema 约束，把编辑规则拼在提示词前面一起经 stdin 发送。
        ? await invoke<string>('claude_chat', { requestId, executable: claudeConnection?.path ?? '', prompt: deepseekSystemPrompt() + '\n\n' + prompt, model: claudeModel, images: imageData.map((image) => image.split(',')[1]) })
        : await invoke<string>('codex_chat', {
          requestId, executable: connection?.path ?? '', prompt, model,
          images: imageData.map((image) => Array.from(atob(image.split(',')[1]), (char) => char.charCodeAt(0))),
        });
      if (cancelRef.current) return;
      const plan = parseEditPlan(JSON.parse(provider === 'codex' ? raw : extractJson(raw)));
      // Validate the full batch before enabling Apply; partial edits are never committed.
      applyEditPlan(baseline, plan, Object.keys(baseline.assets), scope);
      setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', text: plan.message, plan, baseline, scope, provider }]);
    } catch (e) {
      const message = (e as Error).name === 'AbortError' ? '已取消请求。' : String(e);
      if (!cancelRef.current) setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', text: '请求未完成，请检查下方提示后重试。', error: message }]);
    } finally {
      requestRef.current = null; abortRef.current = null; setBusy(false); setProgress('');
    }
  };
  const cancel = () => {
    cancelRef.current = true; setProgress('正在取消…');
    abortRef.current?.abort();
    if (provider === 'claude' && requestRef.current) void invoke('claude_cancel', { requestId: requestRef.current }).catch((e) => setError(String(e)));
    if (provider === 'codex' && requestRef.current) void invoke('codex_cancel', { requestId: requestRef.current }).catch((e) => setError(String(e)));
  };
  const apply = (message: Message, plan: EditPlan) => {
    if (!message.baseline) return;
    try {
      const editId = applyPlan(plan, message.baseline);
      setMessages((items) => items.map((item) => item.id === message.id ? { ...item, plan, editId, error: undefined } : item));
    } catch (e) { setMessages((items) => items.map((item) => item.id === message.id ? { ...item, error: String(e) } : item)); }
  };
  const loginCommand = connection ? "& '" + connection.path.replace(/'/g, "''") + "' login --device-auth" : 'codex login --device-auth';
  const providerLabel = PROVIDER_LABELS[provider];
  return <aside className="codex-chat" aria-label="动画助手对话" hidden={!visible}>
    <header><div><strong>动画助手</strong><small>{providerLabel} · 每次修改都可以撤销</small></div><button type="button" onClick={onClose} aria-label="关闭对话">×</button></header>
    <div className="codex-chat-tools">
      <button type="button" onClick={() => setSettingsOpen((value) => !value)}>连接设置</button>
      <button type="button" disabled={busy || !history.length} onClick={undo}>撤销最近修改</button>
      <button type="button" disabled={busy || !redo.length} onClick={redoEdit}>重做</button>
      <button type="button" disabled={busy} onClick={() => { setMessages([]); setError(''); }}>清空对话</button>
    </div>
    {settingsOpen && <section className="codex-connection">
      <div className="codex-setting-actions">
        <button type="button" disabled={busy} aria-pressed={provider === 'deepseek'} onClick={() => chooseProvider('deepseek')}>{(provider === 'deepseek' ? '● ' : '') + 'DeepSeek 接口'}</button>
        <button type="button" disabled={busy} aria-pressed={provider === 'claude'} onClick={() => chooseProvider('claude')}>{(provider === 'claude' ? '● ' : '') + 'Claude Code CLI'}</button>
        <button type="button" disabled={busy} aria-pressed={provider === 'codex'} onClick={() => chooseProvider('codex')}>{(provider === 'codex' ? '● ' : '') + 'Codex CLI'}</button>
      </div>
      {provider === 'deepseek' ? <>
        <label>API Key<input type="password" autoComplete="off" value={deepseek.apiKey} disabled={busy} placeholder="sk-..." onChange={(event) => setDeepseek({ ...deepseek, apiKey: event.target.value })} /></label>
        <label>模型<input value={deepseek.model} disabled={busy} list="pixel-rig-deepseek-models" placeholder="deepseek-chat" onChange={(event) => setDeepseek({ ...deepseek, model: event.target.value })} /></label>
        <datalist id="pixel-rig-deepseek-models"><option value="deepseek-chat" /><option value="deepseek-reasoner" /><option value="deepseek-flash" /></datalist>
        <label>接口地址<input value={deepseek.baseUrl} disabled={busy} placeholder="https://api.deepseek.com" onChange={(event) => setDeepseek({ ...deepseek, baseUrl: event.target.value })} /></label>
        <div className="codex-setting-actions"><button type="button" disabled={busy} onClick={persistDeepseek}>保存</button></div>
        <p>{ready ? '已配置 Key，可以直接对话。' : '填入 DeepSeek API Key 后即可对话。'}</p>
        <small>Key 仅保存在本机浏览器 localStorage，并随请求发往上面的接口地址。用 npm run dev 启动时默认走内置代理（/deepseek），打包版需要把接口地址填成可跨域的中转地址。</small>
      </> : provider === 'claude' ? <>
        <label>Claude Code 路径（留空自动检测）<input value={claudeExecutable} disabled={busy || checking} placeholder="claude.exe 的完整路径" onChange={(event) => { setClaudeExecutable(event.target.value); setClaudeConnection(null); }} /></label>
        <div className="codex-setting-actions"><button type="button" disabled={busy || checking || !isDesktopRuntime()} onClick={async () => {
          try {
            const selected = await open({ multiple: false, filters: [{ name: 'Claude Code executable', extensions: ['exe', 'cmd'] }] });
            if (typeof selected === 'string') { setClaudeExecutable(selected); setClaudeConnection(null); }
          } catch (e) { setError(String(e)); }
        }}>选择文件</button><button type="button" disabled={busy || checking} onClick={() => {
          remember('pixel-rig:claude-path', claudeExecutable); remember('pixel-rig:claude-model', claudeModel);
          void detectClaude();
        }}>{checking ? '检测中…' : '保存并检测'}</button></div>
        <label>模型（可选）<input value={claudeModel} disabled={busy} list="pixel-rig-claude-models" placeholder="留空使用 Claude Code 默认模型" onChange={(event) => setClaudeModel(event.target.value)} /></label>
        <datalist id="pixel-rig-claude-models"><option value="sonnet" /><option value="opus" /><option value="haiku" /></datalist>
        <p>{claudeConnection ? claudeConnection.version + ' · ' + claudeConnection.message : '使用本机 Claude Code CLI 和其登录账号（Claude Pro/Max 订阅即可），无需 API Key。首次使用请保存并检测。'}</p>
        {claudeConnection && !claudeConnection.loggedIn && <><p>在 PowerShell 中运行以下命令，按提示在浏览器里登录 Claude 账号，再点“保存并检测”：</p><code>{"& '" + claudeConnection.path.replace(/'/g, "''") + "'"}</code><small>启动后若没有自动弹出登录，输入 /login 回车。</small></>}
        <small>Claude 会收到节点属性、帧数据、最近对话，以及你主动附上的帧参考图。</small>
      </> : <>
        <label>Codex 路径（留空自动检测）<input value={executable} disabled={busy || checking} placeholder="codex.exe 的完整路径" onChange={(event) => { setExecutable(event.target.value); setConnection(null); }} /></label>
        <div className="codex-setting-actions"><button type="button" disabled={busy || checking || !isDesktopRuntime()} onClick={async () => {
          try {
            const selected = await open({ multiple: false, filters: [{ name: 'Codex executable', extensions: ['exe'] }] });
            if (typeof selected === 'string') { setExecutable(selected); setConnection(null); }
          } catch (e) { setError(String(e)); }
        }}>选择文件</button><button type="button" disabled={busy || checking} onClick={() => {
          remember('pixel-rig:codex-path', executable); remember('pixel-rig:codex-model', model);
          void detect();
        }}>{checking ? '检测中…' : '保存并检测'}</button></div>
        <label>模型（可选）<input value={model} disabled={busy} placeholder="留空使用 Codex 默认模型" onChange={(event) => setModel(event.target.value)} /></label>
        <p>{connection ? connection.version + ' · ' + connection.message : '使用本机 Codex CLI 和其登录账号。首次使用请保存并检测。'}</p>
        {connection && !connection.loggedIn && <><p>在 PowerShell 中执行以下命令完成登录，再点“保存并检测”：</p><code>{loginCommand}</code></>}
        <small>Codex 会收到节点属性、帧数据、最近对话，以及你主动附上的帧参考图。</small>
      </>}
    </section>}
    <div className="codex-messages" aria-live="polite">
      {!messages.length && <div className="codex-empty"><strong>描述你想做的动画</strong><p>例如：“把选中帧里左臂的旋转设为 20 度”或“复制当前帧生成 6 帧走路动画，并分为 Walk 组”。</p><p>方案会先显示修改清单。点击“应用修改”后可在画布和时间轴查看结果。</p></div>}
      {messages.map((message) => {
        const baseline = message.baseline;
        const stale = baseline && (baseline.frames !== frames || baseline.nodes !== nodes || baseline.assets !== assets || baseline.settings !== settings || baseline.rootNodeIds !== roots || baseline.fps !== fps || baseline.isLooping !== loop);
        const applied = message.editId && appliedIds.includes(message.editId);
        return <article key={message.id} className={'codex-message ' + message.role}>
          <small>{message.role === 'user' ? '你' : message.provider ? PROVIDER_LABELS[message.provider] : providerLabel}</small><p>{message.text}</p>
          {message.plan && baseline && message.plan.operations.length > 0 && !message.editId && !message.discarded
            ? <PlanReview baseline={baseline} plan={message.plan} scope={message.scope} disabled={busy} stale={Boolean(stale)}
              onApply={(plan) => apply(message, plan)} onDiscard={() => setMessages((items) => items.map((item) => item.id === message.id ? { ...item, discarded: true } : item))} />
            : !!message.plan?.operations.length && <details><summary>{message.plan.operations.length + ' 项编辑操作'}</summary><ol>{message.plan.operations.map((op, index) => <li key={index}>{describeOperation(op)}</li>)}</ol></details>}
          {message.editId && <small>{applied ? '已应用 · 可撤销' : redoIds.includes(message.editId) ? '已撤销 · 可重做' : '该修改已不在当前历史中'}</small>}
          {message.discarded && <small>已放弃方案</small>}
          {message.error && <small className="codex-error">{message.error}</small>}
        </article>;
      })}
      {busy && <p className="codex-progress">{progress}</p>}
      <div ref={endRef} />
    </div>
    {error && <p className="codex-error codex-chat-error">{error}</p>}
    <form className="codex-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <div className="codex-scope">
        <label>节点<select value={nodeTarget} disabled={busy} onChange={(event) => setNodeTarget(event.target.value)}>
          <option value="selected">当前选中{selectedNodeId ? ` · ${nodes[selectedNodeId]?.name ?? ''}` : ' · 全部'}</option>
          <option value="all">全部节点</option>
          {Object.values(nodes).map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
        </select></label>
        <label>帧范围<select value={effectiveFrameTarget} disabled={busy} onChange={(event) => setFrameTarget(event.target.value as typeof frameTarget)}>
          <option value="selected">选中的帧</option><option value="current">当前帧</option>
          {currentGroup && <option value="group">当前组 · {currentGroup.name}</option>}
          <option value="all">全部帧</option>
        </select></label>
      </div>
      <small className="codex-scope-summary" title={numbers.join(', ')}>目标帧 {numbers.length > 8 ? `${numbers.slice(0, 6).join('、')}…（共 ${numbers.length} 帧）` : numbers.join('、')} · 参考姿势 第 {currentFrameIndex + 1} 帧</small>
      <AnimationStylePicker preferences={stylePreferences} disabled={busy} onChange={(preferences) => {
        setStylePreferences(preferences);
        saveStylePreferences(preferences);
      }} />
      <div className="codex-attach">
        <button type="button" disabled={busy || !imagesSupported || preparingImages || references.length >= 6} onClick={() => void attachFrames('current')}>附当前帧</button>
        <button type="button" disabled={busy || !imagesSupported || preparingImages || references.length >= 6} onClick={() => void attachFrames('selection')}>附选区预览</button>
        <small>{preparingImages ? '正在渲染参考图…' : imagesSupported ? `${references.length}/6 张 · 随消息发送` : 'DeepSeek 图片需使用 deepseek-flash'}</small>
      </div>
      {references.length > 0 && <div className="codex-attachments">{references.map(({ number, image }) => (
        <button type="button" key={number} title={`移除第 ${number} 帧参考图`} aria-label={`移除第 ${number} 帧参考图`}
          onClick={() => setReferences((items) => items.filter((item) => item.number !== number))}><img src={image} alt="" /><span>{number} ×</span></button>
      ))}</div>}
      <textarea aria-label={'给 ' + providerLabel + ' 的消息'} maxLength={8000} value={input} disabled={busy} placeholder={'让 ' + providerLabel + ' 编辑节点或动画帧…'} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
      }} />
      <div><small>Enter 发送 · Shift+Enter 换行</small>{busy ? <button type="button" onClick={cancel}>取消请求</button> : <button type="submit" disabled={!input.trim() || !ready || preparingImages || (references.length > 0 && !imagesSupported)}>发送</button>}</div>
    </form>
  </aside>;
}
