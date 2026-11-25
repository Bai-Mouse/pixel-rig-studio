import { useEffect, useState } from 'react';
import { renderPreviewFrame, type RenderableProject } from '../export/animationRenderer';

interface PreviewScene extends RenderableProject { fps: number }

export function PlanPreview({ before, after, frameIds }: {
  before: PreviewScene;
  after: PreviewScene;
  frameIds: string[];
}) {
  const [showAfter, setShowAfter] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(0);
  const [image, setImage] = useState<{ scene: PreviewScene; index: number; source: string } | null>(null);
  const [error, setError] = useState('');
  const scope = new Set(frameIds);
  const originalIds = new Set(before.frames.map((frame) => frame.id));
  const survivingIds = new Set(after.frames.map((frame) => frame.id));
  const full = before.frames.length === frameIds.length;
  const originalIndexes = before.frames.flatMap((frame, index) => full || scope.has(frame.id) || !survivingIds.has(frame.id) ? [index] : []);
  const editedIndexes = after.frames.flatMap((frame, index) => full || scope.has(frame.id) || !originalIds.has(frame.id) ? [index] : []);
  const scene = showAfter ? after : before;
  const target = showAfter ? editedIndexes : originalIndexes;
  const indexes = target.length ? target : scene.frames.map((_, index) => index);
  const position = step % Math.max(1, indexes.length);
  const index = indexes[position];
  const source = image?.scene === scene && image.index === index ? image.source : undefined;

  useEffect(() => {
    let cancelled = false;
    setError('');
    setImage(null);
    if (index !== undefined) {
      void renderPreviewFrame(scene, index, 384)
        .then((canvas) => { if (!cancelled) setImage({ scene, index, source: canvas.toDataURL() }); })
        .catch(() => { if (!cancelled) { setError('无法渲染这一帧的预览。'); setPlaying(false); } });
    }
    return () => { cancelled = true; };
  }, [scene, index]);

  useEffect(() => {
    if (!playing || !source || indexes.length < 2) return;
    const timer = window.setTimeout(() => setStep((value) => (value + 1) % indexes.length), 1000 / scene.fps);
    return () => window.clearTimeout(timer);
  }, [playing, source, scene.fps, indexes.length, index]);

  return <div className="codex-preview">
    <div className="codex-setting-actions" role="group" aria-label="对照预览">
      <button type="button" aria-pressed={!showAfter} onClick={() => setShowAfter(false)}>修改前</button>
      <button type="button" aria-pressed={showAfter} onClick={() => setShowAfter(true)}>修改后</button>
      <button type="button" disabled={indexes.length < 2} onClick={() => setPlaying(!playing)}>{playing ? '暂停' : '循环播放'}</button>
    </div>
    <div className="codex-preview-image">{source ? <img src={source} alt={`${showAfter ? '修改后' : '修改前'}第 ${index + 1} 帧`} /> : <small>{error || '正在渲染…'}</small>}</div>
    <label>第 {index + 1} 帧 · {position + 1}/{indexes.length}
      <input type="range" min={0} max={Math.max(0, indexes.length - 1)} value={position}
        onChange={(event) => { setPlaying(false); setStep(Number(event.target.value)); }} />
    </label>
  </div>;
}
