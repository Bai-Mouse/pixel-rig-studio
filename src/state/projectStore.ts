import { create } from 'zustand';
import { nodeSpriteIds, type AnimationFrame, type AnimationTemplate, type AssetId, type FrameGroup, type NodeFrameState, type NodeId, type ProjectSettings, type RigNode, type RotationSnapAngle, type SpriteAsset, type TransformTool, type TweenProperties, type Vec2 } from '../types/project';
import type { AnimationDataFile, SerializableProject } from '../export/projectSerializer';
import { normalizeProjectSettings } from '../export/projectSerializer';
import { createDemoProject } from './sampleProject';

type FrameStatePatch = Omit<Partial<NodeFrameState>, 'position' | 'scale'> & {
  position?: Partial<Vec2>;
  scale?: Partial<Vec2>;
};

interface TransformHistoryEntry {
  nodeId: NodeId;
  frameIndex: number;
  before: NodeFrameState;
  after: NodeFrameState;
}

interface PivotNodeSnapshot {
  pivot: Vec2;
  transform: RigNode['transform'];
  frameStates: Array<NodeFrameState | null>;
}

interface PivotHistoryEntry {
  snapshots: {
    before: Record<NodeId, PivotNodeSnapshot>;
    after: Record<NodeId, PivotNodeSnapshot>;
  };
}

type HistoryEntry = TransformHistoryEntry | PivotHistoryEntry;

interface TransformSession {
  nodeId: NodeId;
  frameIndex: number;
  before: NodeFrameState;
}

interface ProjectState {
  assets: Record<AssetId, SpriteAsset>;
  nodes: Record<NodeId, RigNode>;
  rootNodeIds: NodeId[];
  folders: string[];
  settings: ProjectSettings;
  projectName: string;
  frames: AnimationFrame[];
  currentFrameIndex: number;
  isPlaying: boolean;
  playbackGroupId: string | null;
  isLooping: boolean;
  onionSkinEnabled: boolean;
  fps: number;
  activeTool: TransformTool;
  showPivot: boolean;
  snapEnabled: boolean;
  transformSession: TransformSession | null;
  transformHistory: HistoryEntry[];
  redoStack: HistoryEntry[];
  selectedNodeId: NodeId | null;
  selectedAssetId: AssetId | null;
  selectedAssetIds: AssetId[];
  selectNode: (id: NodeId | null) => void;
  selectAsset: (id: AssetId | null) => void;
  selectAssets: (ids: AssetId[], primaryId?: AssetId | null) => void;
  addAssets: (assets: SpriteAsset[]) => void;
  replaceAssets: (assets: SpriteAsset[]) => void;
  updateAssetSource: (id: AssetId, src: string, width: number, height: number) => void;
  deleteAsset: (id: AssetId) => void;
  createNodeForAsset: (assetId: AssetId) => void;
  setNodeAsset: (nodeId: NodeId, assetId: AssetId) => void;
  addNodeSprites: (nodeId: NodeId, assetIds: AssetId[]) => void;
  removeNodeSprite: (nodeId: NodeId, assetId: AssetId) => void;
  setNodeFrameSprite: (nodeId: NodeId, imageIndex: number) => void;
  renameNode: (nodeId: NodeId, name: string) => void;
  addRootNode: () => void;
  addChildNode: (parentId: NodeId) => void;
  reparentNode: (nodeId: NodeId, parentId: NodeId | null) => void;
  setNodeSortingOrder: (nodeId: NodeId, sortingOrder: number) => void;
  toggleNodeVisibility: (id: NodeId) => void;
  toggleNodeLock: (id: NodeId) => void;
  selectFrame: (index: number) => void;
  togglePlayback: () => void;
  advanceFrame: () => void;
  toggleLooping: () => void;
  toggleOnionSkin: () => void;
  setFps: (fps: number) => void;
  insertFrame: () => void;
  duplicateFrame: () => void;
  deleteFrame: () => void;
  moveFrame: (fromIndex: number, toIndex: number) => void;
  insertTweenFrames: (startIndex: number, endIndex: number, count: number, properties: TweenProperties) => void;
  groupFrames: (frameIndexes: number[], name: string, color: string) => void;
  renameFrameGroup: (groupId: string, name: string, color: string) => void;
  ungroupFrames: (groupId: string) => void;
  updateCanvasFrame: (canvasData: string | undefined) => void;
  applyAnimationTemplate: (template: AnimationTemplate) => void;
  loadAnimation: (animation: AnimationDataFile) => boolean;
  setActiveTool: (tool: TransformTool) => void;
  toggleShowPivot: () => void;
  toggleSnap: () => void;
  togglePixelPerfectRotation: () => void;
  setPixelGridSize: (size: number) => void;
  setRotationSnapAngle: (angle: RotationSnapAngle) => void;
  beginTransform: (nodeId: NodeId) => void;
  updateNodeFrame: (nodeId: NodeId, patch: FrameStatePatch) => void;
  commitTransform: () => void;
  resetNodeTransform: (nodeId: NodeId) => void;
  flipNode: (nodeId: NodeId, axis: 'horizontal' | 'vertical') => void;
  updateNodePivot: (nodeId: NodeId, pivot: Vec2) => void;
  duplicateNode: (nodeId: NodeId) => void;
  deleteNode: (nodeId: NodeId) => void;
  undoTransform: () => void;
  redoTransform: () => void;
  createEmptyProject: () => void;
  createCharacterTemplateProject: () => void;
  loadProject: (project: SerializableProject, name: string) => void;
  setProjectName: (name: string) => void;
}

const demo = createDemoProject();

function snapshotNode(node: RigNode): NodeFrameState {
  return {
    position: { ...node.transform.position },
    rotation: node.transform.rotation,
    scale: { ...node.transform.scale },
    visible: node.visible,
    imageIndex: 0,
    sortingOrder: node.sortingOrder ?? 0,
  };
}

function createFrame(nodes: Record<NodeId, RigNode>): AnimationFrame {
  return {
    id: `frame-${crypto.randomUUID()}`,
    nodeStates: Object.fromEntries(Object.values(nodes).map((node) => [node.id, snapshotNode(node)])),
  };
}

function cloneFrame(frame: AnimationFrame): AnimationFrame {
  return {
    id: `frame-${crypto.randomUUID()}`,
    canvasData: frame.canvasData,
    group: frame.group ? { ...frame.group } : undefined,
    nodeStates: Object.fromEntries(
      Object.entries(frame.nodeStates).map(([nodeId, state]) => [
        nodeId,
        { ...state, position: { ...state.position }, scale: { ...state.scale } },
      ]),
    ),
  };
}

function cloneFrameState(state: NodeFrameState): NodeFrameState {
  return { ...state, position: { ...state.position }, scale: { ...state.scale } };
}

function cloneNodeTransform(transform: RigNode['transform']): RigNode['transform'] {
  return { ...transform, position: { ...transform.position }, scale: { ...transform.scale } };
}

function mergeFrameState(state: NodeFrameState, patch: FrameStatePatch): NodeFrameState {
  return {
    ...state,
    ...patch,
    position: { ...state.position, ...patch.position },
    scale: { ...state.scale, ...patch.scale },
  };
}

function stateMatches(left: NodeFrameState, right: NodeFrameState) {
  return left.position.x === right.position.x
    && left.position.y === right.position.y
    && left.rotation === right.rotation
    && left.scale.x === right.scale.x
    && left.scale.y === right.scale.y
    && left.visible === right.visible
    && left.imageIndex === right.imageIndex
    && left.sortingOrder === right.sortingOrder;
}

/**
 * Moving a pivot changes the point from which the texture is drawn. Offset the
 * node position by that same vector after rotation and scale so the rendered
 * pixels stay exactly where they were.
 */
function positionWithPivotCompensation(state: Pick<NodeFrameState, 'position' | 'rotation' | 'scale'>, pivotDelta: Vec2): Vec2 {
  const radians = state.rotation * Math.PI / 180;
  const x = pivotDelta.x * state.scale.x;
  const y = pivotDelta.y * state.scale.y;
  return {
    x: state.position.x + Math.cos(radians) * x - Math.sin(radians) * y,
    y: state.position.y + Math.sin(radians) * x + Math.cos(radians) * y,
  };
}

function capturePivotSnapshots(nodes: Record<NodeId, RigNode>, frames: AnimationFrame[], nodeIds: NodeId[]): Record<NodeId, PivotNodeSnapshot> {
  return Object.fromEntries(nodeIds.flatMap((nodeId) => {
    const node = nodes[nodeId];
    if (!node) return [];
    return [[nodeId, {
      pivot: { ...node.pivot },
      transform: cloneNodeTransform(node.transform),
      frameStates: frames.map((frame) => frame.nodeStates[nodeId] ? cloneFrameState(frame.nodeStates[nodeId]) : null),
    }]];
  })) as Record<NodeId, PivotNodeSnapshot>;
}

function restorePivotSnapshots(nodes: Record<NodeId, RigNode>, frames: AnimationFrame[], snapshots: Record<NodeId, PivotNodeSnapshot>) {
  const restoredNodes = { ...nodes };
  for (const [nodeId, snapshot] of Object.entries(snapshots)) {
    const node = restoredNodes[nodeId];
    if (node) restoredNodes[nodeId] = { ...node, pivot: { ...snapshot.pivot }, transform: cloneNodeTransform(snapshot.transform) };
  }
  const restoredFrames = frames.map((frame, index) => {
    const nodeStates = { ...frame.nodeStates };
    for (const [nodeId, snapshot] of Object.entries(snapshots)) {
      const nodeState = snapshot.frameStates[index];
      if (nodeState) nodeStates[nodeId] = cloneFrameState(nodeState);
      else delete nodeStates[nodeId];
    }
    return { ...frame, nodeStates };
  });
  return { nodes: restoredNodes, frames: restoredFrames };
}

function withFrameNodeState(frames: AnimationFrame[], frameIndex: number, nodeId: NodeId, nodeState: NodeFrameState) {
  return frames.map((frame, index) => index === frameIndex
    ? { ...frame, nodeStates: { ...frame.nodeStates, [nodeId]: cloneFrameState(nodeState) } }
    : frame);
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function lerpRotation(start: number, end: number, amount: number) {
  const shortestDelta = ((end - start + 540) % 360) - 180;
  return start + shortestDelta * amount;
}

function tweenNodeState(start: NodeFrameState, end: NodeFrameState, amount: number, properties: TweenProperties): NodeFrameState {
  return {
    position: properties.position ? { x: lerp(start.position.x, end.position.x, amount), y: lerp(start.position.y, end.position.y, amount) } : { ...start.position },
    rotation: properties.rotation ? lerpRotation(start.rotation, end.rotation, amount) : start.rotation,
    scale: properties.scale ? { x: lerp(start.scale.x, end.scale.x, amount), y: lerp(start.scale.y, end.scale.y, amount) } : { ...start.scale },
    visible: properties.visible && amount >= 0.5 ? end.visible : start.visible,
    imageIndex: properties.sprite && amount >= 0.5 ? end.imageIndex : start.imageIndex,
    sortingOrder: start.sortingOrder,
  };
}

function createEmptyNode(parentId: NodeId | null, name: string): RigNode {
  return {
    id: `node-${crypto.randomUUID()}`,
    name,
    parentId,
    children: [],
    assetIds: [],
    assetId: null,
    sortingOrder: 0,
    pivot: { x: 0, y: 0 },
    transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    visible: true,
    locked: false,
  };
}

interface TransformMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const identityMatrix: TransformMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function frameStateForNode(node: RigNode, frame: AnimationFrame): NodeFrameState {
  return frame.nodeStates[node.id] ?? snapshotNode(node);
}

function matrixFromFrameState(frameState: NodeFrameState): TransformMatrix {
  const radians = frameState.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    a: cosine * frameState.scale.x,
    b: sine * frameState.scale.x,
    c: -sine * frameState.scale.y,
    d: cosine * frameState.scale.y,
    e: frameState.position.x,
    f: frameState.position.y,
  };
}

function multiplyTransformMatrices(parent: TransformMatrix, child: TransformMatrix): TransformMatrix {
  return {
    a: parent.a * child.a + parent.c * child.b,
    b: parent.b * child.a + parent.d * child.b,
    c: parent.a * child.c + parent.c * child.d,
    d: parent.b * child.c + parent.d * child.d,
    e: parent.a * child.e + parent.c * child.f + parent.e,
    f: parent.b * child.e + parent.d * child.f + parent.f,
  };
}

function invertTransformMatrix(matrix: TransformMatrix): TransformMatrix | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) < 0.000001) return null;
  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
  };
}

function worldMatrixForNode(nodes: Record<NodeId, RigNode>, frame: AnimationFrame, nodeId: NodeId, cache: Map<NodeId, TransformMatrix>): TransformMatrix {
  const cached = cache.get(nodeId);
  if (cached) return cached;
  const node = nodes[nodeId];
  if (!node) return identityMatrix;
  const parent = node.parentId ? worldMatrixForNode(nodes, frame, node.parentId, cache) : identityMatrix;
  const matrix = multiplyTransformMatrices(parent, matrixFromFrameState(frameStateForNode(node, frame)));
  cache.set(nodeId, matrix);
  return matrix;
}

function stateWithMatrixTransform(state: NodeFrameState, matrix: TransformMatrix): NodeFrameState {
  const scaleX = Math.hypot(matrix.a, matrix.b);
  if (scaleX < 0.000001) return { ...state, position: { x: matrix.e, y: matrix.f } };
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  return {
    ...state,
    position: { x: matrix.e, y: matrix.f },
    rotation: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI,
    scale: { x: scaleX, y: determinant / scaleX },
  };
}

function defaultTransformFrame(nodes: Record<NodeId, RigNode>): AnimationFrame {
  return { id: 'default-transforms', nodeStates: Object.fromEntries(Object.values(nodes).map((node) => [node.id, snapshotNode(node)])) };
}

function descendantsOf(nodes: Record<NodeId, RigNode>, nodeId: NodeId): NodeId[] {
  const node = nodes[nodeId];
  if (!node) return [];
  return [nodeId, ...node.children.flatMap((childId) => descendantsOf(nodes, childId))];
}

function describeNode(node: RigNode) {
  return `${node.id} ${node.name}`.toLowerCase();
}

function findCharacterNode(nodes: Record<NodeId, RigNode>, terms: string[]) {
  return Object.values(nodes).find((node) => terms.some((term) => describeNode(node).includes(term)));
}

function findLimbNode(nodes: Record<NodeId, RigNode>, side: 'left' | 'right', limb: 'arm' | 'leg') {
  const sideTerms = side === 'left' ? ['left', '左'] : ['right', '右'];
  const limbTerms = limb === 'arm' ? ['arm', 'hand', '臂', '手'] : ['leg', 'foot', '腿', '脚'];
  return Object.values(nodes).find((node) => {
    const description = describeNode(node);
    return sideTerms.some((term) => description.includes(term)) && limbTerms.some((term) => description.includes(term));
  });
}

function framesForTemplate(state: Pick<ProjectState, 'nodes' | 'rootNodeIds' | 'frames' | 'currentFrameIndex'>, template: AnimationTemplate) {
  const baseFrame = state.frames[state.currentFrameIndex];
  const baseStates = Object.fromEntries(Object.values(state.nodes).map((node) => [node.id, cloneFrameState(baseFrame?.nodeStates[node.id] ?? snapshotNode(node))])) as Record<NodeId, NodeFrameState>;
  const leftArm = findLimbNode(state.nodes, 'left', 'arm');
  const rightArm = findLimbNode(state.nodes, 'right', 'arm');
  const leftLeg = findLimbNode(state.nodes, 'left', 'leg');
  const rightLeg = findLimbNode(state.nodes, 'right', 'leg');
  const body = findCharacterNode(state.nodes, ['body', 'torso', '身体', '躯干']) ?? state.nodes[state.rootNodeIds[0] ?? ''];
  const head = findCharacterNode(state.nodes, ['head', '头']);
  const walkSwing = [0, 24, 24, 0, -24, -24];
  const bodyBob = [0, 0, 1, 1, 0, -1];
  const headBob = [0, -1, -1, 0, 1, 1];

  return Array.from({ length: 6 }, (_, index): AnimationFrame => {
    const nodeStates = Object.fromEntries(Object.entries(baseStates).map(([nodeId, frameState]) => [nodeId, cloneFrameState(frameState)])) as Record<NodeId, NodeFrameState>;
    if (template === 'walk') {
      const swing = walkSwing[index];
      if (leftArm) nodeStates[leftArm.id].rotation += swing;
      if (rightArm) nodeStates[rightArm.id].rotation -= swing;
      if (leftLeg) nodeStates[leftLeg.id].rotation -= swing;
      if (rightLeg) nodeStates[rightLeg.id].rotation += swing;
    } else {
      if (body) nodeStates[body.id].position.y += bodyBob[index];
      if (head) nodeStates[head.id].position.y += headBob[index];
    }
    return { id: `frame-${crypto.randomUUID()}`, nodeStates };
  });
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  ...demo,
  projectName: 'Untitled character',
  frames: [createFrame(demo.nodes)],
  currentFrameIndex: 0,
  isPlaying: false,
  playbackGroupId: null,
  isLooping: true,
  onionSkinEnabled: false,
  fps: 12,
  activeTool: 'move',
  showPivot: false,
  snapEnabled: false,
  transformSession: null,
  transformHistory: [],
  redoStack: [],
  selectedNodeId: 'body',
  selectedAssetId: null,
  selectedAssetIds: [],
  selectNode: (selectedNodeId) => set({ selectedNodeId, selectedAssetId: null, selectedAssetIds: [] }),
  selectAsset: (selectedAssetId) => set({ selectedAssetId, selectedAssetIds: selectedAssetId ? [selectedAssetId] : [] }),
  selectAssets: (ids, primaryId = null) =>
    set((state) => {
      const selectedAssetIds = [...new Set(ids)].filter((id) => Boolean(state.assets[id]));
      return {
        selectedAssetIds,
        selectedAssetId: primaryId && selectedAssetIds.includes(primaryId) ? primaryId : selectedAssetIds[selectedAssetIds.length - 1] ?? null,
      };
    }),
  addAssets: (newAssets) =>
    set((state) => ({
      assets: {
        ...state.assets,
        ...Object.fromEntries(newAssets.map((asset) => [asset.id, asset])),
      },
      selectedAssetId: newAssets.length ? newAssets[newAssets.length - 1].id : state.selectedAssetId,
      selectedAssetIds: newAssets.length ? [newAssets[newAssets.length - 1].id] : state.selectedAssetIds,
    })),
  replaceAssets: (updatedAssets) =>
    set((state) => ({
      assets: {
        ...state.assets,
        ...Object.fromEntries(updatedAssets.filter((asset) => state.assets[asset.id]).map((asset) => [asset.id, asset])),
      },
    })),
  updateAssetSource: (id, src, width, height) =>
    set((state) => {
      const asset = state.assets[id];
      if (!asset) return {};
      return { assets: { ...state.assets, [id]: { ...asset, src, width, height } } };
    }),
  deleteAsset: (id) =>
    set((state) => {
      if (!state.assets[id]) return {};
      const { [id]: _, ...assets } = state.assets;
      const selectedAssetIds = state.selectedAssetIds.filter((assetId) => assetId !== id);
      return {
        assets,
        nodes: Object.fromEntries(Object.entries(state.nodes).map(([nodeId, node]) => {
          const previousIds = nodeSpriteIds(node);
          const removedIndex = previousIds.indexOf(id);
          const assetIds = previousIds.filter((assetId) => assetId !== id);
          return [nodeId, removedIndex >= 0 ? { ...node, assetIds, assetId: assetIds[0] ?? null } : node];
        })) as Record<NodeId, RigNode>,
        frames: state.frames.map((frame) => ({
          ...frame,
          nodeStates: Object.fromEntries(Object.entries(frame.nodeStates).map(([nodeId, nodeState]) => {
            const previousIds = state.nodes[nodeId] ? nodeSpriteIds(state.nodes[nodeId]) : [];
            const removedIndex = previousIds.indexOf(id);
            if (removedIndex < 0) return [nodeId, nodeState];
            const imageIndex = nodeState.imageIndex > removedIndex ? nodeState.imageIndex - 1 : Math.min(nodeState.imageIndex, Math.max(0, previousIds.length - 2));
            return [nodeId, { ...nodeState, imageIndex }];
          })),
        })),
        selectedAssetIds,
        selectedAssetId: state.selectedAssetId === id
          ? selectedAssetIds[selectedAssetIds.length - 1] ?? null
          : state.selectedAssetId,
      };
    }),
  createNodeForAsset: (assetId) => {
    const asset = get().assets[assetId];
    if (!asset) return;

    const id = `node-${crypto.randomUUID()}`;
    const node: RigNode = {
      id,
      name: asset.name.replace(/\.png$/i, ''),
      parentId: null,
      children: [],
      assetIds: [assetId],
      assetId,
      sortingOrder: 0,
      pivot: { x: Math.floor(asset.width / 2), y: Math.floor(asset.height / 2) },
      transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
      visible: true,
      locked: false,
    };
    set((state) => ({
      nodes: { ...state.nodes, [id]: node },
      rootNodeIds: [...state.rootNodeIds, id],
      frames: state.frames.map((frame) => ({
        ...frame,
        nodeStates: { ...frame.nodeStates, [id]: snapshotNode(node) },
      })),
      selectedNodeId: id,
      selectedAssetId: null,
      selectedAssetIds: [],
    }));
  },
  setNodeAsset: (nodeId, assetId) => {
    const node = get().nodes[nodeId];
    if (!node) return;
    const existingIndex = nodeSpriteIds(node).indexOf(assetId);
    if (existingIndex >= 0) get().setNodeFrameSprite(nodeId, existingIndex);
    else get().addNodeSprites(nodeId, [assetId]);
  },
  addNodeSprites: (nodeId, assetIds) =>
    set((state) => {
      const node = state.nodes[nodeId];
      if (!node) return {};
      const existing = nodeSpriteIds(node);
      const validNewIds = assetIds.filter((assetId) => Boolean(state.assets[assetId]) && !existing.includes(assetId));
      if (!validNewIds.length) return {};
      const nextIds = [...existing, ...validNewIds];
      const selectedIndex = nextIds.indexOf(validNewIds[validNewIds.length - 1]);
      const firstAsset = !existing.length ? state.assets[validNewIds[0]] : null;
      return {
        nodes: {
          ...state.nodes,
          [nodeId]: {
            ...node,
            assetIds: nextIds,
            assetId: nextIds[0] ?? null,
            pivot: firstAsset ? { x: Math.floor(firstAsset.width / 2), y: Math.floor(firstAsset.height / 2) } : node.pivot,
          },
        },
        frames: state.frames.map((frame, index) => index === state.currentFrameIndex
          ? { ...frame, nodeStates: { ...frame.nodeStates, [nodeId]: { ...(frame.nodeStates[nodeId] ?? snapshotNode(node)), imageIndex: selectedIndex } } }
          : frame),
      };
    }),
  removeNodeSprite: (nodeId, assetId) =>
    set((state) => {
      const node = state.nodes[nodeId];
      if (!node) return {};
      const previousIds = nodeSpriteIds(node);
      const removedIndex = previousIds.indexOf(assetId);
      if (removedIndex < 0) return {};
      const assetIds = previousIds.filter((id) => id !== assetId);
      return {
        nodes: { ...state.nodes, [nodeId]: { ...node, assetIds, assetId: assetIds[0] ?? null } },
        frames: state.frames.map((frame) => {
          const nodeState = frame.nodeStates[nodeId] ?? snapshotNode(node);
          const imageIndex = nodeState.imageIndex > removedIndex ? nodeState.imageIndex - 1 : Math.min(nodeState.imageIndex, Math.max(0, assetIds.length - 1));
          return { ...frame, nodeStates: { ...frame.nodeStates, [nodeId]: { ...nodeState, imageIndex } } };
        }),
      };
    }),
  setNodeFrameSprite: (nodeId, imageIndex) =>
    set((state) => {
      const node = state.nodes[nodeId];
      const frame = state.frames[state.currentFrameIndex];
      if (!node || !frame) return {};
      const maxIndex = Math.max(0, nodeSpriteIds(node).length - 1);
      const nextIndex = Math.max(0, Math.min(maxIndex, Math.round(imageIndex)));
      return {
        frames: withFrameNodeState(state.frames, state.currentFrameIndex, nodeId, {
          ...(frame.nodeStates[nodeId] ?? snapshotNode(node)),
          imageIndex: nextIndex,
        }),
      };
    }),
  renameNode: (nodeId, name) =>
    set((state) => {
      const node = state.nodes[nodeId];
      if (!node) return {};
      return { nodes: { ...state.nodes, [nodeId]: { ...node, name: name.trim() || 'Node' } } };
    }),
  addRootNode: () =>
    set((state) => {
      const node = createEmptyNode(null, 'New Node');
      return {
        nodes: { ...state.nodes, [node.id]: node },
        rootNodeIds: [...state.rootNodeIds, node.id],
        frames: state.frames.map((frame) => ({ ...frame, nodeStates: { ...frame.nodeStates, [node.id]: snapshotNode(node) } })),
        selectedNodeId: node.id,
        selectedAssetId: null,
        selectedAssetIds: [],
      };
    }),
  addChildNode: (parentId) =>
    set((state) => {
      const parent = state.nodes[parentId];
      if (!parent) return {};
      const child = createEmptyNode(parentId, 'New Child');
      return {
        nodes: { ...state.nodes, [child.id]: child, [parentId]: { ...parent, children: [...parent.children, child.id] } },
        frames: state.frames.map((frame) => ({ ...frame, nodeStates: { ...frame.nodeStates, [child.id]: snapshotNode(child) } })),
        selectedNodeId: child.id,
        selectedAssetId: null,
        selectedAssetIds: [],
      };
    }),
  reparentNode: (nodeId, parentId) =>
    set((state) => {
      const node = state.nodes[nodeId];
      if (!node || node.parentId === parentId || (parentId && !state.nodes[parentId])) return {};
      if (parentId && descendantsOf(state.nodes, nodeId).includes(parentId)) return {};
      const defaults = defaultTransformFrame(state.nodes);
      const defaultCache = new Map<NodeId, TransformMatrix>();
      const oldDefaultWorld = worldMatrixForNode(state.nodes, defaults, nodeId, defaultCache);
      const newParentDefaultWorld = parentId ? worldMatrixForNode(state.nodes, defaults, parentId, defaultCache) : identityMatrix;
      const inverseDefaultParent = invertTransformMatrix(newParentDefaultWorld);
      if (!inverseDefaultParent) return {};
      const defaultState = stateWithMatrixTransform(snapshotNode(node), multiplyTransformMatrices(inverseDefaultParent, oldDefaultWorld));
      let nodes: Record<NodeId, RigNode> = {
        ...state.nodes,
        [nodeId]: {
          ...node,
          parentId,
          transform: { position: defaultState.position, rotation: defaultState.rotation, scale: defaultState.scale },
        },
      };
      if (node.parentId) {
        const oldParent = nodes[node.parentId];
        nodes = { ...nodes, [oldParent.id]: { ...oldParent, children: oldParent.children.filter((childId) => childId !== nodeId) } };
      }
      if (parentId) {
        const newParent = nodes[parentId];
        nodes = { ...nodes, [parentId]: { ...newParent, children: [...newParent.children, nodeId] } };
      }
      const rootNodeIds = state.rootNodeIds.filter((id) => id !== nodeId);
      if (!parentId) rootNodeIds.push(nodeId);
      const frames = state.frames.map((frame) => {
        const cache = new Map<NodeId, TransformMatrix>();
        const oldWorld = worldMatrixForNode(state.nodes, frame, nodeId, cache);
        const newParentWorld = parentId ? worldMatrixForNode(state.nodes, frame, parentId, cache) : identityMatrix;
        const inverseParent = invertTransformMatrix(newParentWorld);
        if (!inverseParent) return frame;
        const current = frameStateForNode(node, frame);
        return { ...frame, nodeStates: { ...frame.nodeStates, [nodeId]: stateWithMatrixTransform(current, multiplyTransformMatrices(inverseParent, oldWorld)) } };
      });
      return { nodes, rootNodeIds, frames };
    }),
  setNodeSortingOrder: (nodeId, sortingOrder) =>
    set((state) => {
      const node = state.nodes[nodeId];
      const frame = state.frames[state.currentFrameIndex];
      if (!node || !frame) return {};
      const nodeState = frame.nodeStates[nodeId] ?? snapshotNode(node);
      return {
        frames: withFrameNodeState(state.frames, state.currentFrameIndex, nodeId, {
          ...nodeState,
          sortingOrder: Number.isFinite(sortingOrder) ? Math.round(sortingOrder) : 0,
        }),
      };
    }),
  toggleNodeVisibility: (id) =>
    set((state) => ({
      nodes: { ...state.nodes, [id]: { ...state.nodes[id], visible: !state.nodes[id].visible } },
    })),
  toggleNodeLock: (id) =>
    set((state) => ({
      nodes: { ...state.nodes, [id]: { ...state.nodes[id], locked: !state.nodes[id].locked } },
    })),
  selectFrame: (index) =>
    set((state) => ({
      currentFrameIndex: Math.min(Math.max(0, index), state.frames.length - 1),
      isPlaying: false,
      playbackGroupId: null,
    })),
  togglePlayback: () =>
    set((state) => {
      if (state.isPlaying) return { isPlaying: false, playbackGroupId: null };
      return {
        isPlaying: true,
        playbackGroupId: state.frames[state.currentFrameIndex]?.group?.id ?? null,
      };
    }),
  advanceFrame: () =>
    set((state) => {
      const playbackIndexes = state.playbackGroupId
        ? state.frames.flatMap((frame, index) => frame.group?.id === state.playbackGroupId ? [index] : [])
        : state.frames.map((_, index) => index);
      if (!playbackIndexes.length) return { isPlaying: false, playbackGroupId: null };

      const playbackPosition = playbackIndexes.indexOf(state.currentFrameIndex);
      if (playbackPosition < 0) return { currentFrameIndex: playbackIndexes[0] };
      if (playbackPosition < playbackIndexes.length - 1) {
        return { currentFrameIndex: playbackIndexes[playbackPosition + 1] };
      }
      if (state.isLooping) return { currentFrameIndex: playbackIndexes[0] };
      return { isPlaying: false, playbackGroupId: null };
    }),
  toggleLooping: () => set((state) => ({ isLooping: !state.isLooping })),
  toggleOnionSkin: () => set((state) => ({ onionSkinEnabled: !state.onionSkinEnabled })),
  setFps: (fps) => set({ fps: Number.isFinite(fps) ? Math.min(60, Math.max(1, Math.round(fps))) : 12 }),
  insertFrame: () =>
    set((state) => {
      const nextIndex = state.currentFrameIndex + 1;
      const frames = [...state.frames];
      frames.splice(nextIndex, 0, createFrame(state.nodes));
      return { frames, currentFrameIndex: nextIndex, isPlaying: false };
    }),
  duplicateFrame: () =>
    set((state) => {
      const nextIndex = state.currentFrameIndex + 1;
      const frames = [...state.frames];
      frames.splice(nextIndex, 0, cloneFrame(frames[state.currentFrameIndex]));
      return { frames, currentFrameIndex: nextIndex, isPlaying: false };
    }),
  deleteFrame: () =>
    set((state) => {
      if (state.frames.length === 1) return { isPlaying: false };
      const frames = state.frames.filter((_, index) => index !== state.currentFrameIndex);
      return {
        frames,
        currentFrameIndex: Math.min(state.currentFrameIndex, frames.length - 1),
        isPlaying: false,
      };
    }),
  moveFrame: (fromIndex, toIndex) =>
    set((state) => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= state.frames.length || toIndex >= state.frames.length) return {};
      const frames = [...state.frames];
      const [movedFrame] = frames.splice(fromIndex, 1);
      frames.splice(toIndex, 0, movedFrame);
      return { frames, currentFrameIndex: toIndex, isPlaying: false, transformSession: null };
    }),
  insertTweenFrames: (firstIndex, secondIndex, requestedCount, properties) =>
    set((state) => {
      const startIndex = Math.min(firstIndex, secondIndex);
      const endIndex = Math.max(firstIndex, secondIndex);
      const startFrame = state.frames[startIndex];
      const endFrame = state.frames[endIndex];
      const count = Math.max(1, Math.min(120, Math.round(requestedCount)));
      if (!startFrame || !endFrame || startIndex === endIndex || !Object.values(properties).some(Boolean)) return {};
      const tweenFrames = Array.from({ length: count }, (_, index): AnimationFrame => {
        const amount = (index + 1) / (count + 1);
        return {
          id: `frame-${crypto.randomUUID()}`,
          nodeStates: Object.fromEntries(Object.values(state.nodes).map((node) => {
            const start = startFrame.nodeStates[node.id] ?? snapshotNode(node);
            const end = endFrame.nodeStates[node.id] ?? snapshotNode(node);
            return [node.id, tweenNodeState(start, end, amount, properties)];
          })),
        };
      });
      const frames = [...state.frames];
      frames.splice(startIndex + 1, 0, ...tweenFrames);
      return { frames, currentFrameIndex: startIndex + 1, isPlaying: false, transformSession: null };
    }),
  groupFrames: (frameIndexes, name, color) =>
    set((state) => {
      const selected = new Set(frameIndexes.filter((index) => index >= 0 && index < state.frames.length));
      if (!selected.size) return {};
      const group: FrameGroup = {
        id: `group-${crypto.randomUUID()}`,
        name: name.trim() || 'Frame Group',
        color,
      };
      return {
        frames: state.frames.map((frame, index) => selected.has(index) ? { ...frame, group: { ...group } } : frame),
        isPlaying: false,
      };
    }),
  renameFrameGroup: (groupId, name, color) =>
    set((state) => ({
      frames: state.frames.map((frame) => frame.group?.id === groupId
        ? { ...frame, group: { id: groupId, name: name.trim() || 'Frame Group', color } }
        : frame),
    })),
  ungroupFrames: (groupId) =>
    set((state) => ({
      frames: state.frames.map((frame) => {
        if (frame.group?.id !== groupId) return frame;
        const { group: _, ...ungrouped } = frame;
        return ungrouped;
      }),
    })),
  updateCanvasFrame: (canvasData) =>
    set((state) => ({
      frames: state.frames.map((frame, index) => index === state.currentFrameIndex ? { ...frame, canvasData } : frame),
      isPlaying: false,
    })),
  applyAnimationTemplate: (template) =>
    set((state) => {
      const nextIndex = state.currentFrameIndex + 1;
      const frames = [...state.frames];
      frames.splice(nextIndex, 0, ...framesForTemplate(state, template));
      return {
        frames,
        currentFrameIndex: nextIndex,
        isPlaying: false,
        transformSession: null,
      };
    }),
  loadAnimation: (animation) => {
    const state = get();
    const matchedNodeIds = Object.keys(state.nodes).filter((nodeId) => animation.frames.some((frame) => Boolean(frame.nodeStates[nodeId])));
    if (!matchedNodeIds.length) return false;
    const frames = animation.frames.map((frame) => ({
      id: `frame-${crypto.randomUUID()}`,
      canvasData: frame.canvasData,
      group: frame.group ? { ...frame.group } : undefined,
      nodeStates: Object.fromEntries(Object.values(state.nodes).map((node) => [
        node.id,
        cloneFrameState(frame.nodeStates[node.id] ?? snapshotNode(node)),
      ])) as Record<NodeId, NodeFrameState>,
    }));
    set({
      frames,
      currentFrameIndex: 0,
      isPlaying: false,
      playbackGroupId: null,
      isLooping: animation.loop,
      fps: animation.fps,
      transformSession: null,
      transformHistory: [],
      redoStack: [],
    });
    return true;
  },
  setActiveTool: (activeTool) => set({ activeTool }),
  toggleShowPivot: () => set((state) => ({ showPivot: !state.showPivot })),
  toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),
  togglePixelPerfectRotation: () => set((state) => ({
    settings: { ...state.settings, pixelPerfectRotation: !state.settings.pixelPerfectRotation },
  })),
  setPixelGridSize: (size) => set((state) => ({
    settings: { ...state.settings, pixelGridSize: Math.max(1, Math.min(16, Math.round(size || 1))) },
  })),
  setRotationSnapAngle: (rotationSnapAngle) => set((state) => ({
    settings: { ...state.settings, rotationSnapAngle },
  })),
  beginTransform: (nodeId) =>
    set((state) => {
      const node = state.nodes[nodeId];
      const frame = state.frames[state.currentFrameIndex];
      if (!node || node.locked || !frame) return {};
      const before = frame.nodeStates[nodeId] ?? snapshotNode(node);
      const frames = frame.nodeStates[nodeId]
        ? state.frames
        : withFrameNodeState(state.frames, state.currentFrameIndex, nodeId, before);
      return {
        frames,
        transformSession: { nodeId, frameIndex: state.currentFrameIndex, before: cloneFrameState(before) },
      };
    }),
  updateNodeFrame: (nodeId, patch) =>
    set((state) => {
      const node = state.nodes[nodeId];
      const frame = state.frames[state.currentFrameIndex];
      if (!node || node.locked || !frame) return {};
      const current = frame.nodeStates[nodeId] ?? snapshotNode(node);
      const angleIncrement = state.settings.rotationSnapAngle;
      const snappedPatch = patch.rotation !== undefined && angleIncrement > 0
        ? { ...patch, rotation: Math.round(patch.rotation / angleIncrement) * angleIncrement }
        : patch;
      return { frames: withFrameNodeState(state.frames, state.currentFrameIndex, nodeId, mergeFrameState(current, snappedPatch)) };
    }),
  commitTransform: () =>
    set((state) => {
      const session = state.transformSession;
      if (!session) return {};
      const node = state.nodes[session.nodeId];
      const frame = state.frames[session.frameIndex];
      const after = node && frame ? frame.nodeStates[session.nodeId] ?? snapshotNode(node) : session.before;
      if (stateMatches(session.before, after)) return { transformSession: null };
      const entry: TransformHistoryEntry = { ...session, before: cloneFrameState(session.before), after: cloneFrameState(after) };
      return {
        transformSession: null,
        transformHistory: [...state.transformHistory.slice(-39), entry],
        redoStack: [],
      };
    }),
  resetNodeTransform: (nodeId) =>
    set((state) => {
      const node = state.nodes[nodeId];
      const frame = state.frames[state.currentFrameIndex];
      if (!node || node.locked || !frame) return {};
      const before = frame.nodeStates[nodeId] ?? snapshotNode(node);
      const after: NodeFrameState = { ...snapshotNode(node), visible: before.visible, imageIndex: before.imageIndex, sortingOrder: before.sortingOrder };
      if (stateMatches(before, after)) return {};
      const entry: TransformHistoryEntry = { nodeId, frameIndex: state.currentFrameIndex, before: cloneFrameState(before), after: cloneFrameState(after) };
      return {
        frames: withFrameNodeState(state.frames, state.currentFrameIndex, nodeId, after),
        transformHistory: [...state.transformHistory.slice(-39), entry],
        redoStack: [],
      };
    }),
  flipNode: (nodeId, axis) =>
    set((state) => {
      const node = state.nodes[nodeId];
      const frame = state.frames[state.currentFrameIndex];
      if (!node || node.locked || !frame) return {};
      const before = frame.nodeStates[nodeId] ?? snapshotNode(node);
      const after = mergeFrameState(before, axis === 'horizontal'
        ? { scale: { x: -before.scale.x } }
        : { scale: { y: -before.scale.y } });
      const entry: TransformHistoryEntry = { nodeId, frameIndex: state.currentFrameIndex, before: cloneFrameState(before), after: cloneFrameState(after) };
      return {
        frames: withFrameNodeState(state.frames, state.currentFrameIndex, nodeId, after),
        transformHistory: [...state.transformHistory.slice(-39), entry],
        redoStack: [],
      };
    }),
  updateNodePivot: (nodeId, pivot) =>
    set((state) => {
      const node = state.nodes[nodeId];
      if (!node || node.locked) return {};
      const nextPivot = { x: Math.round(pivot.x), y: Math.round(pivot.y) };
      const pivotDelta = { x: nextPivot.x - node.pivot.x, y: nextPivot.y - node.pivot.y };
      if (!pivotDelta.x && !pivotDelta.y) return {};
      const affectedNodeIds = [nodeId, ...node.children.filter((childId) => Boolean(state.nodes[childId]))];
      const nextTransform = {
        ...node.transform,
        position: positionWithPivotCompensation(node.transform, pivotDelta),
      };
      const nextNodes: Record<NodeId, RigNode> = {
        ...state.nodes,
        [nodeId]: { ...node, pivot: nextPivot, transform: nextTransform },
      };
      node.children.forEach((childId) => {
        const child = state.nodes[childId];
        if (!child) return;
        nextNodes[childId] = {
          ...child,
          transform: {
            ...child.transform,
            position: { x: child.transform.position.x - pivotDelta.x, y: child.transform.position.y - pivotDelta.y },
          },
        };
      });
      const nextFrames = state.frames.map((frame) => {
        const nodeState = frame.nodeStates[nodeId] ?? snapshotNode(node);
        const nodeStates = {
          ...frame.nodeStates,
          [nodeId]: {
            ...nodeState,
            position: positionWithPivotCompensation(nodeState, pivotDelta),
          },
        };
        node.children.forEach((childId) => {
          const child = state.nodes[childId];
          if (!child) return;
          const childState = frame.nodeStates[childId] ?? snapshotNode(child);
          nodeStates[childId] = {
            ...childState,
            position: { x: childState.position.x - pivotDelta.x, y: childState.position.y - pivotDelta.y },
          };
        });
        return { ...frame, nodeStates };
      });
      const historyEntry: PivotHistoryEntry = {
        snapshots: {
          before: capturePivotSnapshots(state.nodes, state.frames, affectedNodeIds),
          after: capturePivotSnapshots(nextNodes, nextFrames, affectedNodeIds),
        },
      };
      return {
        nodes: nextNodes,
        frames: nextFrames,
        transformHistory: [...state.transformHistory.slice(-39), historyEntry],
        redoStack: [],
      };
    }),
  duplicateNode: (nodeId) =>
    set((state) => {
      const source = state.nodes[nodeId];
      if (!source) return {};
      const id = `node-${crypto.randomUUID()}`;
      const copy: RigNode = { ...source, id, name: `${source.name} Copy`, children: [], assetIds: [...nodeSpriteIds(source)], transform: { ...source.transform, position: { ...source.transform.position }, scale: { ...source.transform.scale } }, pivot: { ...source.pivot } };
      const parent = source.parentId ? state.nodes[source.parentId] : null;
      const nodes = {
        ...state.nodes,
        [id]: copy,
        ...(parent ? { [parent.id]: { ...parent, children: [...parent.children, id] } } : {}),
      };
      const rootNodeIds = parent ? state.rootNodeIds : [...state.rootNodeIds, id];
      return {
        nodes,
        rootNodeIds,
        frames: state.frames.map((frame) => ({
          ...frame,
          nodeStates: { ...frame.nodeStates, [id]: cloneFrameState(frame.nodeStates[nodeId] ?? snapshotNode(source)) },
        })),
        selectedNodeId: id,
      };
    }),
  deleteNode: (nodeId) =>
    set((state) => {
      const node = state.nodes[nodeId];
      if (!node) return {};
      const deletedIds = new Set(descendantsOf(state.nodes, nodeId));
      const nodes = Object.fromEntries(Object.entries(state.nodes)
        .filter(([id]) => !deletedIds.has(id))
        .map(([id, item]) => [id, { ...item, children: item.children.filter((childId) => !deletedIds.has(childId)) }])) as Record<NodeId, RigNode>;
      return {
        nodes,
        rootNodeIds: state.rootNodeIds.filter((id) => !deletedIds.has(id)),
        frames: state.frames.map((frame) => ({
          ...frame,
          nodeStates: Object.fromEntries(Object.entries(frame.nodeStates).filter(([id]) => !deletedIds.has(id))),
        })),
        selectedNodeId: null,
      };
    }),
  undoTransform: () =>
    set((state) => {
      const entry = state.transformHistory[state.transformHistory.length - 1];
      if (!entry) return {};
      if ('snapshots' in entry) {
        const restored = restorePivotSnapshots(state.nodes, state.frames, entry.snapshots.before);
        return {
          ...restored,
          transformHistory: state.transformHistory.slice(0, -1),
          redoStack: [...state.redoStack, entry],
          transformSession: null,
        };
      }
      if (!state.nodes[entry.nodeId]) return {};
      return {
        frames: withFrameNodeState(state.frames, entry.frameIndex, entry.nodeId, entry.before),
        transformHistory: state.transformHistory.slice(0, -1),
        redoStack: [...state.redoStack, entry],
        transformSession: null,
      };
    }),
  redoTransform: () =>
    set((state) => {
      const entry = state.redoStack[state.redoStack.length - 1];
      if (!entry) return {};
      if ('snapshots' in entry) {
        const restored = restorePivotSnapshots(state.nodes, state.frames, entry.snapshots.after);
        return {
          ...restored,
          transformHistory: [...state.transformHistory, entry],
          redoStack: state.redoStack.slice(0, -1),
          transformSession: null,
        };
      }
      if (!state.nodes[entry.nodeId]) return {};
      return {
        frames: withFrameNodeState(state.frames, entry.frameIndex, entry.nodeId, entry.after),
        transformHistory: [...state.transformHistory, entry],
        redoStack: state.redoStack.slice(0, -1),
        transformSession: null,
      };
    }),
  createEmptyProject: () => {
    const nodes: Record<NodeId, RigNode> = {};
    set({
      assets: {},
      nodes,
      rootNodeIds: [],
      folders: ['All sprites', 'Body', 'Head', 'Hair', 'Hands', 'Legs', 'Weapons', 'Effects'],
      settings: {
        canvasSize: { x: 320, y: 240 },
        gridSize: 8,
        pixelPerfectRotation: true,
        pixelGridSize: 1,
        rotationSnapAngle: 0,
      },
      projectName: 'Untitled project',
      frames: [createFrame(nodes)],
      currentFrameIndex: 0,
      isPlaying: false,
      playbackGroupId: null,
      isLooping: true,
      onionSkinEnabled: false,
      fps: 12,
      activeTool: 'move',
      showPivot: false,
      snapEnabled: false,
      transformSession: null,
      transformHistory: [],
      redoStack: [],
      selectedNodeId: null,
      selectedAssetId: null,
      selectedAssetIds: [],
    });
  },
  createCharacterTemplateProject: () => {
    const template = createDemoProject();
    set({
      ...template,
      projectName: 'Character template',
      frames: [createFrame(template.nodes)],
      currentFrameIndex: 0,
      isPlaying: false,
      playbackGroupId: null,
      isLooping: true,
      onionSkinEnabled: false,
      fps: 12,
      activeTool: 'move',
      showPivot: false,
      snapEnabled: false,
      transformSession: null,
      transformHistory: [],
      redoStack: [],
      selectedNodeId: 'body',
      selectedAssetId: null,
      selectedAssetIds: [],
    });
  },
  loadProject: (project, name) =>
    set({
      assets: project.assets,
      nodes: project.nodes,
      rootNodeIds: project.rootNodeIds,
      folders: ['All sprites', ...Array.from(new Set(Object.values(project.assets).map((asset) => asset.folder))).filter(Boolean)],
      settings: normalizeProjectSettings(project.settings),
      frames: project.frames.length ? project.frames : [createFrame(project.nodes)],
      currentFrameIndex: 0,
      isPlaying: false,
      playbackGroupId: null,
      isLooping: project.isLooping,
      onionSkinEnabled: false,
      fps: project.fps,
      selectedNodeId: project.rootNodeIds[0] ?? null,
      selectedAssetId: null,
      selectedAssetIds: [],
      activeTool: 'move',
      transformSession: null,
      transformHistory: [],
      redoStack: [],
      projectName: name,
    }),
  setProjectName: (projectName) => set({ projectName }),
}));
