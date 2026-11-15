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
  computeWorkflowDiff,
  validateWorkflowPayload,
} from "../utils/workflowLayout";

interface WorkflowCanvasProps {
  workflow: Workflow;
  activeMeeting: Meeting;
  people: Person[];
  isRunning: boolean;
  onReplaceWorkflow: (nodes: WorkflowNode[], edges: Workflow["edges"]) => void;
  onUpdateNodes: (nodes: WorkflowNode[]) => void;
  onApproveAndRun: () => Promise<void>;
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
        border: "border-[#a78bfa]/45",
        bg: "bg-[#13121e]",
        iconBg: "bg-[#a78bfa]/15 text-[#c4b5fd]",
      };
    case "loop":
      return {
        icon: Repeat,
        tag: "Loop",
        border: "border-cyan-400/40",
        bg: "bg-[#10161d]",
        iconBg: "bg-cyan-400/15 text-cyan-300",
      };
    case "ticket":
      return {
        icon: CheckSquare,
        tag: "Ticket",
        border: "border-rose-400/45",
        bg: "bg-[#191217]",
        iconBg: "bg-rose-400/15 text-rose-300",
      };
    case "approval":
      return {
        icon: ShieldAlert,
        tag: "Approval",
        border: "border-amber-400/85",
        bg: "bg-[#191610]",
        iconBg: "bg-amber-400/20 text-amber-300",
      };
    case "gmail":
      return {
        icon: Mail,
        tag: "Gmail",
        border: "border-sky-400/45",
        bg: "bg-[#10151d]",
        iconBg: "bg-sky-400/15 text-sky-300",
      };
    case "calendar":
      return {
        icon: Calendar,
        tag: "Calendar",
        border: "border-emerald-400/45",
        bg: "bg-[#101916]",
        iconBg: "bg-emerald-400/15 text-emerald-300",
      };
    case "wait":
      return {
        icon: Clock,
        tag: "Wait",
        border: "border-zinc-500/45",
        bg: "bg-[#14141b]",
        iconBg: "bg-zinc-500/20 text-zinc-300",
      };
    case "slack-nudge":
      return {
        icon: MessageSquare,
        tag: "Slack-nudge",
        border: "border-fuchsia-400/45",
        bg: "bg-[#17111c]",
        iconBg: "bg-fuchsia-400/15 text-fuchsia-300",
      };
  }
}

function StatusBadge({ status }: { status: NodeExecutionStatus }) {
  switch (status) {
    case "idle":
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-400">
          idle
        </span>
      );
    case "queued":
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-300">
          queued
        </span>
      );
    case "running":
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[#c4b5fd]">
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

  return (
    <div
      className={`w-[244px] rounded-xl border p-3.5 text-left transition-colors duration-150 ${
        visuals.bg
      } ${
        isSelected
          ? "border-[#a78bfa] ring-2 ring-[#a78bfa]/35"
          : visuals.border
      } ${!wfNode.enabled ? "opacity-50" : ""} ${
        isDiffGlow ? "diff-node-glow" : ""
      } ${isAppearing ? "node-appear" : ""}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-[#0b0b10] !bg-[#a78bfa]"
      />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${visuals.iconBg}`}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <span className="font-mono text-[10px] font-medium text-zinc-300">
            {visuals.tag}
          </span>
        </div>

        <StatusBadge status={wfNode.status} />
      </div>

      <div className="mt-2.5 truncate text-xs font-semibold text-zinc-100">
        {wfNode.label}
      </div>
      <div className="mt-1 truncate font-mono text-[11px] text-zinc-400">
        {wfNode.configSummary}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-[#0b0b10] !bg-[#a78bfa]"
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
  onReplaceWorkflow,
  onUpdateNodes,
  onApproveAndRun,
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

  // Staggered appearance + diff glow tracking
  const [visibleCount, setVisibleCount] = useState<number>(workflow.nodes.length);
  const [diffGlowIds, setDiffGlowIds] = useState<string[]>([]);
  const staggerTimerRef = useRef<number | null>(null);

  // Local ReactFlow nodes synced from workflow.nodes for smooth drag
  const [rfNodes, setRfNodes] = useState<FlowNode<CustomNodeData>[]>([]);

  useEffect(() => {
    setVisibleCount((prev) =>
      workflow.nodes.length < prev ? workflow.nodes.length : prev
    );
  }, [workflow.nodes.length]);

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
          style: { stroke: "rgba(167, 139, 250, 0.55)", strokeWidth: 1.75 },
          labelStyle: {
            fill: "#d4d4d8",
            fontSize: 10,
            fontFamily: "JetBrains Mono, monospace",
          },
          labelBgStyle: { fill: "#111118", fillOpacity: 0.9 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#a78bfa",
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

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to draft workflow with Gemini.");
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
        `Drafted ${validated.nodes.length}-node workflow from "${activeMeeting.title}". View Dry run to unlock Approve and Run.`
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

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to edit workflow with Gemini.");
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
          ? `Applied edit — ${changedIds.length} node(s) highlighted in lavender glow.`
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

  return (
    <div className="space-y-4">
      {/* Header + Primary Workflow Actions */}
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <h1 className="font-serif text-3xl italic text-zinc-50">{workflow.name}</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            Drag nodes, edit in plain English, preview every payload in Dry run, then Approve and Run.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDraftWithAi}
            disabled={isDraftingAi || isRunning}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#a78bfa]/40 bg-[#a78bfa]/15 px-3.5 py-2 text-xs font-medium text-[#e9d5ff] whitespace-nowrap shrink-0 transition-colors hover:bg-[#a78bfa] hover:text-[#0b0b10] disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {isDraftingAi ? "Drafting..." : "Draft with AI"}
          </button>

          <button
            type="button"
            onClick={handleOpenDryRun}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              sideMode === "dryrun"
                ? "border-[#a78bfa] bg-[#a78bfa]/20 text-white"
                : "border-white/[0.12] bg-[#111118] text-zinc-200 hover:bg-white/[0.06]"
            }`}
          >
            <Eye className="h-3.5 w-3.5 text-[#a78bfa]" />
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
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#a78bfa] px-4 py-2 text-xs font-semibold text-[#0b0b10] whitespace-nowrap shrink-0 transition-colors hover:bg-[#c4b5fd] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Play className="h-3.5 w-3.5" />
            {isRunning ? "Running..." : "Approve and Run"}
          </button>
        </div>
      </div>

      {/* Plain-English Edit Bar */}
      <form
        onSubmit={handlePlainEnglishEdit}
        className="flex flex-col gap-2 rounded-xl border border-white/[0.08] bg-[#111118]/90 p-3 sm:flex-row sm:items-center"
      >
        <div className="flex items-center gap-2 font-mono text-[11px] text-[#c4b5fd] shrink-0 px-1">
          <Wand2 className="h-3.5 w-3.5" />
          <span>Edit in plain English</span>
        </div>
        <input
          type="text"
          value={plainEnglishInput}
          onChange={(e) => setPlainEnglishInput(e.target.value)}
          placeholder='e.g. "also notify #ops if amount > 50k" or "add a 2-day wait before Slack nudge"'
          className="min-w-0 flex-1 rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-[#a78bfa] focus:outline-none"
        />
        <button
          type="submit"
          disabled={isEditingAi || !plainEnglishInput.trim()}
          className="rounded-lg border border-[#a78bfa]/35 bg-[#a78bfa]/15 px-4 py-2 text-xs font-medium text-[#e9d5ff] whitespace-nowrap shrink-0 transition-colors hover:bg-[#a78bfa] hover:text-[#0b0b10] disabled:opacity-45"
        >
          {isEditingAi ? "Applying..." : "Apply Edit"}
        </button>
      </form>

      {aiError && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">
          {aiError}
        </div>
      )}

      {aiBanner && (
        <div className="flex items-center justify-between rounded-lg border border-[#a78bfa]/30 bg-[#a78bfa]/10 px-4 py-2 text-xs text-[#e9d5ff]">
          <span>{aiBanner}</span>
          <button
            type="button"
            onClick={() => setAiBanner(null)}
            className="text-zinc-400 hover:text-white"
            aria-label="Dismiss message"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Canvas + Side Panel */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="xl:col-span-8 h-[540px] overflow-hidden rounded-xl border border-white/[0.08] bg-[#0b0b10]">
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
              gap={20}
              size={1}
              color="rgba(167, 139, 250, 0.2)"
            />
            <Controls />
            <MiniMap
              nodeColor={(n) => {
                const t = (n.data as CustomNodeData | undefined)?.wfNode?.type;
                if (t === "approval") return "#fbbf24";
                if (t === "ticket") return "#fb7185";
                if (t === "gmail") return "#38bdf8";
                if (t === "calendar") return "#34d399";
                return "#a78bfa";
              }}
              maskColor="rgba(11, 11, 16, 0.72)"
            />
          </ReactFlow>
        </div>

        {/* Right Side Panel: Node Config OR Dry Run Preview */}
        <div className="xl:col-span-4 flex h-[540px] flex-col rounded-xl border border-white/[0.08] bg-[#111118]/95">
          {/* Panel Switcher */}
          <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSideMode("config")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  sideMode === "config"
                    ? "bg-[#a78bfa] text-[#0b0b10]"
                    : "text-zinc-400 hover:text-zinc-100"
                }`}
              >
                Node Config
              </button>
              <button
                type="button"
                onClick={handleOpenDryRun}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  sideMode === "dryrun"
                    ? "bg-[#a78bfa] text-[#0b0b10]"
                    : "text-zinc-400 hover:text-zinc-100"
                }`}
              >
                Dry Run Preview
              </button>
            </div>
            <span className="font-mono text-[10px] text-zinc-500">
              {dryRunViewed ? "Ready to approve" : "View Dry run"}
            </span>
          </div>

          {/* Panel Body */}
          <div className="flex-1 overflow-y-auto p-4">
            {sideMode === "dryrun" ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-[#a78bfa]/25 bg-[#a78bfa]/10 px-3 py-2.5 text-xs text-[#e9d5ff]">
                  Simulation only — nothing has been sent or created. Review each node below, then click <span className="font-semibold">Approve and Run</span>.
                </div>

                {enabledNodes.map((node, idx) => {
                  const visuals = getNodeVisuals(node.type);
                  const Icon = visuals.icon;
                  return (
                    <div
                      key={node.id}
                      className={`rounded-lg border p-3.5 space-y-2 ${
                        node.type === "approval"
                          ? "border-amber-400/60 bg-amber-500/[0.05]"
                          : "border-white/[0.08] bg-[#0b0b10]/85"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5 text-[#c4b5fd]" />
                          <span className="text-xs font-semibold text-zinc-100">
                            {idx + 1}. {node.label}
                          </span>
                        </div>
                        <span className="font-mono text-[10px] text-zinc-500">
                          {visuals.tag}
                        </span>
                      </div>

                      {node.type === "gmail" && (
                        <div className="space-y-1.5 font-mono text-[11px] text-zinc-300">
                          <div>
                            <span className="text-zinc-500">To: </span>
                            <span>{node.config.to || "client@example.com"}</span>
                          </div>
                          <div>
                            <span className="text-zinc-500">Subject: </span>
                            <span className="text-zinc-100">
                              {node.config.subject || `${activeMeeting.title} Recap`}
                            </span>
                          </div>
                          <div className="rounded border border-white/[0.07] bg-[#111118] p-2.5 font-sans text-xs leading-relaxed whitespace-pre-line text-zinc-200">
                            {node.config.body || activeMeeting.summary}
                          </div>
                        </div>
                      )}

                      {node.type === "ticket" && (
                        <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                          <div className="col-span-2">
                            <span className="text-zinc-500">Title: </span>
                            <span className="text-zinc-100">
                              {node.config.ticketTitle || node.label}
                            </span>
                          </div>
                          <div>
                            <span className="text-zinc-500">Owner: </span>
                            <span className="text-zinc-200">
                              {node.config.owner || "Unassigned"}
                            </span>
                          </div>
                          <div>
                            <span className="text-zinc-500">Priority: </span>
                            <span className="text-rose-300">
                              {node.config.priority || "High"}
                            </span>
                          </div>
                          <div className="col-span-2">
                            <span className="text-zinc-500">Due Date: </span>
                            <span className="text-zinc-200">
                              {node.config.dueDate || "Fri 20 Nov"}
                            </span>
                          </div>
                        </div>
                      )}

                      {node.type === "calendar" && (
                        <div className="space-y-1 font-mono text-[11px] text-zinc-300">
                          <div>
                            <span className="text-zinc-500">Event: </span>
                            <span className="text-zinc-100">
                              {node.config.eventTitle || node.label}
                            </span>
                          </div>
                          <div>
                            <span className="text-zinc-500">When: </span>
                            <span>
                              {node.config.date || "Thu 19 Nov"} at{" "}
                              {node.config.time || "4:00 PM IST"} (
                              {node.config.durationMins || 30} min)
                            </span>
                          </div>
                          <div>
                            <span className="text-zinc-500">Attendees: </span>
                            <span>{node.config.attendees || "Team + Client"}</span>
                          </div>
                        </div>
                      )}

                      {node.type === "approval" && (
                        <div className="space-y-1 text-xs text-amber-200/90">
                          <div>
                            Approver:{" "}
                            <span className="font-mono">
                              {node.config.approver || "Anita (Manager)"}
                            </span>
                          </div>
                          <div className="text-zinc-400">
                            {node.config.rule ||
                              "Pauses downstream email/calendar until ambiguous owners are confirmed."}
                          </div>
                        </div>
                      )}

                      {node.type === "slack-nudge" && (
                        <div className="space-y-1 font-mono text-[11px] text-zinc-300">
                          <div>
                            <span className="text-zinc-500">Channel: </span>
                            <span className="text-fuchsia-300">
                              {node.config.channel || "#ops"}
                            </span>
                          </div>
                          <div>
                            <span className="text-zinc-500">If: </span>
                            <span>{node.config.condition || "Ticket still open"}</span>
                          </div>
                          <div className="rounded border border-white/[0.07] bg-[#111118] p-2 font-sans text-xs text-zinc-200">
                            {node.config.message ||
                              "Reminder: please update open action items."}
                          </div>
                        </div>
                      )}

                      {node.type === "wait" && (
                        <div className="font-mono text-[11px] text-zinc-300">
                          Wait {node.config.durationDays ?? 3} day(s) ·{" "}
                          {node.config.condition || "Evaluate open ticket state"}
                        </div>
                      )}

                      {(node.type === "trigger" || node.type === "loop") && (
                        <div className="text-xs text-zinc-400">
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
                  <span className="font-mono text-[11px] text-zinc-400">
                    Type: <span className="text-[#c4b5fd]">{selectedNode.type}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => updateSelectedNode({ enabled: !selectedNode.enabled })}
                    className={`rounded-md px-2.5 py-1 font-mono text-[11px] font-medium transition-colors ${
                      selectedNode.enabled
                        ? "bg-[#a78bfa] text-[#0b0b10]"
                        : "border border-white/[0.12] text-zinc-400"
                    }`}
                  >
                    {selectedNode.enabled ? "Enabled" : "Paused"}
                  </button>
                </div>

                <div>
                  <label className="block font-mono text-[11px] text-zinc-400">Label</label>
                  <input
                    type="text"
                    value={selectedNode.label}
                    onChange={(e) => updateSelectedNode({ label: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3 py-1.5 text-xs text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-mono text-[11px] text-zinc-400">
                    Description
                  </label>
                  <input
                    type="text"
                    value={selectedNode.description}
                    onChange={(e) => updateSelectedNode({ description: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3 py-1.5 text-xs text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
                  />
                </div>

                {/* Type-specific Config Fields */}
                {selectedNode.type === "ticket" && (
                  <div className="space-y-3 border-t border-white/[0.07] pt-3">
                    <div>
                      <label className="block font-mono text-[11px] text-zinc-400">
                        Ticket Title
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.ticketTitle || ""}
                        onChange={(e) =>
                          updateSelectedConfig({ ticketTitle: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3 py-1.5 text-xs text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block font-mono text-[11px] text-zinc-400">
                          Owner
                        </label>
                        <input
                          type="text"
                          value={selectedNode.config.owner || ""}
                          onChange={(e) =>
                            updateSelectedConfig({ owner: e.target.value })
                          }
                          className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] px-2.5 py-1.5 text-xs text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block font-mono text-[11px] text-zinc-400">
                          Priority
                        </label>
                        <select
                          value={selectedNode.config.priority || "High"}
                          onChange={(e) =>
                            updateSelectedConfig({
                              priority: e.target.value as TicketPriority,
                            })
                          }
                          className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] px-2.5 py-1.5 text-xs text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
                        >
                          <option value="High">High</option>
                          <option value="Medium">Medium</option>
                          <option value="Low">Low</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block font-mono text-[11px] text-zinc-400">
                        Due Date
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.dueDate || ""}
                        onChange={(e) =>
                          updateSelectedConfig({ dueDate: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3 py-1.5 font-mono text-xs text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {selectedNode.type === "gmail" && (
                  <div className="space-y-3 border-t border-white/[0.07] pt-3">
                    <div>
                      <label className="block font-mono text-[11px] text-zinc-400">To</label>
                      <input
                        type="text"
                        value={selectedNode.config.to || ""}
                        onChange={(e) => updateSelectedConfig({ to: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3 py-1.5 font-mono text-xs text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[11px] text-zinc-400">
                        Subject
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.subject || ""}
                        onChange={(e) =>
                          updateSelectedConfig({ subject: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3 py-1.5 text-xs text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[11px] text-zinc-400">
                        Email Body
                      </label>
                      <textarea
                        rows={5}
                        value={selectedNode.config.body || ""}
                        onChange={(e) => updateSelectedConfig({ body: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] p-2.5 text-xs leading-relaxed text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {selectedNode.type === "calendar" && (
                  <div className="space-y-3 border-t border-white/[0.07] pt-3">
                    <div>
                      <label className="block font-mono text-[11px] text-zinc-400">
                        Event Title
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.eventTitle || ""}
                        onChange={(e) =>
                          updateSelectedConfig({ eventTitle: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3 py-1.5 text-xs text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block font-mono text-[11px] text-zinc-400">
                          Date
                        </label>
                        <input
                          type="text"
                          value={selectedNode.config.date || ""}
                          onChange={(e) => updateSelectedConfig({ date: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] px-2.5 py-1.5 font-mono text-xs text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block font-mono text-[11px] text-zinc-400">
                          Time
                        </label>
                        <input
                          type="text"
                          value={selectedNode.config.time || ""}
                          onChange={(e) => updateSelectedConfig({ time: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] px-2.5 py-1.5 font-mono text-xs text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block font-mono text-[11px] text-zinc-400">
                        Attendees
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.attendees || ""}
                        onChange={(e) =>
                          updateSelectedConfig({ attendees: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3 py-1.5 text-xs text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {selectedNode.type === "approval" && (
                  <div className="space-y-3 border-t border-white/[0.07] pt-3">
                    <div>
                      <label className="block font-mono text-[11px] text-zinc-400">
                        Approver
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.approver || ""}
                        onChange={(e) =>
                          updateSelectedConfig({ approver: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3 py-1.5 text-xs text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[11px] text-zinc-400">
                        Approval Rule
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.rule || ""}
                        onChange={(e) => updateSelectedConfig({ rule: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3 py-1.5 text-xs text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {selectedNode.type === "wait" && (
                  <div className="space-y-3 border-t border-white/[0.07] pt-3">
                    <div>
                      <label className="block font-mono text-[11px] text-zinc-400">
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
                        className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3 py-1.5 font-mono text-xs text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[11px] text-zinc-400">
                        Resume Condition
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.condition || ""}
                        onChange={(e) =>
                          updateSelectedConfig({ condition: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3 py-1.5 text-xs text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {selectedNode.type === "slack-nudge" && (
                  <div className="space-y-3 border-t border-white/[0.07] pt-3">
                    <div>
                      <label className="block font-mono text-[11px] text-zinc-400">
                        Slack Channel
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.channel || ""}
                        onChange={(e) =>
                          updateSelectedConfig({ channel: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3 py-1.5 font-mono text-xs text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[11px] text-zinc-400">
                        Trigger Condition
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.condition || ""}
                        onChange={(e) =>
                          updateSelectedConfig({ condition: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3 py-1.5 text-xs text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[11px] text-zinc-400">
                        Nudge Message
                      </label>
                      <textarea
                        rows={3}
                        value={selectedNode.config.message || ""}
                        onChange={(e) =>
                          updateSelectedConfig({ message: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] p-2.5 text-xs text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {(selectedNode.type === "trigger" || selectedNode.type === "loop") && (
                  <div className="border-t border-white/[0.07] pt-3">
                    <label className="block font-mono text-[11px] text-zinc-400">
                      Summary Rule
                    </label>
                    <input
                      type="text"
                      value={selectedNode.configSummary}
                      onChange={(e) =>
                        updateSelectedNode({ configSummary: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3 py-1.5 font-mono text-xs text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
                    />
                  </div>
                )}
              </div>
            ) : (
              <p className="py-12 text-center text-xs text-zinc-500">
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
