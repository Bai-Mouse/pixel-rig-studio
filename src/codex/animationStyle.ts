export interface StyleTerm {
  id: string;
  label: string;
  direction: string;
}

export const animationStylePresets: StyleTerm[] = [
  { id: 'snappy', label: '短促利落', direction: '动作段之间快速切换，关键姿势清晰，减少中间过渡。' },
  { id: 'smooth', label: '柔和流畅', direction: '起步和收势放缓，动作沿连续的轨迹过渡。' },
  { id: 'heavy', label: '沉重有力', direction: '蓄力较长，发力集中，落点后有明显减速与短暂停顿。' },
  { id: 'light', label: '轻盈灵活', direction: '动作启动快、收势干净，摆幅适中，重心转移轻快。' },
  { id: 'exaggerated', label: '夸张有弹性', direction: '扩大关键姿势的摆幅，用适度过冲和回弹强调动势。' },
  { id: 'subtle', label: '细微克制', direction: '以小幅度的角度和位移变化表达动作，保持角色轮廓稳定。' },
  { id: 'anticipation', label: '明显预备动作', direction: '主动作前安排短暂的反向预备姿势，再集中发力。' },
  { id: 'follow-through', label: '错峰收势', direction: '主体先到达目标姿势，次要部件延迟跟随，再逐渐稳定。' },
  { id: 'seamless', label: '循环接缝平滑', direction: '让末帧至首帧的姿态和速度变化自然衔接，避免机械地重复首帧。' },
];

export interface StylePreferences {
  custom: StyleTerm[];
  activeIds: string[];
}

export const maxCustomStyleTerms = 20;
const storageKey = 'pixel-rig:animation-style';

export function readStylePreferences(): StylePreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Partial<StylePreferences>;
    const custom = Array.isArray(saved.custom) ? saved.custom.filter((term) =>
      term && typeof term.id === 'string' && term.id.startsWith('custom-')
      && typeof term.label === 'string' && term.label.trim().length > 0 && term.label.length <= 40
      && typeof term.direction === 'string' && term.direction.length <= 240,
    ).slice(0, maxCustomStyleTerms) : [];
    const knownIds = new Set([...animationStylePresets, ...custom].map((term) => term.id));
    const activeIds = Array.isArray(saved.activeIds) ? [...new Set(saved.activeIds.filter((id) => knownIds.has(id)))] : [];
    return { custom, activeIds };
  } catch {
    return { custom: [], activeIds: [] };
  }
}

export function saveStylePreferences(preferences: StylePreferences) {
  try { localStorage.setItem(storageKey, JSON.stringify(preferences)); }
  catch { /* Keep in-memory preferences if storage is unavailable. */ }
}

export function activeStyleTerms(preferences: StylePreferences): StyleTerm[] {
  const byId = new Map([...animationStylePresets, ...preferences.custom].map((term) => [term.id, term]));
  return preferences.activeIds.flatMap((id) => {
    const term = byId.get(id);
    return term ? [term] : [];
  });
}
