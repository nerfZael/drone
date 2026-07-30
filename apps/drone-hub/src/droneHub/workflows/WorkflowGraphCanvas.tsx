import React from 'react';
import {
  Background,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type OnInit,
  type OnMove,
  type OnMoveStart,
} from '@xyflow/react';

type CanvasContentData = Record<string, unknown> & {
  content: React.ReactNode;
};

export type WorkflowCanvasNode =
  | Node<CanvasContentData, 'workflow'>
  | Node<CanvasContentData, 'phase'>;

type WorkflowCanvasEdgeData = Record<string, unknown> & {
  path: string;
  label?: string;
  labelX?: number;
  labelY?: number;
};

export type WorkflowCanvasEdge = Edge<WorkflowCanvasEdgeData, 'workflow'>;

type Props = {
  nodes: WorkflowCanvasNode[];
  edges: WorkflowCanvasEdge[];
  minZoom: number;
  maxZoom: number;
  onInit: OnInit<WorkflowCanvasNode, WorkflowCanvasEdge>;
  onMoveStart: OnMoveStart;
  onMove: OnMove;
};

export function WorkflowGraphCanvas({
  nodes,
  edges,
  minZoom,
  maxZoom,
  onInit,
  onMoveStart,
  onMove,
}: Props) {
  return (
    <ReactFlow<WorkflowCanvasNode, WorkflowCanvasEdge>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      minZoom={minZoom}
      maxZoom={maxZoom}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      edgesReconnectable={false}
      zoomOnDoubleClick={false}
      panOnDrag={[0, 1, 2]}
      preventScrolling
      onlyRenderVisibleElements
      zIndexMode="manual"
      onInit={onInit}
      onMoveStart={onMoveStart}
      onMove={onMove}
      onContextMenu={(event) => event.preventDefault()}
      proOptions={{ hideAttribution: true }}
      aria-label="Workflow graph. Drag to pan, use the mouse wheel or pinch gesture to zoom, and select a node to inspect it."
    >
      <Background gap={26} size={1} color="var(--canvas-related-subtle)" />
    </ReactFlow>
  );
}

function WorkflowNode({ data }: NodeProps<Node<CanvasContentData, 'workflow'>>) {
  return (
    <div className="h-full w-full">
      <Handle
        id="top-target"
        type="target"
        position={Position.Top}
        className="!pointer-events-none !opacity-0"
      />
      <Handle
        id="left-target"
        type="target"
        position={Position.Left}
        className="!pointer-events-none !opacity-0"
      />
      <Handle
        id="right-target"
        type="target"
        position={Position.Right}
        className="!pointer-events-none !opacity-0"
      />
      <Handle
        id="bottom-source"
        type="source"
        position={Position.Bottom}
        className="!pointer-events-none !opacity-0"
      />
      <Handle
        id="right-source"
        type="source"
        position={Position.Right}
        className="!pointer-events-none !opacity-0"
      />
      {data.content}
    </div>
  );
}

function WorkflowPhase({ data }: NodeProps<Node<CanvasContentData, 'phase'>>) {
  return <div className="pointer-events-none h-full w-full">{data.content}</div>;
}

function WorkflowEdge({
  id,
  data,
  markerEnd,
  style,
}: EdgeProps<WorkflowCanvasEdge>) {
  if (!data) return null;
  return (
    <>
      <BaseEdge id={id} path={data.path} markerEnd={markerEnd} style={style} />
      {data.label && data.labelX != null && data.labelY != null ? (
        <EdgeLabelRenderer>
          <span
            className="pointer-events-none absolute rounded border border-[var(--border-subtle)] bg-[var(--panel-overlay)] px-1.5 py-0.5 text-[var(--text-8)] uppercase tracking-[0.08em] text-[var(--muted)]"
            style={{
              transform: `translate(-50%, -50%) translate(${data.labelX}px, ${data.labelY}px)`,
              fontFamily: 'var(--display)',
              zIndex: 1,
            }}
          >
            {data.label}
          </span>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const nodeTypes = {
  workflow: WorkflowNode,
  phase: WorkflowPhase,
};

const edgeTypes = {
  workflow: WorkflowEdge,
};
