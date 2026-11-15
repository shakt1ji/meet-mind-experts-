import type {
  Node as WorkflowNode,
  WorkflowEdge,
  WorkflowNodeType,
} from "../types/meetmind";

const VALID_NODE_TYPES = new Set<WorkflowNodeType>([
  "trigger",
  "loop",
  "ticket",
  "approval",
  "gmail",
  "calendar",
  "wait",
  "slack-nudge",
]);

export function validateWorkflowPayload(data: unknown): {
  valid: boolean;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  error?: string;
} {
  if (!data || typeof data !== "object") {
    return { valid: false, nodes: [], edges: [], error: "Workflow payload is not a JSON object." };
  }

  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) {
    return {
      valid: false,
      nodes: [],
      edges: [],
      error: "Workflow JSON must include nodes and edges arrays.",
    };
  }

  if (obj.nodes.length === 0) {
    return { valid: false, nodes: [], edges: [], error: "Workflow must have at least one node." };
  }

  const parsedNodes: WorkflowNode[] = [];
  const nodeIds = new Set<string>();

  for (let i = 0; i < obj.nodes.length; i++) {
    const n = obj.nodes[i] as Record<string, unknown>;
    if (!n || typeof n !== "object") {
      return { valid: false, nodes: [], edges: [], error: `Node at index ${i} is invalid.` };
    }
    const id = typeof n.id === "string" ? n.id.trim() : "";
    const rawType = typeof n.type === "string" ? n.type.toLowerCase().trim() : "";
    const label = typeof n.label === "string" ? n.label.trim() : "";
    const description = typeof n.description === "string" ? n.description.trim() : "";
    const configSummary =
      typeof n.configSummary === "string" ? n.configSummary.trim() : "";

    if (!id || !label) {
      return { valid: false, nodes: [], edges: [], error: `Node ${i} is missing id or label.` };
    }
    if (!VALID_NODE_TYPES.has(rawType as WorkflowNodeType)) {
      return {
        valid: false,
        nodes: [],
        edges: [],
        error: `Node "${label}" has unsupported type "${rawType}".`,
      };
    }

    nodeIds.add(id);
    const config =
      n.config && typeof n.config === "object"
        ? (n.config as WorkflowNode["config"])
        : {};

    parsedNodes.push({
      id,
      type: rawType as WorkflowNodeType,
      label,
      description: description || `${label} step`,
      x: typeof n.x === "number" ? n.x : 0,
      y: typeof n.y === "number" ? n.y : 0,
      enabled: typeof n.enabled === "boolean" ? n.enabled : true,
      status: "idle",
      configSummary: configSummary || label,
      config,
    });
  }

  const parsedEdges: WorkflowEdge[] = [];
  for (let i = 0; i < obj.edges.length; i++) {
    const e = obj.edges[i] as Record<string, unknown>;
    if (!e || typeof e !== "object") continue;
    const from = typeof e.from === "string" ? e.from.trim() : "";
    const to = typeof e.to === "string" ? e.to.trim() : "";
    if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) continue;
    parsedEdges.push({
      id: typeof e.id === "string" && e.id.trim() ? e.id.trim() : `e_${i + 1}`,
      from,
      to,
      label: typeof e.label === "string" ? e.label.trim() : undefined,
    });
  }

  const laidOut = autoLayoutWorkflow(parsedNodes, parsedEdges);
  return { valid: true, nodes: laidOut, edges: parsedEdges };
}

/**
 * Deterministic layered DAG auto-layout so AI-generated & edited graphs never overlap.
 */
export function autoLayoutWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[]
): WorkflowNode[] {
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    children.set(n.id, []);
  }

  for (const e of edges) {
    if (inDegree.has(e.to) && children.has(e.from)) {
      inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
      children.get(e.from)!.push(e.to);
    }
  }

  const level = new Map<string, number>();
  const queue: string[] = [];

  for (const n of nodes) {
    if ((inDegree.get(n.id) || 0) === 0) {
      level.set(n.id, 0);
      queue.push(n.id);
    }
  }

  if (queue.length === 0 && nodes.length > 0) {
    level.set(nodes[0].id, 0);
    queue.push(nodes[0].id);
  }

  let safety = 0;
  while (queue.length > 0 && safety < nodes.length * 4) {
    safety++;
    const curr = queue.shift()!;
    const currLevel = level.get(curr) || 0;
    for (const next of children.get(curr) || []) {
      const candidate = currLevel + 1;
      if ((level.get(next) ?? -1) < candidate) {
        level.set(next, candidate);
      }
      queue.push(next);
    }
  }

  // Fallback for any disconnected nodes
  nodes.forEach((n, idx) => {
    if (!level.has(n.id)) {
      level.set(n.id, Math.floor(idx / 2));
    }
  });

  const byLayer = new Map<number, WorkflowNode[]>();
  for (const n of nodes) {
    const l = level.get(n.id) || 0;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(n);
  }

  const X_GAP = 300;
  const Y_GAP = 164;
  const START_X = 48;
  const CENTER_Y = 200;

  const positioned = new Map<string, { x: number; y: number }>();

  Array.from(byLayer.entries())
    .sort(([a], [b]) => a - b)
    .forEach(([layerIdx, layerNodes]) => {
      const totalHeight = (layerNodes.length - 1) * Y_GAP;
      const topY = Math.max(40, CENTER_Y - totalHeight / 2);
      layerNodes.forEach((node, rowIdx) => {
        positioned.set(node.id, {
          x: START_X + layerIdx * X_GAP,
          y: Math.round(topY + rowIdx * Y_GAP),
        });
      });
    });

  return nodes.map((n) => {
    const pos = positioned.get(n.id);
    return pos ? { ...n, x: pos.x, y: pos.y } : n;
  });
}

export function computeWorkflowDiff(
  prevNodes: WorkflowNode[],
  nextNodes: WorkflowNode[]
): string[] {
  const prevMap = new Map(prevNodes.map((n) => [n.id, n]));
  const changedIds: string[] = [];

  for (const next of nextNodes) {
    const prev = prevMap.get(next.id);
    if (!prev) {
      changedIds.push(next.id);
    } else if (
      prev.label !== next.label ||
      prev.configSummary !== next.configSummary ||
      prev.type !== next.type ||
      JSON.stringify(prev.config) !== JSON.stringify(next.config)
    ) {
      changedIds.push(next.id);
    }
  }
  return changedIds;
}
