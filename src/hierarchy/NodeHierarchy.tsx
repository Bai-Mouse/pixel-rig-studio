import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Icon } from '../components/Icon';
import { useProjectStore } from '../state/projectStore';
import type { NodeId } from '../types/project';
import '../hierarchy.css';

type NodeRowProps = {
  id: NodeId;
  depth: number;
  draggedNodeId: NodeId | null;
  dropTargetId: NodeId | null;
  onDragStart: (nodeId: NodeId) => void;
  onDragEnd: () => void;
  onDragTarget: (nodeId: NodeId) => void;
  onDrop: (nodeId: NodeId) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>, nodeId: NodeId) => void;
  onSelect: (nodeId: NodeId) => void;
};

function NodeRow({ id, depth, draggedNodeId, dropTargetId, onDragStart, onDragEnd, onDragTarget, onDrop, onContextMenu, onSelect }: NodeRowProps) {
  const node = useProjectStore((state) => state.nodes[id]);
  const selectedNodeId = useProjectStore((state) => state.selectedNodeId);
  const toggleVisibility = useProjectStore((state) => state.toggleNodeVisibility);
  const toggleLock = useProjectStore((state) => state.toggleNodeLock);
  const deleteNode = useProjectStore((state) => state.deleteNode);
  const [isExpanded, setIsExpanded] = useState(true);

  if (!node) return null;
  const hasChildren = node.children.length > 0;
  return (
    <>
      <div
        className={`node-row ${selectedNodeId === id ? 'selected' : ''} ${draggedNodeId === id ? 'dragging' : ''} ${dropTargetId === id ? 'drop-target' : ''}`}
        data-node-id={id}
        style={{ paddingLeft: 10 + depth * 16 }}
        onPointerEnter={() => onDragTarget(id)}
        onPointerUp={() => onDrop(id)}
        onMouseEnter={() => onDragTarget(id)}
        onMouseUp={() => onDrop(id)}
        onContextMenu={(event) => onContextMenu(event, id)}
      >
        <button
          className={`node-chevron ${hasChildren ? '' : 'blank'} ${isExpanded ? 'expanded' : ''}`}
          type="button"
          disabled={!hasChildren}
          title={hasChildren ? (isExpanded ? 'Collapse child nodes' : 'Expand child nodes') : undefined}
          onClick={(event) => { event.stopPropagation(); if (hasChildren) setIsExpanded((value) => !value); }}
        ><Icon name="chevron" size={12} /></button>
        <button
          className="node-main"
          type="button"
          onClick={() => onSelect(id)}
          onPointerDown={(event) => { if (event.button === 0) onDragStart(id); }}
          onMouseDown={(event) => { if (event.button === 0) onDragStart(id); }}
          title="Drag this node onto another node to make it a child"
        >
          <span className="node-swatch" />
          <span>{node.name}</span>
        </button>
        <span className="node-actions">
          <button type="button" title={node.visible ? 'Hide node' : 'Show node'} onClick={() => toggleVisibility(id)}><Icon name={node.visible ? 'eye' : 'eyeOff'} size={14} /></button>
          <button type="button" title={node.locked ? 'Unlock node' : 'Lock node'} onClick={() => toggleLock(id)}><Icon name={node.locked ? 'lock' : 'unlock'} size={14} /></button>
          <button type="button" className="delete-node-action" title="Delete node" onClick={() => { if (window.confirm(`Delete ${node.name} and all child nodes?`)) deleteNode(id); }}><Icon name="trash" size={14} /></button>
        </span>
      </div>
      {isExpanded && node.children.map((child) => <NodeRow key={child} id={child} depth={depth + 1} draggedNodeId={draggedNodeId} dropTargetId={dropTargetId} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragTarget={onDragTarget} onDrop={onDrop} onContextMenu={onContextMenu} onSelect={onSelect} />)}
    </>
  );
}

export function NodeHierarchy() {
  const rootNodeIds = useProjectStore((state) => state.rootNodeIds);
  const selectNode = useProjectStore((state) => state.selectNode);
  const reparentNode = useProjectStore((state) => state.reparentNode);
  const addRootNode = useProjectStore((state) => state.addRootNode);
  const addChildNode = useProjectStore((state) => state.addChildNode);
  const pointerDragRef = useRef<NodeId | null>(null);
  const [draggedNodeId, setDraggedNodeId] = useState<NodeId | null>(null);
  const [dropTargetId, setDropTargetId] = useState<NodeId | null>(null);
  const [contextMenu, setContextMenu] = useState<{ nodeId: NodeId | null; x: number; y: number } | null>(null);

  const clearDrag = () => {
    pointerDragRef.current = null;
    setDraggedNodeId(null);
    setDropTargetId(null);
  };

  const handleDragStart = (nodeId: NodeId) => {
    pointerDragRef.current = nodeId;
    setDraggedNodeId(nodeId);
    setContextMenu(null);
  };

  const handleNodeDragTarget = (nodeId: NodeId) => {
    if (pointerDragRef.current && pointerDragRef.current !== nodeId) {
      setDropTargetId(nodeId);
    }
  };

  const handleNodeDrop = (parentId: NodeId) => {
    const nodeId = pointerDragRef.current;
    if (nodeId && nodeId !== parentId) reparentNode(nodeId, parentId);
    clearDrag();
  };

  const nodeIdAtEventTarget = (target: EventTarget | null) => {
    const element = target instanceof HTMLElement ? target.closest<HTMLElement>('[data-node-id]') : null;
    return element?.dataset.nodeId as NodeId | undefined;
  };

  const trackPointerTarget = (target: EventTarget | null) => {
    if (!pointerDragRef.current) return;
    const targetNodeId = nodeIdAtEventTarget(target);
    setDropTargetId(targetNodeId && targetNodeId !== pointerDragRef.current ? targetNodeId : null);
  };

  const dropAtPointerTarget = (target: EventTarget | null) => {
    const targetNodeId = nodeIdAtEventTarget(target);
    if (targetNodeId) handleNodeDrop(targetNodeId);
    else handleRootDrop();
  };

  const handleRootDrop = () => {
    const nodeId = pointerDragRef.current;
    if (nodeId) reparentNode(nodeId, null);
    clearDrag();
  };

  useEffect(() => {
    window.addEventListener('pointerup', clearDrag);
    return () => window.removeEventListener('pointerup', clearDrag);
  }, []);

  return (
    <section
      className="panel hierarchy-panel"
      onClick={() => setContextMenu(null)}
      onContextMenu={(event) => {
        if (event.target instanceof Element && event.target.closest('[data-node-id], .hierarchy-context-menu')) return;
        event.preventDefault();
        setContextMenu({ nodeId: null, x: event.clientX, y: event.clientY });
      }}
    >
      <div className="panel-heading">
        <span><Icon name="layers" /> Node hierarchy</span>
        <span className="subtle-count">{rootNodeIds.length} root</span>
      </div>
      <div className={`tree-root ${draggedNodeId && !dropTargetId ? 'root-drop-target' : ''}`} onPointerMove={(event) => trackPointerTarget(event.target)} onMouseMove={(event) => trackPointerTarget(event.target)} onPointerUp={(event) => dropAtPointerTarget(event.target)} onMouseUp={(event) => dropAtPointerTarget(event.target)}>
        {rootNodeIds.map((id) => <NodeRow key={id} id={id} depth={0} draggedNodeId={draggedNodeId} dropTargetId={dropTargetId} onDragStart={handleDragStart} onDragEnd={clearDrag} onDragTarget={handleNodeDragTarget} onDrop={handleNodeDrop} onContextMenu={(event, nodeId) => { event.preventDefault(); event.stopPropagation(); setContextMenu({ nodeId, x: event.clientX, y: event.clientY }); }} onSelect={(nodeId) => { setContextMenu(null); selectNode(nodeId); }} />)}
        <div className="root-drop-zone" onPointerEnter={() => { if (pointerDragRef.current) setDropTargetId(null); }} onPointerUp={handleRootDrop} onMouseEnter={() => { if (pointerDragRef.current) setDropTargetId(null); }} onMouseUp={handleRootDrop}>Drag here to place at root level</div>
      </div>
      <p className="panel-hint">Drag a node name onto another node to make it a child. Use the arrow to expand or collapse children.</p>
      {contextMenu && (
        <div className="hierarchy-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
          {contextMenu.nodeId
            ? <button type="button" onClick={() => { addChildNode(contextMenu.nodeId!); setContextMenu(null); }}><Icon name="plus" size={14} /> Add child node</button>
            : <button type="button" onClick={() => { addRootNode(); setContextMenu(null); }}><Icon name="plus" size={14} /> Add empty node</button>}
        </div>
      )}
    </section>
  );
}
