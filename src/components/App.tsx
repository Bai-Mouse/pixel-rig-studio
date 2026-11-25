import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AnimationCanvas } from '../canvas/AnimationCanvas';
import { FrameDrawingCanvas } from '../canvas/FrameDrawingCanvas';
import { NodeHierarchy } from '../hierarchy/NodeHierarchy';
import { AssetLibrary } from './AssetLibrary';
import { PropertiesPanel } from './PropertiesPanel';
import { Toolbar } from './Toolbar';
import { Timeline } from '../timeline/Timeline';
import { PixelEditor } from '../pixel-editor/PixelEditor';
import { ExportDialog } from '../export/ExportDialog';
import { ProjectStartScreen } from './ProjectStartScreen';
import { TemplateSetupDialog } from './TemplateSetupDialog';
import { parseProjectFile, projectFile, type SerializableProject } from '../export/projectSerializer';
import { readRecentProjects, rememberProject, type RecentProject } from '../project/recentProjects';
import { useProjectStore } from '../state/projectStore';
import { isDesktopRuntime, openProjectFileDialog, saveProjectFile } from '../export/nativeSave';
import { CodexChat } from '../codex/CodexChat';
import { makeProjectCopy } from '../project/projectCopy';
import { canCloseProject, hasUnsavedProjectChanges, type ProjectCheckpoint } from '../project/unsavedProject';

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

function displayName(name: string) {
  return name.replace(/\.pixelrig\.json$/i, '').replace(/\.json$/i, '') || 'Untitled character';
}

function fileName(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

export function App() {
  const [showGrid, setShowGrid] = useState(true);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [showCodex, setShowCodex] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<'nodes' | 'canvas'>('nodes');
  const [showProjectStart, setShowProjectStart] = useState(true);
  const [showTemplateSetup, setShowTemplateSetup] = useState(false);
  const [canReturnToEditor, setCanReturnToEditor] = useState(false);
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null);
  const [protectedProjectPaths, setProtectedProjectPaths] = useState<string[]>([]);
  const [workspaceLayout, setWorkspaceLayout] = useState<WorkspaceLayout>(restoredWorkspaceLayout);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(readRecentProjects);
  const [showExitPrompt, setShowExitPrompt] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);
  const [exitError, setExitError] = useState('');
  const exitDialogRef = useRef<HTMLDialogElement>(null);
  const exitTaskRef = useRef(false);
  const saveTaskRef = useRef<Promise<boolean> | null>(null);
  const projectSessionRef = useRef<{ checkpoint: ProjectCheckpoint } | null>(null);
  const trackProject = (needsFirstSave = false) => {
    projectSessionRef.current = { checkpoint: { snapshot: currentProject(), needsFirstSave } };
  };
  const hasUnsaved = () => hasUnsavedProjectChanges(projectSessionRef.current?.checkpoint ?? null, currentProject());
  const projectInputRef = useRef<HTMLInputElement>(null);
  const resizeRef = useRef<{ direction: ResizeDirection; startX: number; startY: number; layout: WorkspaceLayout } | null>(null);
  const projectName = useProjectStore((state) => state.projectName);
  const loadProject = useProjectStore((state) => state.loadProject);
  const createEmptyProject = useProjectStore((state) => state.createEmptyProject);

  useEffect(() => {
    if (!showExitPrompt) return;
    const dialog = exitDialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, [showExitPrompt]);

  useEffect(() => {
    if (!isDesktopRuntime()) {
      const beforeUnload = (event: BeforeUnloadEvent) => {
        if (!hasUnsaved()) return;
        event.preventDefault();
        event.returnValue = true;
      };
      window.addEventListener('beforeunload', beforeUnload);
      return () => window.removeEventListener('beforeunload', beforeUnload);
    }
    const mainWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void mainWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      if (disposed || exitTaskRef.current || exitDialogRef.current?.open) return;
      exitTaskRef.current = true;
      try {
        // An ordinary save may already be waiting for a file picker or for the write.
        await saveTaskRef.current;
        if (disposed) return;
        if (hasUnsaved()) {
          const state = useProjectStore.getState();
          if (state.isPlaying) state.togglePlayback();
          setExitError('');
          setShowExitPrompt(true);
        } else {
          await mainWindow.destroy();
        }
      } catch (error) {
        if (!disposed) {
          setExitError(error instanceof Error ? error.message : String(error));
          setShowExitPrompt(true);
        }
      } finally {
        exitTaskRef.current = false;
      }
    }).then((cleanup) => { if (disposed) cleanup(); else unlisten = cleanup; })
      .catch((error) => console.error('Could not register the project close guard.', error));
    return () => { disposed = true; unlisten?.(); };
  }, []);

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

  const saveProject = (forExit = false): Promise<boolean> => {
    if (saveTaskRef.current) return saveTaskRef.current;
    const session = projectSessionRef.current;
    const task = (async () => {
      try {
        const snapshot = currentProject();
        const file = projectFile(snapshot);
        const path = await saveProjectFile(`${projectName}.pixelrig.json`, JSON.stringify(file, null, 2), activeProjectPath, protectedProjectPaths);
        if (!path) return false;
        if (session && projectSessionRef.current === session) {
          session.checkpoint = { snapshot };
          setActiveProjectPath(isDesktopRuntime() ? path : null);
        }
        setRecentProjects(rememberProject(file, projectName, path));
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || 'Could not save project.');
        if (forExit) setExitError(message);
        else window.alert(message);
        return false;
      }
    })();
    const pending = task.finally(() => { saveTaskRef.current = null; });
    saveTaskRef.current = pending;
    return pending;
  };

  const finishExit = async (choice: 'save' | 'discard' | 'cancel') => {
    if (exitTaskRef.current) return;
    if (choice === 'cancel') {
      setShowExitPrompt(false);
      return;
    }
    exitTaskRef.current = true;
    setExitBusy(true);
    setExitError('');
    try {
      const saved = choice === 'save' && await saveProject(true);
      const stillDirty = choice === 'save' && saved && hasUnsaved();
      if (canCloseProject(choice, saved, stillDirty)) await getCurrentWindow().destroy();
      else if (stillDirty) setExitError('项目在保存期间又有改动，请再保存一次。');
    } catch (error) {
      setExitError(error instanceof Error ? error.message : String(error));
    } finally {
      exitTaskRef.current = false;
      setExitBusy(false);
    }
  };

  const copyProject = () => {
    useProjectStore.getState().commitInspectorEdit();
    useProjectStore.getState().commitTransform();
    const copy = makeProjectCopy(currentProject(), projectName);
    loadProject(copy.project, copy.name);
    trackProject(true);
    setProtectedProjectPaths((paths) => activeProjectPath ? [...paths, activeProjectPath] : paths);
    setActiveProjectPath(copy.path);
    setEditingAssetId(null); setShowExport(false); setShowCodex(false);
  };

  const openRecent = (recent: RecentProject) => {
    try {
      const project = parseProjectFile(JSON.stringify(recent.project));
      loadProject(project, recent.name);
      trackProject();
      setRecentProjects(rememberProject(recent.project, recent.name, recent.path));
      setActiveProjectPath(recent.path && !recent.path.startsWith('Browser ') ? recent.path : null);
      setProtectedProjectPaths([]);
      setShowProjectStart(false);
      setCanReturnToEditor(false);
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
      trackProject();
      setRecentProjects(rememberProject(projectFile(project), name, file.webkitRelativePath || `Browser file: ${file.name}`));
      setActiveProjectPath(null);
      setProtectedProjectPaths([]);
      setShowProjectStart(false);
      setCanReturnToEditor(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'The project could not be opened.');
    }
  };

  const openNativeProject = async () => {
    try {
      const selected = await openProjectFileDialog();
      if (!selected) return;
      const project = parseProjectFile(selected.content);
      const name = displayName(fileName(selected.path));
      loadProject(project, name);
      trackProject();
      setRecentProjects(rememberProject(projectFile(project), name, selected.path));
      setActiveProjectPath(selected.path);
      setProtectedProjectPaths([]);
      setShowProjectStart(false);
      setCanReturnToEditor(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'The project could not be opened.');
    }
  };

  const requestOpenProject = () => {
    if (isDesktopRuntime()) void openNativeProject();
    else projectInputRef.current?.click();
  };

  const startEmptyProject = () => {
    createEmptyProject();
    trackProject();
    setActiveProjectPath(null);
    setProtectedProjectPaths([]);
    setShowProjectStart(false);
    setCanReturnToEditor(false);
  };

  const startCharacterTemplate = () => {
    setShowTemplateSetup(true);
  };

  const createCharacterTemplate = (project: SerializableProject) => {
    loadProject(project, 'Character template');
    trackProject(true);
    setShowTemplateSetup(false);
    setActiveProjectPath(null);
    setProtectedProjectPaths([]);
    setShowProjectStart(false);
    setCanReturnToEditor(false);
  };

  return (
    <>
      {showExitPrompt && <dialog ref={exitDialogRef} className="project-exit-dialog" aria-labelledby="project-exit-title" aria-describedby="project-exit-description"
        onCancel={(event) => { event.preventDefault(); void finishExit('cancel'); }} onKeyDown={(event) => event.stopPropagation()}>
        <h2 id="project-exit-title">退出前保存项目？</h2>
        <p id="project-exit-description">「{projectName}」的未保存改动会在退出后丢失。</p>
        {exitError && <p role="alert" className="project-exit-error">{exitError}</p>}
        <div className="project-exit-actions">
          <button autoFocus type="button" disabled={exitBusy} onClick={() => void finishExit('cancel')}>取消</button>
          <button type="button" disabled={exitBusy} onClick={() => void finishExit('discard')}>不保存退出</button>
          <button className="project-exit-save" type="button" disabled={exitBusy} onClick={() => void finishExit('save')}>{exitBusy ? '正在处理…' : '保存并退出'}</button>
        </div>
      </dialog>}
      <input ref={projectInputRef} type="file" accept="application/json,.json,.pixelrig.json" hidden onChange={(event) => { void openProjectFile(event.target.files); event.currentTarget.value = ''; }} />
      {showTemplateSetup && <TemplateSetupDialog onCancel={() => setShowTemplateSetup(false)} onCreate={createCharacterTemplate} />}
      {showProjectStart ? (
        <ProjectStartScreen recentProjects={recentProjects} onOpenRecent={openRecent} onCreateEmpty={startEmptyProject} onCreateCharacter={startCharacterTemplate} onImport={requestOpenProject} onReturnToEditor={canReturnToEditor ? () => setShowProjectStart(false) : undefined} />
      ) : (
        <div className="app-shell" style={workspaceStyle}>
          <Toolbar onNewProject={() => { setCanReturnToEditor(true); setShowProjectStart(true); }} onCopyProject={copyProject} onOpenProject={requestOpenProject} onSaveProject={() => void saveProject()} onOpenRecent={openRecent} onExport={() => setShowExport(true)} onCodex={() => setShowCodex((value) => !value)} projectName={projectName} recentProjects={recentProjects} showGrid={showGrid} onToggleGrid={() => setShowGrid((value) => !value)} workspaceMode={workspaceMode} onWorkspaceModeChange={setWorkspaceMode} />
          {workspaceMode === 'nodes' ? <div className="app-layout">
            <aside className="left-rail">
              <NodeHierarchy />
              <AssetLibrary />
            </aside>
            <div className="layout-resizer vertical" title="Drag to resize the left panel. Double-click to reset." {...resizeHandlers('left')} />
            <AnimationCanvas showGrid={showGrid} />
            <div className="layout-resizer vertical" title="Drag to resize the right panel. Double-click to reset." {...resizeHandlers('right')} />
            <PropertiesPanel onEditAsset={setEditingAssetId} />
          </div> : <div className="app-layout canvas-drawing-mode"><FrameDrawingCanvas /></div>}
          <div className="layout-resizer horizontal" title="Drag to resize the timeline. Double-click to reset." {...resizeHandlers('timeline')} />
          <Timeline />
          <footer className="status-bar"><span><i /> Ready</span><span>Pixel-perfect preview</span><span>Project workflow & desktop build ready</span></footer>
          {editingAssetId && <PixelEditor assetId={editingAssetId} onClose={() => setEditingAssetId(null)} />}
          {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
          <CodexChat visible={showCodex} onClose={() => setShowCodex(false)} />
        </div>
      )}
    </>
  );
}
