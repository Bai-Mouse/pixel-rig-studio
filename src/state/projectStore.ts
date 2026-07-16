import { create } from 'zustand';
import type { AnimationFrame, AnimationTemplate, AssetId, NodeFrameState, NodeId, ProjectSettings, RigNode, RotationSnapAngle, SpriteAsset, TransformTool, Vec2 } from '../types/project';
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
  renameNode: (nodeId: NodeId, name: string) => void;
  addChildNode: (parentId: NodeId) => void;
  reparentNode: (nodeId: NodeId, parentId: NodeId | null) => void;
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
    && left.imageIndex === right.imageIndex;
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
        nodes: Object.fromEntries(Object.entries(state.nodes).map(([nodeId, node]) => [nodeId, node.assetId === id ? { ...node, assetId: null } : node])) as Record<NodeId, RigNode>,
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
      assetId,
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
  setNodeAsset: (nodeId, assetId) =>
    set((state) => {
      const node = state.nodes[nodeId];
      const asset = state.assets[assetId];
      if (!node || !asset) return {};
      return {
        nodes: {
          ...state.nodes,
          [nodeId]: {
            ...node,
            assetId,
            pivot: { x: Math.min(Math.max(0, node.pivot.x), asset.width), y: Math.min(Math.max(0, node.pivot.y), asset.height) },
          },
        },
      };
    }),
  renameNode: (nodeId, name) =>
    set((state) => {
      const node = state.nodes[nodeId];
      if (!node) return {};
      return { nodes: { ...state.nodes, [nodeId]: { ...node, name: name.trim() || 'Node' } } };
    }),
  addChildNode: (parentId) =>
    set((state) => {
      const parent = state.nodes[parentId];
      if (!parent) return {};
      const id = `node-${crypto.randomUUID()}`;
      const child: RigNode = {
        id,
        name: 'New Child',
        parentId,
        children: [],
        assetId: null,
        pivot: { x: 0, y: 0 },
        transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
        visible: true,
        locked: false,
      };
      return {
        nodes: { ...state.nodes, [id]: child, [parentId]: { ...parent, children: [...parent.children, id] } },
        frames: state.frames.map((frame) => ({ ...frame, nodeStates: { ...frame.nodeStates, [id]: snapshotNode(child) } })),
        selectedNodeId: id,
        selectedAssetId: null,
        selectedAssetIds: [],
      };
    }),
  reparentNode: (nodeId, parentId) =>
    set((state) => {
      const node = state.nodes[nodeId];
      if (!node || node.parentId === parentId || (parentId && !state.nodes[parentId])) return {};
      if (parentId && descendantsOf(state.nodes, nodeId).includes(parentId)) return {};
      let nodes: Record<NodeId, RigNode> = { ...state.nodes, [nodeId]: { ...node, parentId } };
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
      return { nodes, rootNodeIds };
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
    })),
  togglePlayback: () => set((state) => ({ isPlaying: !state.isPlaying })),
  advanceFrame: () =>
    set((state) => {
      const isLastFrame = state.currentFrameIndex === state.frames.length - 1;
      if (!isLastFrame) return { currentFrameIndex: state.currentFrameIndex + 1 };
      if (state.isLooping) return { currentFrameIndex: 0 };
      return { isPlaying: false };
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
      nodeStates: Object.fromEntries(Object.values(state.nodes).map((node) => [
        node.id,
        cloneFrameState(frame.nodeStates[node.id] ?? snapshotNode(node)),
      ])) as Record<NodeId, NodeFrameState>,
    }));
    set({
      frames,
      currentFrameIndex: 0,
      isPlaying: false,
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
      const after: NodeFrameState = { ...snapshotNode(node), visible: before.visible, imageIndex: before.imageIndex };
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
      const copy: RigNode = { ...source, id, name: `${source.name} Copy`, children: [], transform: { ...source.transform, position: { ...source.transform.position }, scale: { ...source.transform.scale } }, pivot: { ...source.pivot } };
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
