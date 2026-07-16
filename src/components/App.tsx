import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { AnimationCanvas } from '../canvas/AnimationCanvas';
import { NodeHierarchy } from '../hierarchy/NodeHierarchy';
import { AssetLibrary } from './AssetLibrary';
import { PropertiesPanel } from './PropertiesPanel';
import { Toolbar } from './Toolbar';
import { Timeline } from '../timeline/Timeline';
import { PixelEditor } from '../pixel-editor/PixelEditor';
import { ExportDialog } from '../export/ExportDialog';
import { ProjectStartScreen } from './ProjectStartScreen';
import { parseProjectFile, projectFile, type SerializableProject } from '../export/projectSerializer';
import { readRecentProjects, rememberProject, type RecentProject } from '../project/recentProjects';
import { useProjectStore } from '../state/projectStore';

interface WorkspaceLayout {
  left: number;
  right: number;
  timeline: number;
}

type ResizeDirection = 'left' | 'right' | 'timeline';

const defaultWorkspaceLayout: WorkspaceLayout = { left: 275, right: 260, timeline: 178 };
const workspaceLayoutKey = 'pixel-rig-studio:workspace-layout';

function restoredWorkspaceLayout(): WorkspaceLayout {
  try {
    const saved = window.localStorage.getItem(workspaceLayoutKey);
    if (!saved) return defaultWorkspaceLayout;
    const parsed = JSON.parse(saved) as Partial<WorkspaceLayout>;
    return {
      left: typeof parsed.left === 'number' ? Math.min(520, Math.max(190, parsed.left)) : defaultWorkspaceLayout.left,
      right: typeof parsed.right === 'number' ? Math.min(500, Math.max(190, parsed.right)) : defaultWorkspaceLayout.right,
      timeline: typeof parsed.timeline === 'number' ? Math.min(460, Math.max(120, parsed.timeline)) : defaultWorkspaceLayout.timeline,
    };
  } catch {
    return defaultWorkspaceLayout;
  }
}

function currentProject(): SerializableProject {
  const state = useProjectStore.getState();
  return {
    assets: state.assets,
    nodes: state.nodes,
    rootNodeIds: state.rootNodeIds,
    settings: state.settings,
    frames: state.frames,
    fps: state.fps,
    isLooping: state.isLooping,
  };
}

function downloadProject(file: ReturnType<typeof projectFile>, name: string) {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${name}.pixelrig.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function displayName(name: string) {
  return name.replace(/\.pixelrig\.json$/i, '').replace(/\.json$/i, '') || 'Untitled character';
}

export function App() {
  const [showGrid, setShowGrid] = useState(true);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [showProjectStart, setShowProjectStart] = useState(true);
  const [canReturnToEditor, setCanReturnToEditor] = useState(false);
  const [workspaceLayout, setWorkspaceLayout] = useState<WorkspaceLayout>(restoredWorkspaceLayout);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(readRecentProjects);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const resizeRef = useRef<{ direction: ResizeDirection; startX: number; startY: number; layout: WorkspaceLayout } | null>(null);
  const projectName = useProjectStore((state) => state.projectName);
  const loadProject = useProjectStore((state) => state.loadProject);
  const createEmptyProject = useProjectStore((state) => state.createEmptyProject);
  const createCharacterTemplateProject = useProjectStore((state) => state.createCharacterTemplateProject);

  useEffect(() => {
    try {
      window.localStorage.setItem(workspaceLayoutKey, JSON.stringify(workspaceLayout));
    } catch {
      // Layout persistence is optional when browser storage is unavailable.
    }
  }, [workspaceLayout]);

  const startResize = (direction: ResizeDirection, event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = { direction, startX: event.clientX, startY: event.clientY, layout: workspaceLayout };
  };

  const updateResize = (event: PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize) return;
    if (resize.direction === 'left') {
      const max = Math.max(190, window.innerWidth - resize.layout.right - 332);
      setWorkspaceLayout((layout) => ({ ...layout, left: Math.min(max, Math.max(190, resize.layout.left + event.clientX - resize.startX)) }));
    }
    if (resize.direction === 'right') {
      const max = Math.max(190, window.innerWidth - resize.layout.left - 332);
      setWorkspaceLayout((layout) => ({ ...layout, right: Math.min(max, Math.max(190, resize.layout.right - (event.clientX - resize.startX))) }));
    }
    if (resize.direction === 'timeline') {
      const max = Math.max(120, window.innerHeight - 348);
      setWorkspaceLayout((layout) => ({ ...layout, timeline: Math.min(max, Math.max(120, resize.layout.timeline + resize.startY - event.clientY)) }));
    }
  };

  const stopResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    resizeRef.current = null;
  };

  const resizeHandlers = (direction: ResizeDirection) => ({
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => startResize(direction, event),
    onPointerMove: updateResize,
    onPointerUp: stopResize,
    onPointerCancel: stopResize,
    onDoubleClick: () => setWorkspaceLayout(defaultWorkspaceLayout),
  });

  const workspaceStyle = {
    '--left-panel-width': `${workspaceLayout.left}px`,
    '--right-panel-width': `${workspaceLayout.right}px`,
    '--timeline-height': `${workspaceLayout.timeline}px`,
  } as CSSProperties;

  const saveProject = () => {
    const file = projectFile(currentProject());
    downloadProject(file, projectName);
    setRecentProjects(rememberProject(file, projectName));
  };

  const openRecent = (recent: RecentProject) => {
    try {
      const project = parseProjectFile(JSON.stringify(recent.project));
      loadProject(project, recent.name);
    } catch {
      window.alert('This recent project can no longer be loaded.');
    }
  };

  const openProjectFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const project = parseProjectFile(await file.text());
      const name = displayName(file.name);
      loadProject(project, name);
      setRecentProjects(rememberProject(projectFile(project), name));
      setShowProjectStart(false);
      setCanReturnToEditor(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'The project could not be opened.');
    }
  };

  const startEmptyProject = () => {
    createEmptyProject();
    setShowProjectStart(false);
    setCanReturnToEditor(false);
  };

  const startCharacterTemplate = () => {
    createCharacterTemplateProject();
    setShowProjectStart(false);
    setCanReturnToEditor(false);
  };

  return (
    <>
      <input ref={projectInputRef} type="file" accept="application/json,.json,.pixelrig.json" hidden onChange={(event) => { void openProjectFile(event.target.files); event.currentTarget.value = ''; }} />
      {showProjectStart ? (
        <ProjectStartScreen onCreateEmpty={startEmptyProject} onCreateCharacter={startCharacterTemplate} onImport={() => projectInputRef.current?.click()} onReturnToEditor={canReturnToEditor ? () => setShowProjectStart(false) : undefined} />
      ) : (
        <div className="app-shell" style={workspaceStyle}>
          <Toolbar onNewProject={() => { setCanReturnToEditor(true); setShowProjectStart(true); }} onOpenProject={() => projectInputRef.current?.click()} onSaveProject={saveProject} onOpenRecent={openRecent} onExport={() => setShowExport(true)} projectName={projectName} recentProjects={recentProjects} showGrid={showGrid} onToggleGrid={() => setShowGrid((value) => !value)} />
          <div className="app-layout">
            <aside className="left-rail">
              <NodeHierarchy />
              <AssetLibrary />
            </aside>
            <div className="layout-resizer vertical" title="Drag to resize the left panel. Double-click to reset." {...resizeHandlers('left')} />
            <AnimationCanvas showGrid={showGrid} />
            <div className="layout-resizer vertical" title="Drag to resize the right panel. Double-click to reset." {...resizeHandlers('right')} />
            <PropertiesPanel onEditAsset={setEditingAssetId} />
          </div>
          <div className="layout-resizer horizontal" title="Drag to resize the timeline. Double-click to reset." {...resizeHandlers('timeline')} />
          <Timeline />
          <footer className="status-bar"><span><i /> Ready</span><span>Pixel-perfect preview</span><span>Project workflow & desktop build ready</span></footer>
          {editingAssetId && <PixelEditor assetId={editingAssetId} onClose={() => setEditingAssetId(null)} />}
          {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
        </div>
      )}
    </>
  );
}
