import type { ProjectSettings, RigNode, SpriteAsset } from '../types/project';

const sprite = (id: string, name: string, folder: string, art: string, width: number, height: number): SpriteAsset => ({
  id,
  name,
  folder,
  width,
  height,
  src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" shape-rendering="crispEdges">${art}</svg>`,
  )}`,
});

const node = (
  id: string,
  name: string,
  parentId: string | null,
  assetId: string,
  x: number,
  y: number,
  children: string[] = [],
): RigNode => ({
  id,
  name,
  parentId,
  children,
  assetId,
  pivot: { x: 16, y: 16 },
  transform: { position: { x, y }, rotation: 0, scale: { x: 1, y: 1 } },
  visible: true,
  locked: false,
});

export function createDemoProject() {
  const assets: Record<string, SpriteAsset> = {
    body: sprite('body', 'Body.png', 'Body', '<path fill="#4454a5" d="M8 2h16v5h5v22h-5v3H8v-3H3V7h5z"/><path fill="#6978d6" d="M10 4h12v25H10z"/><path fill="#b2c8ff" d="M12 6h8v2h-8z"/>', 32, 32),
    head: sprite('head', 'Head.png', 'Head', '<path fill="#d48a67" d="M5 4h22v24H5z"/><path fill="#f0b18a" d="M8 6h16v17H8z"/><path fill="#422a3a" d="M11 15h3v3h-3zm8 0h3v3h-3z"/>', 32, 32),
    hair: sprite('hair', 'Hair.png', 'Hair', '<path fill="#382949" d="M4 5h24v12h-4v-5h-4v3h-4V9h-5v5H7v6H4z"/><path fill="#5f3d72" d="M8 6h12v3H8z"/>', 32, 32),
    arm: sprite('arm', 'Arm.png', 'Hands', '<path fill="#4454a5" d="M7 2h8v21h-3v7H5v-8h2z"/><path fill="#6978d6" d="M9 4h4v16H9z"/>', 16, 32),
    leg: sprite('leg', 'Leg.png', 'Legs', '<path fill="#30395e" d="M10 1h12v21h5v8H16v-5h-6z"/><path fill="#5967ad" d="M13 3h6v18h-6z"/><path fill="#272b41" d="M16 25h11v5H16z"/>', 32, 32),
  };

  const nodes: Record<string, RigNode> = {
    body: node('body', 'Body', null, 'body', 0, 12, ['head', 'left-arm', 'right-arm', 'left-leg', 'right-leg']),
    head: node('head', 'Head', 'body', 'head', 0, -25, ['hair']),
    hair: node('hair', 'Hair', 'head', 'hair', 0, -1),
    'left-arm': node('left-arm', 'Left Arm', 'body', 'arm', -19, 7),
    'right-arm': node('right-arm', 'Right Arm', 'body', 'arm', 19, 7),
    'left-leg': node('left-leg', 'Left Leg', 'body', 'leg', -9, 34),
    'right-leg': node('right-leg', 'Right Leg', 'body', 'leg', 9, 34),
  };

  const settings: ProjectSettings = { canvasSize: { x: 320, y: 240 }, gridSize: 8 };
  return { assets, nodes, rootNodeIds: ['body'], folders: ['All sprites', 'Body', 'Head', 'Hair', 'Hands', 'Legs', 'Weapons', 'Effects'], settings };
}
