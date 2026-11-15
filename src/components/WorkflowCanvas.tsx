import {
  Calendar,
  Check,
  CheckSquare,
  Clock,
  Eye,
  Loader2,
  Mail,
  MessageSquare,
  Play,
  Repeat,
  ShieldAlert,
  Sparkles,
  Wand2,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlowProvider,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps,
  applyNodeChanges,
  type NodeChange,
} from "reactflow";
import "reactflow/dist/style.css";
import type {
  Meeting,
  Node as WorkflowNode,
  NodeConfig,
  NodeExecutionStatus,
  Person,
  TicketPriority,
  Workflow,
  WorkflowNodeType,
} from "../types/meetmind";
import {
  MOCK_WORKFLOW_DRAFT_PAYLOAD,
  buildMockWorkflowEdit,
} from "../data/mockGeminiResponses";
import {
  computeWorkflowDiff,
  validateWorkflowPayload,
} from "../utils/workflowLayout";

interface WorkflowCanvasProps {
  workflow: Workflow;
  activeMeeting: Meeting;
  people: Person[];
  isRunning: boolean;
  chaosArmed: boolean;
  duplicatesBlockedTotal: number;
  mockMode: boolean;
  demoStaggerNonce?: number;
  demoDryRunActive?: boolean;
  embedded?: boolean;
  onToggleChaos: () => void;
  onReplaceWorkflow: (nodes: WorkflowNode[], edges: Workflow["edges"]) => void;
  onUpdateNodes: (nodes: WorkflowNode[]) => void;
  onApproveAndRun: () => Promise<void>;
  onResumeFailed?: () => void;
}

interface CustomNodeData {
  wfNode: WorkflowNode;
  isSelected: boolean;
  isDiffGlow: boolean;
  isAppearing: boolean;
}

function getNodeVisuals(type: WorkflowNodeType) {
  switch (type) {
    case "trigger":
      return {
        icon: Zap,
        tag: "Trigger",
        border: "border-[#5eead4]/45",
        bg: "bg-[#0d242c]/90",
        iconBg: "bg-[#5eead4]/16 text-[#5eead4]",
      };
    case "loop":
      return {
        icon: Repeat,
        tag: "Loop",
        border: "border-cyan-300/40",
        bg: "bg-[#0c212a]/90",
        iconBg: "bg-cyan-400/16 text-cyan-200",
      };
    case "ticket":
      return {
        icon: CheckSquare,
        tag: "Ticket",
        border: "border-rose-400/45",
        bg: "bg-[#221620]/90",
        iconBg: "bg-rose-400/18 text-rose-200",
      };
    case "approval":
      return {
        icon: ShieldAlert,
        tag: "Approval",
        border: "border-amber-300/85",
        bg: "bg-[#221f13]/92",
        iconBg: "bg-amber-400/20 text-amber-200",
      };
    case "gmail":
      return {
        icon: Mail,
        tag: "Gmail",
        border: "border-sky-300/45",
        bg: "bg-[#0f1f2d]/90",
        iconBg: "bg-sky-400/16 text-sky-200",
      };
    case "calendar":
      return {
        icon: Calendar,
        tag: "Calendar",
        border: "border-emerald-300/45",
        bg: "bg-[#0d2420]/90",
        iconBg: "bg-emerald-400/16 text-emerald-200",
      };
    case "wait":
      return {
        icon: Clock,
        tag: "Wait",
        border: "border-slate-400/40",
        bg: "bg-[#112028]/90",
        iconBg: "bg-slate-400/18 text-slate-200",
      };
    case "slack-nudge":
      return {
        icon: MessageSquare,
        tag: "Slack-nudge",
        border: "border-teal-300/45",
        bg: "bg-[#0f2328]/90",
        iconBg: "bg-teal-400/18 text-teal-200",
      };
  }
}

function StatusBadge({ status }: { status: NodeExecutionStatus }) {
  switch (status) {
    case "idle":
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-slate-400">
          idle
        </span>
      );
    case "queued":
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-slate-200">
          queued
        </span>
      );
    case "running":
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[#5eead4]">
          <Loader2 className="h-3 w-3 animate-spin" />
          running
        </span>
      );
    case "done":
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-emerald-300">
          <Check className="h-3 w-3" />
          done
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-rose-300">
          <XCircle className="h-3 w-3" />
          failed
        </span>
      );
    case "waiting":
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-amber-300">
          waiting
        </span>
      );
  }
}

function MeetMindFlowNode({ data }: NodeProps<CustomNodeData>) {
  const { wfNode, isSelected, isDiffGlow, isAppearing } = data;
  const visuals = getNodeVisuals(wfNode.type);
  const Icon = visuals.icon;

  const statusRing =
    wfNode.status === "running"
      ? "ring-2 ring-[#5eead4]/75 animate-pulse border-[#5eead4]"
      : wfNode.status === "done"
      ? "border-emerald-400/65"
      : wfNode.status === "failed"
      ? "border-rose-400/85 ring-2 ring-rose-400/45"
      : isSelected
      ? "border-[#5eead4] ring-2 ring-[#5eead4]/35"
      : visuals.border;

  return (
    <div
      className={`w-[248px] rounded-2xl border p-3.5 text-left shadow-[0_14px_30px_-12px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-xl transition-all duration-150 ${
        visuals.bg
      } ${statusRing} ${!wfNode.enabled ? "opacity-50" : ""} ${
        isDiffGlow ? "diff-node-glow" : ""
      } ${isAppearing ? "node-appear" : ""}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-[#071318] !bg-[#5eead4]"
      />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${visuals.iconBg}`}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <span className="font-mono text-[10px] font-medium text-slate-200">
            {visuals.tag}
          </span>
        </div>

        <StatusBadge status={wfNode.status} />
      </div>

      <div className="mt-2.5 truncate text-xs font-semibold text-slate-50">
        {wfNode.label}
      </div>
      <div className="mt-1 truncate font-mono text-[11px] text-slate-300/80">
        {wfNode.configSummary}
      </div>

      {wfNode.status === "done" && wfNode.completedAt && (
        <div className="mt-1.5 font-mono text-[10px] text-emerald-300/90 tabular-nums">
          Done · {wfNode.completedAt}
        </div>
      )}

      {wfNode.status === "failed" && wfNode.errorMessage && (
        <div className="mt-1.5 line-clamp-2 rounded-lg border border-rose-400/35 bg-rose-500/15 px-2 py-1 text-[10px] text-rose-100">
          {wfNode.errorMessage}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-[#071318] !bg-[#5eead4]"
      />
    </div>
  );
}

const NODE_TYPES = {
  meetmind: MeetMindFlowNode,
};

function WorkflowCanvasInner({
  workflow,
  activeMeeting,
  people,
  isRunning,
  chaosArmed,
  duplicatesBlockedTotal,
  mockMode,
  demoStaggerNonce = 0,
  demoDryRunActive = false,
  embedded = false,
  onToggleChaos,
  onReplaceWorkflow,
  onUpdateNodes,
  onApproveAndRun,
  onResumeFailed,
}: WorkflowCanvasProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string>(
    workflow.nodes[0]?.id || ""
  );
  const [sideMode, setSideMode] = useState<"config" | "dryrun">("config");
  const [dryRunViewed, setDryRunViewed] = useState(false);

  const [plainEnglishInput, setPlainEnglishInput] = useState("");
  const [isDraftingAi, setIsDraftingAi] = useState(false);
  const [isEditingAi, setIsEditingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiBanner, setAiBanner] = useState<string | null>(null);

  const [visibleCount, setVisibleCount] = useState<number>(workflow.nodes.length);
  const [diffGlowIds, setDiffGlowIds] = useState<string[]>([]);
  const staggerTimerRef = useRef<number | null>(null);

  const [rfNodes, setRfNodes] = useState<FlowNode<CustomNodeData>[]>([]);

  useEffect(() => {
    setVisibleCount((prev) =>
      workflow.nodes.length < prev ? workflow.nodes.length : prev
    );
  }, [workflow.nodes.length]);

  useEffect(() => {
    if (workflow.nodes.length > 0) {
      triggerStaggeredAppear(workflow.nodes.length);
    }
    setSelectedNodeId(workflow.nodes[0]?.id || "");
  }, [workflow.id]);

  useEffect(() => {
    const slicedNodes = workflow.nodes.slice(0, visibleCount);
    setRfNodes(
      slicedNodes.map((wfNode) => ({
        id: wfNode.id,
        type: "meetmind",
        position: { x: wfNode.x, y: wfNode.y },
        data: {
          wfNode,
          isSelected: wfNode.id === selectedNodeId && sideMode === "config",
          isDiffGlow: diffGlowIds.includes(wfNode.id),
          isAppearing: true,
        },
        draggable: true,
      }))
    );
  }, [workflow.nodes, visibleCount, selectedNodeId, sideMode, diffGlowIds]);

  const visibleNodeIds = useMemo(
    () => new Set(workflow.nodes.slice(0, visibleCount).map((n) => n.id)),
    [workflow.nodes, visibleCount]
  );

  const rfEdges: FlowEdge[] = useMemo(
    () =>
      workflow.edges
        .filter((e) => visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to))
        .map((e) => ({
          id: e.id,
          source: e.from,
          target: e.to,
          label: e.label,
          animated: isRunning,
          style: { stroke: "rgba(94, 234, 212, 0.55)", strokeWidth: 1.75 },
          labelStyle: {
            fill: "#e2f1f5",
            fontSize: 10,
            fontFamily: "JetBrains Mono, monospace",
          },
          labelBgStyle: { fill: "#0a1c24", fillOpacity: 0.92 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#5eead4",
            width: 16,
            height: 16,
          },
        })),
    [workflow.edges, visibleNodeIds, isRunning]
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setRfNodes((nds) => applyNodeChanges(changes, nds));
    },
    []
  );

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, draggedNode: FlowNode<CustomNodeData>) => {
      onUpdateNodes(
        workflow.nodes.map((n) =>
          n.id === draggedNode.id
            ? {
                ...n,
                x: Math.round(draggedNode.position.x),
                y: Math.round(draggedNode.position.y),
              }
            : n
        )
      );
    },
    [workflow.nodes, onUpdateNodes]
  );

  const triggerStaggeredAppear = (totalNodes: number) => {
    if (staggerTimerRef.current) {
      window.clearInterval(staggerTimerRef.current);
    }
    setVisibleCount(1);
    let current = 1;
    staggerTimerRef.current = window.setInterval(() => {
      current += 1;
      setVisibleCount(current);
      if (current >= totalNodes && staggerTimerRef.current) {
        window.clearInterval(staggerTimerRef.current);
        staggerTimerRef.current = null;
      }
    }, 180);
  };

  useEffect(() => {
    if (demoStaggerNonce > 0) {
      triggerStaggeredAppear(workflow.nodes.length);
    }
  }, [demoStaggerNonce, workflow.nodes.length]);

  useEffect(() => {
    if (demoDryRunActive) {
      setSideMode("dryrun");
      setDryRunViewed(true);
    }
  }, [demoDryRunActive]);

  useEffect(() => {
    return () => {
      if (staggerTimerRef.current) {
        window.clearInterval(staggerTimerRef.current);
      }
    };
  }, []);

  const handleDraftWithAi = async () => {
    setIsDraftingAi(true);
    setAiError(null);
    setAiBanner(null);

    try {
      let data: unknown;
      if (mockMode) {
        await new Promise((r) => window.setTimeout(r, 260));
        data = MOCK_WORKFLOW_DRAFT_PAYLOAD;
      } else {
        const payloadItems = activeMeeting.extractedItems.map((item) => ({
          kind: item.kind,
          title: item.title,
          dueDate: item.dueDate,
          ownerName:
            people.find((p) => p.id === item.ownerId)?.name ||
            item.rawOwner ||
            "Unassigned",
          needsConfirmation: item.needsConfirmation && !item.resolved,
        }));

        const res = await fetch("/api/gemini/workflow/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            meetingTitle: activeMeeting.title,
            meetingDate: activeMeeting.date,
            summary: activeMeeting.summary,
            extractedItems: payloadItems,
            roster: people,
          }),
        });

        data = await res.json();
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error || "Failed to draft workflow with Gemini."
          );
        }
      }

      const validated = validateWorkflowPayload(data);
      if (!validated.valid) {
        throw new Error(validated.error || "Generated workflow failed schema validation.");
      }

      onReplaceWorkflow(validated.nodes, validated.edges);
      setSelectedNodeId(validated.nodes[0]?.id || "");
      setDryRunViewed(false);
      setSideMode("config");
      triggerStaggeredAppear(validated.nodes.length);
      setAiBanner(
        `Drafted ${validated.nodes.length}-node workflow from "${activeMeeting.title}"${
          mockMode ? " (Mock cache)" : ""
        }. View Dry run to unlock Approve and Run.`
      );
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Could not draft workflow.");
    } finally {
      setIsDraftingAi(false);
    }
  };

  const handlePlainEnglishEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!plainEnglishInput.trim() || isEditingAi) return;

    setIsEditingAi(true);
    setAiError(null);
    setAiBanner(null);

    try {
      let data: unknown;
      if (mockMode) {
        await new Promise((r) => window.setTimeout(r, 240));
        data = buildMockWorkflowEdit(
          workflow.nodes,
          workflow.edges,
          plainEnglishInput.trim()
        );
      } else {
        const res = await fetch("/api/gemini/workflow/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentWorkflow: {
              nodes: workflow.nodes,
              edges: workflow.edges,
            },
            instruction: plainEnglishInput.trim(),
            meetingTitle: activeMeeting.title,
            roster: people,
          }),
        });

        data = await res.json();
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error || "Failed to edit workflow with Gemini."
          );
        }
      }

      const validated = validateWorkflowPayload(data);
      if (!validated.valid) {
        throw new Error(validated.error || "Updated workflow failed schema validation.");
      }

      const changedIds = computeWorkflowDiff(workflow.nodes, validated.nodes);
      onReplaceWorkflow(validated.nodes, validated.edges);
      setVisibleCount(validated.nodes.length);
      setDiffGlowIds(changedIds);
      setDryRunViewed(false);
      if (changedIds[0]) setSelectedNodeId(changedIds[0]);
      setPlainEnglishInput("");
      setAiBanner(
        changedIds.length > 0
          ? `Applied edit${mockMode ? " (Mock cache)" : ""} — ${
              changedIds.length
            } node(s) highlighted on canvas.`
          : "Workflow updated."
      );

      window.setTimeout(() => {
        setDiffGlowIds([]);
      }, 2600);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Could not edit workflow.");
    } finally {
      setIsEditingAi(false);
    }
  };

  const handleOpenDryRun = () => {
    setSideMode("dryrun");
    setDryRunViewed(true);
  };

  const updateSelectedNode = (patch: Partial<WorkflowNode>) => {
    setDryRunViewed(false);
    onUpdateNodes(
      workflow.nodes.map((n) => (n.id === selectedNodeId ? { ...n, ...patch } : n))
    );
  };

  const updateSelectedConfig = (configPatch: Partial<NodeConfig>) => {
    const node = workflow.nodes.find((n) => n.id === selectedNodeId);
    if (!node) return;
    const nextConfig = { ...node.config, ...configPatch };
    let nextSummary = node.configSummary;
    if (node.type === "gmail" && nextConfig.to) nextSummary = `To: ${nextConfig.to}`;
    if (node.type === "ticket" && nextConfig.priority)
      nextSummary = `${nextConfig.priority} · ${nextConfig.dueDate || "TBD"}`;
    if (node.type === "calendar" && nextConfig.date)
      nextSummary = `${nextConfig.date} · ${nextConfig.time || ""}`;
    if (node.type === "wait" && nextConfig.durationDays !== undefined)
      nextSummary = `Delay: ${nextConfig.durationDays} days`;
    if (node.type === "slack-nudge" && nextConfig.channel)
      nextSummary = `${nextConfig.channel}`;
    if (node.type === "approval" && nextConfig.approver)
      nextSummary = `Gate: ${nextConfig.approver}`;

    updateSelectedNode({ config: nextConfig, configSummary: nextSummary });
  };

  const selectedNode = workflow.nodes.find((n) => n.id === selectedNodeId);
  const enabledNodes = workflow.nodes.filter((n) => n.enabled);
  const failedNodes = workflow.nodes.filter((n) => n.status === "failed");

  return (
    <div className="space-y-5">
      {/* Header + Primary Workflow Actions */}
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            {embedded ? (
              <h3 className="font-serif text-xl italic text-slate-50">
                6. Workflow Canvas — {workflow.name}
              </h3>
            ) : (
              <h1 className="font-serif text-3xl italic text-slate-50">{workflow.name}</h1>
            )}
            {isRunning && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#5eead4]/45 bg-[#5eead4]/15 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-[#99f6e4]">
                <span className="h-1.5 w-1.5 animate-ping rounded-full bg-[#5eead4]" />
                Live
              </span>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-300/80">
            Drag nodes, edit in plain English, preview every payload in Dry run, then Approve and Run.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="glass-inset rounded-xl px-3 py-2 font-mono text-[11px] text-slate-200 tabular-nums">
            Duplicates blocked:{" "}
            <span className="font-semibold text-[#5eead4]">{duplicatesBlockedTotal}</span>
          </div>

          {failedNodes.length > 0 && onResumeFailed && (
            <button
              type="button"
              onClick={onResumeFailed}
              disabled={isRunning}
              className="btn-crimson-tactile inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0"
            >
              Resume Failed
            </button>
          )}

          <button
            type="button"
            onClick={onToggleChaos}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-all ${
              chaosArmed
                ? "btn-crimson-tactile"
                : "border-white/[0.14] bg-white/[0.05] text-slate-100 hover:border-rose-400/50 hover:text-rose-200"
            }`}
          >
            <span>💥 Break it</span>
          </button>

          <button
            type="button"
            onClick={handleDraftWithAi}
            disabled={isDraftingAi || isRunning}
            className="btn-glazed-soft inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-all disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {isDraftingAi ? "Drafting..." : "Draft with AI"}
          </button>

          <button
            type="button"
            onClick={handleOpenDryRun}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-all ${
              sideMode === "dryrun"
                ? "border-[#5eead4]/60 bg-[#5eead4]/20 text-white"
                : "border-white/[0.14] bg-white/[0.05] text-slate-100 hover:bg-white/[0.1]"
            }`}
          >
            <Eye className="h-3.5 w-3.5 text-[#5eead4]" />
            Dry run
          </button>

          <button
            type="button"
            onClick={onApproveAndRun}
            disabled={!dryRunViewed || isRunning}
            title={
              !dryRunViewed
                ? "Click Dry run first to inspect payloads before approving"
                : "Execute approved workflow"
            }
            className="btn-glazed-primary inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold whitespace-nowrap shrink-0 transition-all disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Play className="h-3.5 w-3.5" />
            {isRunning ? "Running..." : "Approve and Run"}
          </button>
        </div>
      </div>

      {failedNodes.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-400/45 bg-rose-500/14 px-4 py-2.5 text-xs text-rose-100">
          <span>
            {failedNodes[0].errorMessage ||
              `Step "${failedNodes[0].label}" failed. Completed steps stay locked via idempotency — click Resume to re-run only failed/remaining steps.`}
          </span>
          {onResumeFailed && (
            <button
              type="button"
              onClick={onResumeFailed}
              className="btn-crimson-tactile rounded-lg px-3 py-1 font-mono text-[11px] font-semibold"
            >
              Resume
            </button>
          )}
        </div>
      )}

      {/* Plain-English Edit Bar */}
      <form
        onSubmit={handlePlainEnglishEdit}
        className="glass-card flex flex-col gap-2.5 rounded-2xl p-3 sm:flex-row sm:items-center"
      >
        <div className="flex shrink-0 items-center gap-2 px-1.5 font-mono text-[11px] text-[#5eead4]">
          <Wand2 className="h-3.5 w-3.5" />
          <span>Edit in plain English</span>
        </div>
        <input
          type="text"
          value={plainEnglishInput}
          onChange={(e) => setPlainEnglishInput(e.target.value)}
          placeholder='e.g. "also notify #ops if amount > 50k" or "add a 2-day wait before Slack nudge"'
          className="glass-inset min-w-0 flex-1 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder:text-slate-400 focus:border-[#5eead4] focus:outline-none"
        />
        <button
          type="submit"
          disabled={isEditingAi || !plainEnglishInput.trim()}
          className="btn-glazed-soft rounded-xl px-4 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-all disabled:opacity-45"
        >
          {isEditingAi ? "Applying..." : "Apply Edit"}
        </button>
      </form>

      {aiError && (
        <div className="rounded-xl border border-rose-400/35 bg-rose-500/14 px-4 py-2.5 text-xs text-rose-100">
          {aiError}
        </div>
      )}

      {aiBanner && (
        <div className="flex items-center justify-between rounded-xl border border-[#5eead4]/35 bg-[#5eead4]/12 px-4 py-2.5 text-xs text-[#ccfbf1]">
          <span>{aiBanner}</span>
          <button
            type="button"
            onClick={() => setAiBanner(null)}
            className="text-slate-300 hover:text-white"
            aria-label="Dismiss message"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Canvas + Side Panel */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="glass-inset relative h-[540px] overflow-hidden rounded-2xl xl:col-span-8">
          {(isDraftingAi || isEditingAi) && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#071318]/80 backdrop-blur-md">
              <Loader2 className="h-5 w-5 animate-spin text-[#5eead4]" />
              <p className="font-mono text-xs text-slate-100">
                {isDraftingAi
                  ? "Generating DAG workflow nodes..."
                  : "Applying plain-English edit..."}
              </p>
            </div>
          )}
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={NODE_TYPES}
            onNodesChange={handleNodesChange}
            onNodeDragStop={handleNodeDragStop}
            onNodeClick={(_e, node) => {
              setSelectedNodeId(node.id);
              setSideMode("config");
            }}
            fitView
            fitViewOptions={{ padding: 0.22 }}
            minZoom={0.4}
            maxZoom={1.5}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={1}
              color="rgba(94, 234, 212, 0.22)"
            />
            <Controls />
            <MiniMap
              nodeColor={(n) => {
                const t = (n.data as CustomNodeData | undefined)?.wfNode?.type;
                if (t === "approval") return "#fbbf24";
                if (t === "ticket") return "#fb7185";
                if (t === "gmail") return "#38bdf8";
                if (t === "calendar") return "#34d399";
                return "#5eead4";
              }}
              maskColor="rgba(7, 19, 24, 0.72)"
            />
          </ReactFlow>
        </div>

        {/* Right Side Panel: Node Config OR Dry Run Preview */}
        <div className="glass-card flex h-[540px] flex-col overflow-hidden rounded-2xl xl:col-span-4">
          <div className="flex items-center justify-between border-b border-white/[0.09] px-4 py-3">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSideMode("config")}
                className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-all ${
                  sideMode === "config"
                    ? "btn-glazed-primary"
                    : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                Node Config
              </button>
              <button
                type="button"
                onClick={handleOpenDryRun}
                className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-all ${
                  sideMode === "dryrun"
                    ? "btn-glazed-primary"
                    : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                Dry Run Preview
              </button>
            </div>
            <span className="font-mono text-[10px] text-slate-400">
              {dryRunViewed ? "Ready to approve" : "View Dry run"}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {sideMode === "dryrun" ? (
              <div className="space-y-3.5">
                <div className="rounded-xl border border-[#5eead4]/30 bg-[#5eead4]/10 px-3.5 py-2.5 text-xs text-[#ccfbf1]">
                  Simulation only — nothing has been sent or created. Review each node below, then click <span className="font-semibold">Approve and Run</span>.
                </div>

                {enabledNodes.map((node, idx) => {
                  const visuals = getNodeVisuals(node.type);
                  const Icon = visuals.icon;
                  return (
                    <div
                      key={node.id}
                      className={`space-y-2 rounded-xl border p-3.5 ${
                        node.type === "approval"
                          ? "border-amber-300/60 bg-amber-400/[0.07]"
                          : "glass-inset"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5 text-[#5eead4]" />
                          <span className="text-xs font-semibold text-slate-100">
                            {idx + 1}. {node.label}
                          </span>
                        </div>
                        <span className="font-mono text-[10px] text-slate-400">
                          {visuals.tag}
                        </span>
                      </div>

                      {node.type === "gmail" && (
                        <div className="space-y-1.5 font-mono text-[11px] text-slate-200">
                          <div>
                            <span className="text-slate-400">To: </span>
                            <span>{node.config.to || "client@example.com"}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">Subject: </span>
                            <span className="text-slate-50">
                              {node.config.subject || `${activeMeeting.title} Recap`}
                            </span>
                          </div>
                          <div className="rounded-lg border border-white/[0.09] bg-[#061116]/75 p-2.5 font-sans text-xs leading-relaxed whitespace-pre-line text-slate-200">
                            {node.config.body || activeMeeting.summary}
                          </div>
                        </div>
                      )}

                      {node.type === "ticket" && (
                        <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                          <div className="col-span-2">
                            <span className="text-slate-400">Title: </span>
                            <span className="text-slate-50">
                              {node.config.ticketTitle || node.label}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400">Owner: </span>
                            <span className="text-slate-100">
                              {node.config.owner || "Unassigned"}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400">Priority: </span>
                            <span className="text-rose-300">
                              {node.config.priority || "High"}
                            </span>
                          </div>
                          <div className="col-span-2">
                            <span className="text-slate-400">Due Date: </span>
                            <span className="text-slate-100">
                              {node.config.dueDate || "Fri 20 Nov"}
                            </span>
                          </div>
                        </div>
                      )}

                      {node.type === "calendar" && (
                        <div className="space-y-1 font-mono text-[11px] text-slate-200">
                          <div>
                            <span className="text-slate-400">Event: </span>
                            <span className="text-slate-50">
                              {node.config.eventTitle || node.label}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400">When: </span>
                            <span>
                              {node.config.date || "Thu 19 Nov"} at{" "}
                              {node.config.time || "4:00 PM IST"} (
                              {node.config.durationMins || 30} min)
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400">Attendees: </span>
                            <span>{node.config.attendees || "Team + Client"}</span>
                          </div>
                        </div>
                      )}

                      {node.type === "approval" && (
                        <div className="space-y-1 text-xs text-amber-100">
                          <div>
                            Approver:{" "}
                            <span className="font-mono">
                              {node.config.approver || "Anita (Manager)"}
                            </span>
                          </div>
                          <div className="text-slate-300/80">
                            {node.config.rule ||
                              "Pauses downstream email/calendar until ambiguous owners are confirmed."}
                          </div>
                        </div>
                      )}

                      {node.type === "slack-nudge" && (
                        <div className="space-y-1 font-mono text-[11px] text-slate-200">
                          <div>
                            <span className="text-slate-400">Channel: </span>
                            <span className="text-[#5eead4]">
                              {node.config.channel || "#ops"}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400">If: </span>
                            <span>{node.config.condition || "Ticket still open"}</span>
                          </div>
                          <div className="rounded-lg border border-white/[0.09] bg-[#061116]/75 p-2 font-sans text-xs text-slate-200">
                            {node.config.message ||
                              "Reminder: please update open action items."}
                          </div>
                        </div>
                      )}

                      {node.type === "wait" && (
                        <div className="font-mono text-[11px] text-slate-200">
                          Wait {node.config.durationDays ?? 3} day(s) ·{" "}
                          {node.config.condition || "Evaluate open ticket state"}
                        </div>
                      )}

                      {(node.type === "trigger" || node.type === "loop") && (
                        <div className="text-xs text-slate-300">
                          {node.description} ({node.configSummary})
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : selectedNode ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-slate-300">
                    Type: <span className="text-[#5eead4]">{selectedNode.type}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => updateSelectedNode({ enabled: !selectedNode.enabled })}
                    className={`rounded-xl px-3 py-1 font-mono text-[11px] font-medium transition-all ${
                      selectedNode.enabled
                        ? "btn-glazed-primary"
                        : "border border-white/[0.14] text-slate-300"
                    }`}
                  >
                    {selectedNode.enabled ? "Enabled" : "Paused"}
                  </button>
                </div>

                <div>
                  <label className="block font-mono text-[11px] text-slate-300">Label</label>
                  <input
                    type="text"
                    value={selectedNode.label}
                    onChange={(e) => updateSelectedNode({ label: e.target.value })}
                    className="glass-inset mt-1 w-full rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-mono text-[11px] text-slate-300">
                    Description
                  </label>
                  <input
                    type="text"
                    value={selectedNode.description}
                    onChange={(e) => updateSelectedNode({ description: e.target.value })}
                    className="glass-inset mt-1 w-full rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                  />
                </div>

                {selectedNode.type === "ticket" && (
                  <div className="space-y-3 border-t border-white/[0.09] pt-3">
                    <div>
                      <label className="block font-mono text-[11px] text-slate-300">
                        Ticket Title
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.ticketTitle || ""}
                        onChange={(e) =>
                          updateSelectedConfig({ ticketTitle: e.target.value })
                        }
                        className="glass-inset mt-1 w-full rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block font-mono text-[11px] text-slate-300">
                          Owner
                        </label>
                        <input
                          type="text"
                          value={selectedNode.config.owner || ""}
                          onChange={(e) =>
                            updateSelectedConfig({ owner: e.target.value })
                          }
                          className="glass-inset mt-1 w-full rounded-xl px-2.5 py-1.5 text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block font-mono text-[11px] text-slate-300">
                          Priority
                        </label>
                        <select
                          value={selectedNode.config.priority || "High"}
                          onChange={(e) =>
                            updateSelectedConfig({
                              priority: e.target.value as TicketPriority,
                            })
                          }
                          className="glass-inset mt-1 w-full rounded-xl px-2.5 py-1.5 text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                        >
                          <option value="High" className="bg-[#0b1b22]">High</option>
                          <option value="Medium" className="bg-[#0b1b22]">Medium</option>
                          <option value="Low" className="bg-[#0b1b22]">Low</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block font-mono text-[11px] text-slate-300">
                        Due Date
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.dueDate || ""}
                        onChange={(e) =>
                          updateSelectedConfig({ dueDate: e.target.value })
                        }
                        className="glass-inset mt-1 w-full rounded-xl px-3 py-1.5 font-mono text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {selectedNode.type === "gmail" && (
                  <div className="space-y-3 border-t border-white/[0.09] pt-3">
                    <div>
                      <label className="block font-mono text-[11px] text-slate-300">To</label>
                      <input
                        type="text"
                        value={selectedNode.config.to || ""}
                        onChange={(e) => updateSelectedConfig({ to: e.target.value })}
                        className="glass-inset mt-1 w-full rounded-xl px-3 py-1.5 font-mono text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[11px] text-slate-300">
                        Subject
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.subject || ""}
                        onChange={(e) =>
                          updateSelectedConfig({ subject: e.target.value })
                        }
                        className="glass-inset mt-1 w-full rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[11px] text-slate-300">
                        Email Body
                      </label>
                      <textarea
                        rows={5}
                        value={selectedNode.config.body || ""}
                        onChange={(e) => updateSelectedConfig({ body: e.target.value })}
                        className="glass-inset mt-1 w-full rounded-xl p-2.5 text-xs leading-relaxed text-slate-100 focus:border-[#5eead4] focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {selectedNode.type === "calendar" && (
                  <div className="space-y-3 border-t border-white/[0.09] pt-3">
                    <div>
                      <label className="block font-mono text-[11px] text-slate-300">
                        Event Title
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.eventTitle || ""}
                        onChange={(e) =>
                          updateSelectedConfig({ eventTitle: e.target.value })
                        }
                        className="glass-inset mt-1 w-full rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block font-mono text-[11px] text-slate-300">
                          Date
                        </label>
                        <input
                          type="text"
                          value={selectedNode.config.date || ""}
                          onChange={(e) => updateSelectedConfig({ date: e.target.value })}
                          className="glass-inset mt-1 w-full rounded-xl px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block font-mono text-[11px] text-slate-300">
                          Time
                        </label>
                        <input
                          type="text"
                          value={selectedNode.config.time || ""}
                          onChange={(e) => updateSelectedConfig({ time: e.target.value })}
                          className="glass-inset mt-1 w-full rounded-xl px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block font-mono text-[11px] text-slate-300">
                        Attendees
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.attendees || ""}
                        onChange={(e) =>
                          updateSelectedConfig({ attendees: e.target.value })
                        }
                        className="glass-inset mt-1 w-full rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {selectedNode.type === "approval" && (
                  <div className="space-y-3 border-t border-white/[0.09] pt-3">
                    <div>
                      <label className="block font-mono text-[11px] text-slate-300">
                        Approver
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.approver || ""}
                        onChange={(e) =>
                          updateSelectedConfig({ approver: e.target.value })
                        }
                        className="glass-inset mt-1 w-full rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[11px] text-slate-300">
                        Approval Rule
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.rule || ""}
                        onChange={(e) => updateSelectedConfig({ rule: e.target.value })}
                        className="glass-inset mt-1 w-full rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {selectedNode.type === "wait" && (
                  <div className="space-y-3 border-t border-white/[0.09] pt-3">
                    <div>
                      <label className="block font-mono text-[11px] text-slate-300">
                        Wait Duration (days)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={selectedNode.config.durationDays ?? 3}
                        onChange={(e) =>
                          updateSelectedConfig({
                            durationDays: Number(e.target.value) || 1,
                          })
                        }
                        className="glass-inset mt-1 w-full rounded-xl px-3 py-1.5 font-mono text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[11px] text-slate-300">
                        Resume Condition
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.condition || ""}
                        onChange={(e) =>
                          updateSelectedConfig({ condition: e.target.value })
                        }
                        className="glass-inset mt-1 w-full rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {selectedNode.type === "slack-nudge" && (
                  <div className="space-y-3 border-t border-white/[0.09] pt-3">
                    <div>
                      <label className="block font-mono text-[11px] text-slate-300">
                        Slack Channel
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.channel || ""}
                        onChange={(e) =>
                          updateSelectedConfig({ channel: e.target.value })
                        }
                        className="glass-inset mt-1 w-full rounded-xl px-3 py-1.5 font-mono text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[11px] text-slate-300">
                        Webhook URL (leave blank for toast preview)
                      </label>
                      <input
                        type="url"
                        value={selectedNode.config.webhookUrl || ""}
                        onChange={(e) =>
                          updateSelectedConfig({ webhookUrl: e.target.value })
                        }
                        placeholder="https://hooks.slack.com/services/..."
                        className="glass-inset mt-1 w-full rounded-xl px-3 py-1.5 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-[#5eead4] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[11px] text-slate-300">
                        Trigger Condition
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.condition || ""}
                        onChange={(e) =>
                          updateSelectedConfig({ condition: e.target.value })
                        }
                        className="glass-inset mt-1 w-full rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[11px] text-slate-300">
                        Nudge Message
                      </label>
                      <textarea
                        rows={3}
                        value={selectedNode.config.message || ""}
                        onChange={(e) =>
                          updateSelectedConfig({ message: e.target.value })
                        }
                        className="glass-inset mt-1 w-full rounded-xl p-2.5 text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {(selectedNode.type === "trigger" || selectedNode.type === "loop") && (
                  <div className="border-t border-white/[0.09] pt-3">
                    <label className="block font-mono text-[11px] text-slate-300">
                      Summary Rule
                    </label>
                    <input
                      type="text"
                      value={selectedNode.configSummary}
                      onChange={(e) =>
                        updateSelectedNode({ configSummary: e.target.value })
                      }
                      className="glass-inset mt-1 w-full rounded-xl px-3 py-1.5 font-mono text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                    />
                  </div>
                )}
              </div>
            ) : (
              <p className="py-12 text-center text-xs text-slate-400">
                Click any node on the canvas to configure it, or click Dry run to inspect payloads.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
