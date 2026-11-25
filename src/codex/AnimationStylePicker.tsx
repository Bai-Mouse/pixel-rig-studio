import { useState } from 'react';
import { activeStyleTerms, animationStylePresets, maxCustomStyleTerms, type StylePreferences, type StyleTerm } from './animationStyle';

export function AnimationStylePicker({ preferences, onChange, disabled }: {
  preferences: StylePreferences;
  onChange: (preferences: StylePreferences) => void;
  disabled: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [direction, setDirection] = useState('');
  const active = new Set(preferences.activeIds);
  const selectedTerms = activeStyleTerms(preferences);
  const duplicate = [...animationStylePresets, ...preferences.custom].some((term) =>
    term.id !== editingId && term.label.toLowerCase() === label.trim().toLowerCase());
  const canSave = Boolean(label.trim()) && !duplicate && (editingId !== null || preferences.custom.length < maxCustomStyleTerms);
  const toggle = (id: string) => onChange({
    ...preferences,
    activeIds: active.has(id) ? preferences.activeIds.filter((item) => item !== id) : [...preferences.activeIds, id],
  });
  const resetDraft = () => {
    setEditingId(null);
    setLabel('');
    setDirection('');
  };
  const edit = (term: StyleTerm) => {
    setEditingId(term.id);
    setLabel(term.label);
    setDirection(term.direction);
  };
  const save = () => {
    if (!canSave || disabled) return;
    const term = { id: editingId ?? `custom-${crypto.randomUUID()}`, label: label.trim(), direction: direction.trim() };
    onChange(editingId
      ? { ...preferences, custom: preferences.custom.map((item) => item.id === term.id ? term : item) }
      : { custom: [...preferences.custom, term], activeIds: [...preferences.activeIds, term.id] });
    resetDraft();
  };
  const remove = (id: string) => {
    onChange({ custom: preferences.custom.filter((term) => term.id !== id), activeIds: preferences.activeIds.filter((item) => item !== id) });
    if (editingId === id) resetDraft();
  };
  const termButton = (term: StyleTerm) => (
    <button type="button" aria-pressed={active.has(term.id)} title={term.direction || term.label} disabled={disabled} onClick={() => toggle(term.id)}>{term.label}</button>
  );
  return <details className="codex-style">
    <summary title={selectedTerms.map((term) => term.label).join('、')}>
      <span>动画风格</span>
      <small>{selectedTerms.length ? selectedTerms.map((term) => term.label).join(' · ') : '未选词条'}</small>
    </summary>
    <div className="codex-style-content">
      <div className="codex-style-tags" role="group" aria-label="预设动画风格">
        {animationStylePresets.map((term) => <span key={term.id}>{termButton(term)}</span>)}
      </div>
      {preferences.custom.length > 0 && <ul className="codex-custom-styles" aria-label="自定义风格">
        {preferences.custom.map((term) => <li key={term.id}>
          {termButton(term)}
          <button type="button" disabled={disabled} aria-label={`编辑词条 ${term.label}`} onClick={() => edit(term)}>编辑</button>
          <button type="button" disabled={disabled} aria-label={`移除词条 ${term.label}`} onClick={() => remove(term.id)}>移除</button>
        </li>)}
      </ul>}
      <div className="codex-style-editor">
        <input aria-label="自定义词条" maxLength={40} disabled={disabled} placeholder="词条名，例如：机械僵硬"
          value={label} onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            save();
          }} />
        <button type="button" disabled={disabled || !canSave} onClick={save}>{editingId ? '保存' : '添加词条'}</button>
        {(editingId || label) && <input className="codex-style-direction" aria-label="风格说明" maxLength={240} disabled={disabled}
          placeholder="可选说明，例如：分段启动，关节不回弹" value={direction} onChange={(event) => setDirection(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            save();
          }} />}
      </div>
      <div className="codex-style-actions">
        {editingId && <button type="button" onClick={resetDraft}>取消编辑</button>}
        {active.size > 0 && <button type="button" disabled={disabled} onClick={() => onChange({ ...preferences, activeIds: [] })}>清空选择</button>}
        {duplicate && <small>已存在同名词条。</small>}
        {!editingId && preferences.custom.length >= maxCustomStyleTerms && <small>自定义词条已满。</small>}
      </div>
    </div>
  </details>;
}
