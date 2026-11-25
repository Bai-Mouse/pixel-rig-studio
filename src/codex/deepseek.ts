/**
 * DeepSeek 接口接入。
 * 与 Codex CLI 走同一条编辑流程：生成 JSON 编辑计划 -> 校验 -> 用户确认后应用。
 */
export interface DeepSeekSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const KEY_API = 'pixel-rig:deepseek-key';
const KEY_URL = 'pixel-rig:deepseek-url';
const KEY_MODEL = 'pixel-rig:deepseek-model';

/** 开发时走 Vite 代理规避跨域，打包后直连官方地址。 */
export function defaultBaseUrl(): string {
  // 不依赖 vite/client 类型声明，直接读运行时注入的 env。
  const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
  return env?.DEV ? '/deepseek' : 'https://api.deepseek.com';
}

function read(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

export function loadDeepSeekSettings(): DeepSeekSettings {
  return {
    apiKey: read(KEY_API, ''),
    baseUrl: read(KEY_URL, '') || defaultBaseUrl(),
    model: read(KEY_MODEL, '') || 'deepseek-chat',
  };
}

export function saveDeepSeekSettings(settings: DeepSeekSettings) {
  try {
    localStorage.setItem(KEY_API, settings.apiKey);
    localStorage.setItem(KEY_URL, settings.baseUrl);
    localStorage.setItem(KEY_MODEL, settings.model);
  } catch { /* 偏好存储可选 */ }
}

const PLAN_SCHEMA = [
  '只允许下面这 11 种 operation，字段名必须完全一致，不需要的字段填 null：',
  '{"type":"set_node_frame","nodeId":"<节点ID>","frameNumbers":[1],"positionX":0,"positionY":0,"rotation":0,"scaleX":1,"scaleY":1,"visible":true,"spriteIndex":0,"sortingOrder":0}',
  '{"type":"set_node","nodeId":"<节点ID>","name":null,"pivotX":null,"pivotY":null,"visible":null,"locked":null}',
  '{"type":"add_node","nodeId":"node-<唯一ID>","name":"名称","parentId":null,"spriteIds":["<assetId>"]}',
  '{"type":"remove_node","nodeId":"<节点ID>"}',
  '{"type":"set_node_sprites","nodeId":"<节点ID>","spriteIds":["<assetId>"]}',
  '{"type":"add_frames","afterFrameNumber":0,"copyFromFrameNumber":1,"count":1}',
  '{"type":"remove_frames","frameNumbers":[1]}',
  '{"type":"move_frame","frameNumber":1,"toFrameNumber":2}',
  '{"type":"group_frames","frameNumbers":[1,2],"name":"Walk","color":"#4c7dff"}',
  '{"type":"set_animation","fps":null,"loop":null}',
  '{"type":"animate_node","nodeId":"<节点ID>","keys":[{"frame":1,"rotation":0},{"frame":8,"rotation":30},{"frame":12,"rotation":0}],"easing":"easeInOut"}',
  '',
  '约束：',
  '- 只能使用工程数据里真实存在的 nodeId 与 assetId，禁止臆造。',
  '- 帧编号从 1 开始；add_frames / remove_frames / move_frame 之后的帧号按结果时间轴计算。',
  '- positionX / positionY 是相对父节点的局部坐标；rotation 为角度，屏幕上顺时针为正。',
  '- pivot 就是关节位置，四肢与眼翼一律用 rotation 摆动，不要改 position 让它们离开身体。',
  '- 只有一张贴图的节点无法凭空变大，这种要求如实说明做不到。',
  '- animate_node 是关键帧写法：只给几个关键姿态，中间帧由前端按 easing（linear / easeInOut）插值。',
  '- 强烈优先用 animate_node：一次要动很多帧时，逐帧 set_node_frame 会让回复超过 8192 token 被截断，整条回复作废。',
  '- 粗略预算：单条 set_node_frame 约 210 字符，8192 token 只够约 100 条；超过就改用 animate_node 关键帧。',
  '- 最多 200 条 operation。无法完成时返回空 operations 并在 message 里说明原因。',
].join('\n');

export function deepseekSystemPrompt(): string {
  return [
    '你是 Pixel Rig Studio 内的木偶（pixel rig）动画编辑助手，负责按用户要求修改节点变换、帧序列和分组。',
    '严格只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释性前后缀。结构固定为：',
    '{"message":"给用户看的简短中文说明","operations":[...]}',
    PLAN_SCHEMA,
  ].join('\n');
}

/** 去掉 ```json 围栏和前后杂质，取出 JSON 主体。 */
export function extractJson(text: string): string {
  const fence = String.fromCharCode(96, 96, 96);
  let body = text.trim();
  if (body.startsWith(fence)) {
    const end = body.lastIndexOf(fence);
    if (end > 2) body = body.slice(3, end).replace(/^json/i, '').trim();
  }
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

export interface ChatDeepSeekOptions {
  settings: DeepSeekSettings;
  system: string;
  user: string;
  images?: string[];
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export async function chatDeepSeek({ settings, system, user, images = [], signal, onProgress }: ChatDeepSeekOptions): Promise<string> {
  const apiKey = settings.apiKey.trim();
  if (!apiKey) throw new Error('请先填写 DeepSeek API Key。');
  const base = (settings.baseUrl.trim() || defaultBaseUrl()).replace(/\/+$/, '');
  const url = base + '/chat/completions';
  onProgress?.('正在请求 DeepSeek…');
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: settings.model.trim() || 'deepseek-chat',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: images.length ? [
            { type: 'text', text: user },
            ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
          ] : user },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 8192,
        stream: false,
      }),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new Error('无法连接 DeepSeek：' + url + '。用 npm run dev 启动时走内置代理；打包版若被浏览器跨域拦截，请在「接口地址」填入可用的中转地址。');
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error('DeepSeek 返回 ' + response.status + ' ' + response.statusText + '：' + detail.slice(0, 400));
  }
  const payload = await response.json() as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    error?: { message?: string };
    usage?: { completion_tokens?: number };
  };
  const choice = payload.choices?.[0];
  const content = choice?.message?.content;
  if (!content) throw new Error(payload.error?.message ?? 'DeepSeek 没有返回内容。');
  // 输出被 token 上限截断时 JSON 必然不完整，先在这里拦下来，避免下游报莫名其妙的 SyntaxError。
  if (choice?.finish_reason === 'length') {
    const used = payload.usage?.completion_tokens ?? 0;
    throw new Error('模型输出被截断：已用满 ' + (used || 8192) + ' 个输出 token，编辑计划不完整（所以解析时报 JSON 语法错误）。'
      + '请把请求拆小：一次只做一个阶段，或改用 animate_node 关键帧写法代替逐帧 set_node_frame。');
  }
  return content;
}
