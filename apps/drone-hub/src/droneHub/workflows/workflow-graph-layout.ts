import type { DroneWorkflow, WorkflowNode } from './workflow-types';

export const WORKFLOW_GRAPH_NODE_WIDTH = 280;
export const WORKFLOW_GRAPH_NODE_HEIGHT = 150;

const GRAPH_PADDING_X = 30;
const GRAPH_PADDING_Y = 26;
const GRAPH_DEPTH_STEP = 186;
const GRAPH_LANE_STEP = 316;
const GRAPH_STAGE_PADDING = 24;
export const WORKFLOW_GRAPH_PHASE_HEADER_HEIGHT = 38;
const PHASE_COLUMN_GAP = 72;
const GRAPH_MIN_WIDTH = 300;
const GRAPH_MIN_HEIGHT = 320;

export type WorkflowGraphPoint = {
  x: number;
  y: number;
};

export type WorkflowGraphNode = {
  key: string;
  sourceId: string;
  type: WorkflowNode['type'] | 'phase';
  label: string;
  eyebrow: string;
  detail: string;
  agentId?: string;
  prompt?: string;
  runnerLabel?: string;
  model?: string;
  phaseId: string;
  permissions?: string[];
  x: number;
  y: number;
};

export type WorkflowGraphEdge = {
  key: string;
  from: string;
  to: string;
  label?: string;
  variant: 'flow' | 'branch' | 'loop' | 'phase';
  points?: WorkflowGraphPoint[];
};

export type WorkflowGraphPhaseRegion = {
  key: string;
  phaseId: string;
  label: string;
  index: number;
  column: number;
  nodeCount: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WorkflowGraphLayout = {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  phaseRegions: WorkflowGraphPhaseRegion[];
  width: number;
  height: number;
};

type NodePlacement = {
  entry: string;
  exits: string[];
  maxDepth: number;
};

type PhaseMetrics = {
  phase: DroneWorkflow['definition']['phases'][number];
  index: number;
  laneSpan: number;
  maxDepth: number;
  nodeCount: number;
  width: number;
  height: number;
};

type PackedPhase = PhaseMetrics & {
  column: number;
  x: number;
  y: number;
};

function nodeLaneSpan(node: WorkflowNode): number {
  if (node.type === 'parallel') {
    return Math.max(
      1,
      node.children.reduce((total, child) => total + nodeLaneSpan(child), 0),
    );
  }
  if (node.type === 'if') {
    return Math.max(1, nodeLaneSpan(node.then) + (node.else ? nodeLaneSpan(node.else) : 0));
  }
  if (node.type === 'sequence') {
    return Math.max(1, ...node.children.map(nodeLaneSpan));
  }
  if (node.type === 'forEach' || node.type === 'repeat') return nodeLaneSpan(node.body);
  return 1;
}

function nodeDepthSpan(node: WorkflowNode): number {
  if (node.type === 'sequence') {
    return 1 + node.children.reduce((total, child) => total + nodeDepthSpan(child), 0);
  }
  if (node.type === 'parallel') {
    return 1 + Math.max(0, ...node.children.map(nodeDepthSpan));
  }
  if (node.type === 'if') {
    return 1 + Math.max(nodeDepthSpan(node.then), node.else ? nodeDepthSpan(node.else) : 0);
  }
  if (node.type === 'forEach' || node.type === 'repeat') return 1 + nodeDepthSpan(node.body);
  return 1;
}

function nodeCount(node: WorkflowNode): number {
  if (node.type === 'sequence' || node.type === 'parallel') {
    return 1 + node.children.reduce((total, child) => total + nodeCount(child), 0);
  }
  if (node.type === 'if') {
    return 1 + nodeCount(node.then) + (node.else ? nodeCount(node.else) : 0);
  }
  if (node.type === 'forEach' || node.type === 'repeat') return 1 + nodeCount(node.body);
  return 1;
}

function nodeDetail(node: WorkflowNode): string {
  switch (node.type) {
    case 'call':
      return `Dispatch to ${node.agent}`;
    case 'sequence':
      return `${node.children.length} ordered step${node.children.length === 1 ? '' : 's'}`;
    case 'parallel':
      return `${node.children.length} concurrent branch${node.children.length === 1 ? '' : 'es'}`;
    case 'forEach':
      return `${node.maxItems == null ? 'Dynamic' : `Up to ${node.maxItems}`} items · ${node.parallelism ?? 1} at once`;
    case 'if':
      return node.else ? 'Then / else decision' : 'Conditional path';
    case 'repeat':
      return `${node.maxIterations == null ? 'Bounded' : `Up to ${node.maxIterations}`} iterations`;
  }
}

function nodeEyebrow(type: WorkflowNode['type']): string {
  switch (type) {
    case 'call':
      return 'Agent call';
    case 'forEach':
      return 'Iterator';
    case 'if':
      return 'Decision';
    case 'repeat':
      return 'Loop';
    default:
      return type;
  }
}

function phaseMetrics(workflow: DroneWorkflow): PhaseMetrics[] {
  return workflow.definition.phases.map((phase, index) => {
    const laneSpan = nodeLaneSpan(phase.run);
    const maxDepth = Math.max(0, nodeDepthSpan(phase.run) - 1);
    return {
      phase,
      index,
      laneSpan,
      maxDepth,
      nodeCount: nodeCount(phase.run),
      width: GRAPH_PADDING_X * 2 + laneSpan * GRAPH_LANE_STEP,
      height:
        WORKFLOW_GRAPH_PHASE_HEADER_HEIGHT +
        GRAPH_PADDING_Y * 2 +
        maxDepth * GRAPH_DEPTH_STEP +
        WORKFLOW_GRAPH_NODE_HEIGHT,
    };
  });
}

function packPhases(metrics: PhaseMetrics[]): {
  phases: PackedPhase[];
  width: number;
  height: number;
} {
  const packed: PackedPhase[] = [];
  let phaseX = GRAPH_STAGE_PADDING;
  let maxHeight = GRAPH_MIN_HEIGHT;

  metrics.forEach((phase, index) => {
    packed.push({
      ...phase,
      column: index,
      x: phaseX,
      y: GRAPH_STAGE_PADDING,
    });
    phaseX += phase.width + PHASE_COLUMN_GAP;
    maxHeight = Math.max(maxHeight, phase.height + GRAPH_STAGE_PADDING * 2);
  });

  return {
    phases: packed,
    width: Math.max(
      GRAPH_MIN_WIDTH,
      metrics.length === 0 ? GRAPH_MIN_WIDTH : phaseX - PHASE_COLUMN_GAP + GRAPH_STAGE_PADDING,
    ),
    height: maxHeight,
  };
}

export function buildWorkflowGraphLayout(workflow: DroneWorkflow): WorkflowGraphLayout {
  const nodes: WorkflowGraphNode[] = [];
  const edges: WorkflowGraphEdge[] = [];
  const phaseRegions: WorkflowGraphPhaseRegion[] = [];
  const packed = packPhases(phaseMetrics(workflow));
  const phasePlacements: Array<{
    entry: string;
    exits: string[];
    region: WorkflowGraphPhaseRegion;
  }> = [];

  const addEdge = (
    from: string,
    to: string,
    variant: WorkflowGraphEdge['variant'] = 'flow',
    label?: string,
    points?: WorkflowGraphPoint[],
  ) => {
    edges.push({
      key: `${from}->${to}:${variant}:${label ?? ''}`,
      from,
      to,
      variant,
      label,
      points,
    });
  };

  packed.phases.forEach((packedPhase) => {
    const { phase, index, laneSpan, x: originX, y: regionY } = packedPhase;
    const contentOriginY = regionY + WORKFLOW_GRAPH_PHASE_HEADER_HEIGHT;
    const nodeX = (laneStart: number, span: number) =>
      originX +
      GRAPH_PADDING_X +
      (laneStart + span / 2) * GRAPH_LANE_STEP -
      WORKFLOW_GRAPH_NODE_WIDTH / 2;
    const nodeY = (depth: number) => contentOriginY + GRAPH_PADDING_Y + depth * GRAPH_DEPTH_STEP;

    const placeNode = (
      node: WorkflowNode,
      key: string,
      depth: number,
      laneStart: number,
      availableLaneSpan: number,
    ): NodePlacement => {
      const ownSpan = nodeLaneSpan(node);
      const centeredStart = laneStart + Math.max(0, (availableLaneSpan - ownSpan) / 2);
      const graphNode: WorkflowGraphNode = {
        key,
        sourceId: node.id,
        type: node.type,
        label: node.label || node.id,
        eyebrow: nodeEyebrow(node.type),
        detail: nodeDetail(node),
        phaseId: phase.id,
        x: nodeX(centeredStart, ownSpan),
        y: nodeY(depth),
      };
      if (node.type === 'call') {
        const agent = workflow.definition.agents[node.agent];
        graphNode.agentId = node.agent;
        graphNode.prompt = node.prompt;
        graphNode.runnerLabel =
          agent?.runner.kind === 'drone'
            ? 'Child drone'
            : agent?.runner.kind === 'drone-chat'
              ? 'Chat'
              : undefined;
        graphNode.model = agent?.model || agent?.runner.agent.id;
        graphNode.permissions = agent?.permissions ?? [];
      }
      nodes.push(graphNode);

      if (node.type === 'call') return { entry: key, exits: [key], maxDepth: depth };

      if (node.type === 'sequence') {
        let cursorDepth = depth + 1;
        let previousExits = [key];
        let finalExits = [key];
        let finalMaxDepth = depth;
        node.children.forEach((child, childIndex) => {
          const childSpan = nodeLaneSpan(child);
          const childStart = centeredStart + Math.max(0, (ownSpan - childSpan) / 2);
          const placement = placeNode(
            child,
            `${key}/step-${childIndex}:${child.id}`,
            cursorDepth,
            childStart,
            childSpan,
          );
          previousExits.forEach((exit) => addEdge(exit, placement.entry));
          previousExits = placement.exits;
          finalExits = placement.exits;
          finalMaxDepth = placement.maxDepth;
          cursorDepth = placement.maxDepth + 1;
        });
        return { entry: key, exits: finalExits, maxDepth: finalMaxDepth };
      }

      if (node.type === 'parallel') {
        let childLaneStart = centeredStart;
        const placements = node.children.map((child, childIndex) => {
          const childSpan = nodeLaneSpan(child);
          const placement = placeNode(
            child,
            `${key}/branch-${childIndex}:${child.id}`,
            depth + 1,
            childLaneStart,
            childSpan,
          );
          childLaneStart += childSpan;
          addEdge(key, placement.entry, 'branch');
          return placement;
        });
        return {
          entry: key,
          exits: placements.flatMap((placement) => placement.exits),
          maxDepth: Math.max(depth, ...placements.map((placement) => placement.maxDepth)),
        };
      }

      if (node.type === 'if') {
        const thenSpan = nodeLaneSpan(node.then);
        const thenPlacement = placeNode(
          node.then,
          `${key}/then:${node.then.id}`,
          depth + 1,
          centeredStart,
          thenSpan,
        );
        addEdge(key, thenPlacement.entry, 'branch', 'then');
        const placements = [thenPlacement];
        if (node.else) {
          const elseSpan = nodeLaneSpan(node.else);
          const elsePlacement = placeNode(
            node.else,
            `${key}/else:${node.else.id}`,
            depth + 1,
            centeredStart + thenSpan,
            elseSpan,
          );
          addEdge(key, elsePlacement.entry, 'branch', 'else');
          placements.push(elsePlacement);
        }
        return {
          entry: key,
          exits: placements.flatMap((placement) => placement.exits),
          maxDepth: Math.max(...placements.map((placement) => placement.maxDepth)),
        };
      }

      if (node.type !== 'forEach' && node.type !== 'repeat') {
        return { entry: key, exits: [key], maxDepth: depth };
      }
      const bodySpan = nodeLaneSpan(node.body);
      const bodyPlacement = placeNode(
        node.body,
        `${key}/body:${node.body.id}`,
        depth + 1,
        centeredStart + Math.max(0, (ownSpan - bodySpan) / 2),
        bodySpan,
      );
      addEdge(key, bodyPlacement.entry, 'branch', node.type === 'forEach' ? 'each' : 'again');
      bodyPlacement.exits.forEach((exit) => addEdge(exit, key, 'loop'));
      return {
        entry: key,
        exits: bodyPlacement.exits,
        maxDepth: bodyPlacement.maxDepth,
      };
    };

    const phaseKey = `phase-${index}:${phase.id}`;
    const placement = placeNode(phase.run, `${phaseKey}/root:${phase.run.id}`, 0, 0, laneSpan);

    const region: WorkflowGraphPhaseRegion = {
      key: `region:${phaseKey}`,
      phaseId: phase.id,
      label: phase.label || phase.id,
      index,
      column: packedPhase.column,
      nodeCount: packedPhase.nodeCount,
      x: originX,
      y: regionY,
      width: packedPhase.width,
      height: packedPhase.height,
    };
    phaseRegions.push(region);
    phasePlacements.push({ entry: placement.entry, exits: placement.exits, region });
  });

  const nodesByKey = new Map(nodes.map((node) => [node.key, node]));
  for (let index = 1; index < phasePlacements.length; index += 1) {
    const previous = phasePlacements[index - 1];
    const current = phasePlacements[index];
    previous.exits.forEach((exit) => {
      const source = nodesByKey.get(exit);
      const target = nodesByKey.get(current.entry);
      if (!source || !target) return;
      addEdge(exit, current.entry, 'phase');
    });
  }

  return {
    nodes,
    edges,
    phaseRegions,
    width: packed.width,
    height: packed.height,
  };
}
