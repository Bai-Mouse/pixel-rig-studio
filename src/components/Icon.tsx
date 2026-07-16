type IconName = 'import' | 'plus' | 'eye' | 'eyeOff' | 'lock' | 'unlock' | 'chevron' | 'grid' | 'target' | 'zoomIn' | 'zoomOut' | 'layers' | 'cursor' | 'image' | 'play' | 'pause' | 'loop' | 'onion' | 'copy' | 'trash' | 'keyframe' | 'move' | 'rotate' | 'scale' | 'flipHorizontal' | 'flipVertical' | 'reset' | 'magnet' | 'pixel' | 'download';

const paths: Record<IconName, string> = {
  import: 'M12 3v12m0 0 4-4m-4 4-4-4M5 21h14',
  plus: 'M12 5v14M5 12h14',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  eyeOff: 'm3 3 18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a18.2 18.2 0 0 1-3.1 3.8M6.6 6.6C3.6 8.6 2 12 2 12s3.5 7 10 7a9.5 9.5 0 0 0 3-.5',
  lock: 'M6 10V7a6 6 0 0 1 12 0v3M5 10h14v11H5zM12 14v3',
  unlock: 'M7 10V7a5 5 0 0 1 9-3M5 10h14v11H5zM12 14v3',
  chevron: 'm9 18 6-6-6-6',
  grid: 'M4 4h16v16H4zM4 10h16M10 4v16',
  target: 'M12 2v4m0 12v4M2 12h4m12 0h4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-6v4m-2-2h4',
  zoomIn: 'M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm0 3v6M8 11h6m4 9-3.5-3.5',
  zoomOut: 'M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12ZM8 11h6m4 9-3.5-3.5',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  cursor: 'm5 3 13 9-6 1-3 6L5 3Z',
  image: 'M4 4h16v16H4zM4 15l4-4 3 3 3-4 6 5M8 8h.01',
  play: 'm8 5 11 7-11 7z',
  pause: 'M8 5v14M16 5v14',
  loop: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4m14-2v2a4 4 0 0 1-4 4H3',
  onion: 'm12 2 8 5-8 5-8-5 8-5Zm0 10 8 5-8 5-8-5 8-5Z',
  copy: 'M8 8h12v12H8zM4 4h12v2M4 4v12h2',
  trash: 'M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5',
  keyframe: 'm12 3 9 9-9 9-9-9 9-9Z',
  move: 'M12 2v20m10-10H2m10-10-3 3m3-3 3 3m7 7-3-3m3 3-3 3M2 12l3-3m-3 3 3 3',
  rotate: 'M20 11a8 8 0 1 1-2.3-5.7M20 4v7h-7',
  scale: 'M4 4h7M4 4v7m16 9h-7m7 0v-7M4 20 20 4',
  flipHorizontal: 'M12 3v18M4 7l5 5-5 5M20 7l-5 5 5 5',
  flipVertical: 'M3 12h18M7 4l5 5 5-5M7 20l5-5 5 5',
  reset: 'M19 8V3m0 0h-5m5 0-3.6 3.6A8 8 0 1 0 20 14',
  magnet: 'M6 3v8a6 6 0 0 0 12 0V3M6 3h4v7a2 2 0 0 0 4 0V3h4M6 3H4m16 0h-2',
  pixel: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M5 20h14',
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}
