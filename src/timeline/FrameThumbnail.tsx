import { memo, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { renderPreviewFrame, type RenderableProject } from '../export/animationRenderer';
import type { AnimationFrame } from '../types/project';

export const FrameThumbnail = memo(function FrameThumbnail({ frame, project }: {
  frame: AnimationFrame;
  project: Omit<RenderableProject, 'frames'>;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [image, setImage] = useState('');
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      root: element.closest('.frame-scroll'), rootMargin: '0px 80px',
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void renderPreviewFrame({ ...project, frames: [frame] }, 96)
      .then((canvas) => { if (!cancelled) setImage(canvas.toDataURL()); })
      .catch(() => { if (!cancelled) setImage(''); });
    return () => { cancelled = true; };
  }, [frame, project, visible]);
  return <span className="frame-thumbnail frame-thumbnail-image" ref={ref}>
    {image ? <img src={image} alt="" draggable={false} /> : <Icon name="keyframe" size={12} />}
  </span>;
});
