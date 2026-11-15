import {
  CheckSquare,
  FileAudio,
  FileText,
  GitBranch,
  Handshake,
  Menu,
  MessageSquareText,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ExtractedPanel } from "./components/ExtractedPanel";
import { NewMeetingModal } from "./components/NewMeetingModal";
import { PromiseLedger } from "./components/PromiseLedger";
import { RunTimeline } from "./components/RunTimeline";
import { TicketsBoard } from "./components/TicketsBoard";
import { Transcript } from "./components/Transcript";
import { Waveform } from "./components/Waveform";
import { WorkflowCanvas } from "./components/WorkflowCanvas";
import type {
  MeetMindState,
  Meeting,
  Promise as PromiseRecord,
  PromiseStatus,
  Run,
  Segment,
  SidebarView,
  Ticket,
  TicketPriority,
  TicketStatus,
} from "./types/meetmind";
import {
  resolveExtractedItems,
  validateRawExtractionResponse,
} from "./utils/resolver";
import {
  loadMeetMindState,
  resetMeetMindState,
  saveMeetMindState,
} from "./utils/storage";

export default function App() {
  const [state, setState] = useState<MeetMindState>(() => loadMeetMindState());
  const [activeView, setActiveView] = useState<SidebarView>("meetings");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [ingestModal, setIngestModal] = useState<{
    open: boolean;
    mode: "paste" | "audio";
  }>({ open: false, mode: "paste" });

  // Required consent banner state
  const [consentAccepted, setConsentAccepted] = useState(false);

  // Playback & quote highlight state
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [highlightedSegmentId, setHighlightedSegmentId] = useState<string | null>(null);
  const [highlightedQuote, setHighlightedQuote] = useState<string | null>(null);
  const [highlightNonce, setHighlightNonce] = useState(0);

  // Async Gemini extraction & run execution states
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [isRunningMeeting, setIsRunningMeeting] = useState(false);
  const [runFeedback, setRunFeedback] = useState<{
    runId: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    saveMeetMindState(state);
  }, [state]);

  const selectedMeeting =
    state.meetings.find((m) => m.id === state.selectedMeetingId) || state.meetings[0];

  const pendingConfirmCount = state.meetings.reduce(
    (acc, m) =>
      acc + m.extractedItems.filter((i) => i.needsConfirmation && !i.resolved).length,
    0
  );
  const unownedPromisesCount = state.promises.filter((p) => p.ownerId === null).length;

  const selectMeeting = (meetingId: string) => {
    setIsPlaying(false);
    setCurrentSeconds(0);
    setHighlightedSegmentId(null);
    setHighlightedQuote(null);
    setExtractError(null);
    setState((prev) => ({ ...prev, selectedMeetingId: meetingId }));
    setActiveView("meetings");
    setMobileMenuOpen(false);
  };

  const handleJumpToQuote = (segmentId: string, quote: string | null = null) => {
    const seg = selectedMeeting?.segments.find((s) => s.id === segmentId);
    if (seg) {
      setCurrentSeconds(seg.seconds);
    }
    setHighlightedSegmentId(segmentId);
    setHighlightedQuote(quote);
    setHighlightNonce((n) => n + 1);
  };

  const handleJumpFromBoardOrLedger = (meetingId: string, segmentId: string) => {
    const targetMeeting = state.meetings.find((m) => m.id === meetingId);
    const matchingItem = targetMeeting?.extractedItems.find(
      (i) => i.segmentId === segmentId
    );
    const seg = targetMeeting?.segments.find((s) => s.id === segmentId);

    setState((prev) => ({ ...prev, selectedMeetingId: meetingId }));
    setActiveView("meetings");
    setIsPlaying(false);
    setCurrentSeconds(seg?.seconds || 0);

    window.setTimeout(() => {
      setHighlightedSegmentId(segmentId);
      setHighlightedQuote(matchingItem?.quote || null);
      setHighlightNonce((n) => n + 1);
    }, 60);
  };

  const handleResolveAmbiguity = (itemId: string, personId: string) => {
    const resolvedPerson = state.people.find((p) => p.id === personId);
    if (!resolvedPerson || !selectedMeeting) return;

    const targetItem = selectedMeeting.extractedItems.find((i) => i.id === itemId);

    setState((prev) => {
      const updatedMeetings = prev.meetings.map((m) => {
        if (m.id !== selectedMeeting.id) return m;
        return {
          ...m,
          extractedItems: m.extractedItems.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  ownerId: personId,
                  resolutionStatus: "confirmed" as const,
                  needsConfirmation: false,
                  resolved: true,
                  confidence: Math.max(item.confidence, 0.92),
                  ambiguityReason: undefined,
                }
              : item
          ),
        };
      });

      const updatedPromises = prev.promises.map((p) => {
        if (
          p.meetingId === selectedMeeting.id &&
          p.segmentId === targetItem?.segmentId &&
          !p.ownerId
        ) {
          return {
            ...p,
            ownerId: personId,
            confidence: Math.max(p.confidence, 0.92),
            status: p.status === "At Risk" ? ("Open" as PromiseStatus) : p.status,
          };
        }
        return p;
      });

      const updatedTickets = prev.tickets.map((t) => {
        if (
          t.meetingId === selectedMeeting.id &&
          t.segmentId === targetItem?.segmentId &&
          !t.assigneeId
        ) {
          return {
            ...t,
            assigneeId: personId,
            status: t.status === "Blocked" ? ("In Progress" as TicketStatus) : t.status,
          };
        }
        return t;
      });

      return {
        ...prev,
        meetings: updatedMeetings,
        promises: updatedPromises,
        tickets: updatedTickets,
      };
    });
  };

  const handleDismissAmbiguity = (itemId: string) => {
    if (!selectedMeeting) return;
    setState((prev) => ({
      ...prev,
      meetings: prev.meetings.map((m) =>
        m.id !== selectedMeeting.id
          ? m
          : {
              ...m,
              extractedItems: m.extractedItems.filter((i) => i.id !== itemId),
            }
      ),
    }));
  };

  const handleAnalyzeWithGemini = async () => {
    if (!selectedMeeting) return;
    if (!consentAccepted) {
      setExtractError('Please check "Audio is processed once and not stored." before analyzing.');
      return;
    }

    setIsExtracting(true);
    setExtractError(null);

    try {
      const response = await fetch("/api/gemini/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: selectedMeeting.title,
          segments: selectedMeeting.segments,
          roster: state.people,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to extract via Gemini.");
      }

      const validation = validateRawExtractionResponse(data);
      if (!validation.valid) {
        throw new Error(validation.error || "Gemini returned an invalid JSON payload.");
      }

      const resolvedItems = resolveExtractedItems(
        validation.items,
        selectedMeeting.segments,
        state.people,
        selectedMeeting.date,
        selectedMeeting.id
      );

      setState((prev) => ({
        ...prev,
        meetings: prev.meetings.map((m) =>
          m.id === selectedMeeting.id
            ? {
                ...m,
                summary: validation.summary || m.summary,
                extractedItems: resolvedItems,
              }
            : m
        ),
      }));
    } catch (err) {
      setExtractError(
        err instanceof Error ? err.message : "Could not reach Gemini extraction endpoint."
      );
    } finally {
      setIsExtracting(false);
    }
  };

  const handleRunMeeting = async () => {
    if (!selectedMeeting || isRunningMeeting) return;
    setIsRunningMeeting(true);
    setRunFeedback(null);

    const pendingItems = selectedMeeting.extractedItems.filter(
      (i) => i.needsConfirmation && !i.resolved
    );
    const confirmedItems = selectedMeeting.extractedItems.filter(
      (i) => !i.needsConfirmation || i.resolved
    );

    const itemsSummaryText = selectedMeeting.extractedItems
      .map((item) => {
        const owner = state.people.find((p) => p.id === item.ownerId)?.name || "Unassigned";
        return `- [${item.kind}] ${item.title} (Owner: ${owner}, Due: ${item.dueDate})`;
      })
      .join("\n");

    let recapDraft =
      `Recap for ${selectedMeeting.title} (${selectedMeeting.date}):\n` +
      confirmedItems
        .map((i) => {
          const owner = state.people.find((p) => p.id === i.ownerId)?.name || "Team";
          return `• ${i.title} — ${owner} (${i.dueDate})`;
        })
        .join("\n");

    try {
      const res = await fetch("/api/gemini/recap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingTitle: selectedMeeting.title,
          date: selectedMeeting.date,
          itemsSummary: itemsSummaryText,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.recap) recapDraft = data.recap;
      }
    } catch {
      // Keep local recap fallback seamlessly
    }

    // Set all enabled workflow nodes to queued first
    setState((prev) => ({
      ...prev,
      workflow: {
        ...prev.workflow,
        nodes: prev.workflow.nodes.map((n) => ({
          ...n,
          status: n.enabled ? "queued" : "idle",
        })),
      },
    }));

    // Animate node-by-node execution across the React Flow graph
    const enabledWorkflowNodes = state.workflow.nodes.filter((n) => n.enabled);
    for (const wfNode of enabledWorkflowNodes) {
      setState((prev) => ({
        ...prev,
        workflow: {
          ...prev.workflow,
          nodes: prev.workflow.nodes.map((n) =>
            n.id === wfNode.id ? { ...n, status: "running" } : n
          ),
        },
      }));
      await new Promise((r) => window.setTimeout(r, 240));
      const finalNodeStatus =
        wfNode.type === "approval" && pendingItems.length > 0 ? "waiting" : "done";
      setState((prev) => ({
        ...prev,
        workflow: {
          ...prev.workflow,
          nodes: prev.workflow.nodes.map((n) =>
            n.id === wfNode.id ? { ...n, status: finalNodeStatus } : n
          ),
        },
      }));
    }

    const now = new Date();
    const timeLabel = `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes()
    ).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    const runId = `run_${Date.now()}`;

    const newRun: Run = {
      id: runId,
      meetingId: selectedMeeting.id,
      meetingTitle: selectedMeeting.title,
      workflowId: state.workflow.id,
      status: pendingItems.length > 0 ? "needs_review" : "completed",
      startedAt: `14 Nov · ${timeLabel.slice(0, 5)}`,
      completedAt: `14 Nov · ${timeLabel.slice(0, 5)}`,
      recapDraft,
      steps: state.workflow.nodes.map((node, index) => {
        if (!node.enabled) {
          return {
            id: `rs_${runId}_${index}`,
            nodeId: node.id,
            nodeLabel: node.label,
            status: "skipped",
            startedAt: timeLabel,
            durationMs: 0,
            outputSummary: "Node paused in workflow configuration.",
          };
        }

        if (node.type === "approval" && pendingItems.length > 0) {
          return {
            id: `rs_${runId}_${index}`,
            nodeId: node.id,
            nodeLabel: node.label,
            status: "waiting",
            startedAt: timeLabel,
            durationMs: 115,
            outputSummary: `${pendingItems.length} item(s) awaiting confirmation before client send.`,
          };
        }

        const outputs: Record<string, string> = {
          trigger: `Triggered on "${selectedMeeting.title}" (${selectedMeeting.segments.length} turns).`,
          loop: `Iterated ${selectedMeeting.extractedItems.length} extracted meeting items.`,
          ticket: `Synced ${confirmedItems.filter((i) => i.kind !== "Decision").length} tickets to Tickets Board.`,
          approval: "Approval gate cleared — all owners verified.",
          gmail: `Prepared recap email to ${node.config.to || "client stakeholders"}.`,
          calendar: `Scheduled ${node.config.eventTitle || "follow-up check-in"} (${node.config.date || "Thu 19 Nov"}).`,
          wait: `Armed ${node.config.durationDays ?? 3}-day follow-up check.`,
          "slack-nudge": `Configured conditional nudge to ${node.config.channel || "#ops"}.`,
        };

        return {
          id: `rs_${runId}_${index}`,
          nodeId: node.id,
          nodeLabel: node.label,
          status: "completed",
          startedAt: timeLabel,
          durationMs: 140 + index * 95,
          outputSummary: outputs[node.type] || "Completed.",
        };
      }),
    };

    setState((prev) => {
      const nextTickets = [...prev.tickets];
      const nextPromises = [...prev.promises];

      for (const item of selectedMeeting.extractedItems) {
        if (item.kind === "Complaint" || item.kind === "Action" || item.kind === "Commit") {
          const existsTicket = nextTickets.some(
            (t) => t.meetingId === selectedMeeting.id && t.segmentId === item.segmentId
          );
          if (!existsTicket) {
            nextTickets.unshift({
              id: `tkt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              key: `MM-${101 + nextTickets.length}`,
              title: item.title,
              description: `Extracted from ${selectedMeeting.title}: "${item.quote}"`,
              status: item.ownerId ? "Backlog" : "Blocked",
              priority: item.kind === "Complaint" ? "High" : "Medium",
              assigneeId: item.ownerId,
              dueDate: item.dueDate,
              meetingId: selectedMeeting.id,
              segmentId: item.segmentId,
              sourceKind: item.kind,
            });
          }
        }

        if (item.kind === "Commit" || item.kind === "Action") {
          const existsPromise = nextPromises.some(
            (p) => p.meetingId === selectedMeeting.id && p.segmentId === item.segmentId
          );
          if (!existsPromise) {
            nextPromises.unshift({
              id: `prm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              statement: item.title,
              ownerId: item.ownerId,
              counterparty: selectedMeeting.title.includes("Acme") ? "Acme Corp" : "Internal",
              dueDate: item.dueDate,
              status: item.ownerId ? "Open" : "At Risk",
              confidence: item.confidence,
              meetingId: selectedMeeting.id,
              segmentId: item.segmentId,
            });
          }
        }
      }

      return {
        ...prev,
        runs: [newRun, ...prev.runs],
        tickets: nextTickets,
        promises: nextPromises,
        meetings: prev.meetings.map((m) =>
          m.id === selectedMeeting.id ? { ...m, lastRunId: runId } : m
        ),
      };
    });

    setIsRunningMeeting(false);
    setRunFeedback({
      runId,
      message:
        pendingItems.length > 0
          ? `Pipeline executed for "${selectedMeeting.title}" — ${pendingItems.length} item(s) still awaiting your confirmation.`
          : `Pipeline executed cleanly for "${selectedMeeting.title}". Tickets, Promises, and Recap updated.`,
    });
  };

  const handleCreateNewMeeting = (newMeeting: Meeting) => {
    setState((prev) => {
      const createdTickets: Ticket[] = newMeeting.extractedItems
        .filter((i) => i.kind !== "Decision")
        .map((item, idx) => ({
          id: `tkt_${Date.now()}_${idx}`,
          key: `MM-${101 + prev.tickets.length + idx}`,
          title: item.title,
          description: `Extracted quote: "${item.quote}"`,
          status: item.ownerId ? "Backlog" : "Blocked",
          priority: item.kind === "Complaint" ? "High" : "Medium",
          assigneeId: item.ownerId,
          dueDate: item.dueDate,
          meetingId: newMeeting.id,
          segmentId: item.segmentId,
          sourceKind: item.kind,
        }));

      const createdPromises: PromiseRecord[] = newMeeting.extractedItems
        .filter((i) => i.kind === "Commit" || i.kind === "Action")
        .map((item, idx) => ({
          id: `prm_${Date.now()}_${idx}`,
          statement: item.title,
          ownerId: item.ownerId,
          counterparty: newMeeting.title,
          dueDate: item.dueDate,
          status: item.ownerId ? "Open" : "At Risk",
          confidence: item.confidence,
          meetingId: newMeeting.id,
          segmentId: item.segmentId,
        }));

      return {
        ...prev,
        meetings: [newMeeting, ...prev.meetings],
        selectedMeetingId: newMeeting.id,
        tickets: [...createdTickets, ...prev.tickets],
        promises: [...createdPromises, ...prev.promises],
      };
    });
    setActiveView("meetings");
  };

  const speakerNames = selectedMeeting
    ? selectedMeeting.speakerIds
        .map((id) => state.people.find((p) => p.id === id)?.name)
        .filter(Boolean)
        .join(", ")
    : "";

  const navItems: Array<{
    id: SidebarView;
    label: string;
    icon: typeof MessageSquareText;
    count?: number;
  }> = [
    {
      id: "meetings",
      label: "Meetings",
      icon: MessageSquareText,
      count: pendingConfirmCount > 0 ? pendingConfirmCount : undefined,
    },
    { id: "workflow", label: "Workflow", icon: GitBranch },
    { id: "tickets", label: "Tickets", icon: CheckSquare, count: state.tickets.length },
    {
      id: "promises",
      label: "Promise Ledger",
      icon: Handshake,
      count: unownedPromisesCount > 0 ? unownedPromisesCount : state.promises.length,
    },
  ];

  const breadcrumbLabel =
    activeView === "meetings"
      ? `Meetings / ${selectedMeeting?.title || ""}`
      : activeView === "workflow"
      ? "Workflow / Pipeline & Runs"
      : activeView === "tickets"
      ? "Tickets / Action Board"
      : "Promise Ledger / Commitments";

  return (
    <div className="flex min-h-screen bg-[#0b0b10] text-zinc-100">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/70 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Left Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[260px] shrink-0 flex-col border-r border-white/[0.08] bg-[#0e0e15] transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand */}
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
          <div>
            <div className="font-serif text-2xl italic tracking-tight text-zinc-50">
              MeetMind
            </div>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              Meetings that execute themselves.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="rounded-lg p-1 text-zinc-400 hover:text-zinc-100 lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Primary Nav */}
        <nav aria-label="Workspace sections" className="space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveView(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa] ${
                  active
                    ? "bg-[#a78bfa]/15 text-[#e9d5ff]"
                    : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
                }`}
              >
                <span className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
                  <Icon
                    className={`h-4 w-4 ${active ? "text-[#a78bfa]" : "text-zinc-500"}`}
                  />
                  {item.label}
                </span>
                {item.count !== undefined && (
                  <span
                    className={`font-mono text-[11px] tabular-nums ${
                      active ? "text-[#c4b5fd]" : "text-zinc-500"
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Meetings Switcher */}
        <div className="mt-1 flex-1 overflow-y-auto border-t border-white/[0.07] px-3 py-4">
          <div className="flex items-center justify-between px-2">
            <span className="font-mono text-[11px] text-zinc-500">Recent Meetings</span>
            <button
              type="button"
              onClick={() => setIngestModal({ open: true, mode: "paste" })}
              className="inline-flex items-center gap-1 font-mono text-[11px] text-[#a78bfa] hover:text-[#c4b5fd]"
            >
              <Plus className="h-3 w-3" />
              New
            </button>
          </div>

          <div className="mt-2.5 space-y-1">
            {state.meetings.map((mtg) => {
              const isSelected = mtg.id === selectedMeeting?.id && activeView === "meetings";
              const pending = mtg.extractedItems.filter(
                (i) => i.needsConfirmation && !i.resolved
              ).length;
              return (
                <button
                  key={mtg.id}
                  type="button"
                  onClick={() => selectMeeting(mtg.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? "bg-white/[0.06] text-zinc-100"
                      : "text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200"
                  }`}
                >
                  <div className="truncate text-xs font-medium">{mtg.title}</div>
                  <div className="mt-0.5 flex items-center justify-between font-mono text-[10px] text-zinc-500 tabular-nums">
                    <span>
                      {mtg.date} · {mtg.duration}
                    </span>
                    {pending > 0 && <span className="text-amber-300">{pending} check</span>}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Team Roster */}
          <div className="mt-6 border-t border-white/[0.07] px-2 pt-4">
            <div className="font-mono text-[11px] text-zinc-500">Team Roster</div>
            <div className="mt-2.5 space-y-2">
              {state.people.map((person) => (
                <div key={person.id} className="flex items-center justify-between text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-[10px] font-semibold"
                      style={{
                        backgroundColor: `${person.accentHex}20`,
                        color: person.accentHex,
                      }}
                    >
                      {person.initials}
                    </span>
                    <span className="truncate text-zinc-300">{person.name}</span>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                    {person.role}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Reset */}
        <div className="border-t border-white/[0.07] px-4 py-3">
          <button
            type="button"
            onClick={() => {
              const reset = resetMeetMindState();
              setState(reset);
              setCurrentSeconds(0);
              setIsPlaying(false);
              setRunFeedback(null);
            }}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] text-zinc-500 transition-colors hover:text-zinc-300"
          >
            <RotateCcw className="h-3 w-3" />
            Reset sample workspace
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="canvas-dotted-grid flex min-w-0 flex-1 flex-col">
        {/* Top Bar */}
        <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-white/[0.08] bg-[#0b0b10]/90 px-4 py-3 backdrop-blur-md sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
              className="rounded-lg border border-white/[0.1] p-2 text-zinc-300 hover:bg-white/[0.05] lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="truncate font-mono text-xs text-zinc-400">
              <span className="text-zinc-500">MeetMind</span>
              <span className="mx-2 text-zinc-600">/</span>
              <span className="text-zinc-200">{breadcrumbLabel}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleRunMeeting}
            disabled={isRunningMeeting}
            className="inline-flex items-center gap-2 rounded-lg bg-[#a78bfa] px-4 py-2 text-xs font-semibold text-[#0b0b10] shadow-sm shadow-[#a78bfa]/20 whitespace-nowrap shrink-0 transition-all duration-150 hover:bg-[#c4b5fd] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b10]"
          >
            <span>▶ Run the Meeting</span>
          </button>
        </header>

        {/* Inline Execution Feedback Banner */}
        {runFeedback && (
          <div className="border-b border-[#a78bfa]/25 bg-[#a78bfa]/10 px-4 py-2.5 sm:px-8">
            <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-3 text-xs">
              <span className="text-[#e9d5ff]">{runFeedback.message}</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setActiveView("workflow");
                    setRunFeedback(null);
                  }}
                  className="font-mono text-[11px] font-medium text-[#c4b5fd] underline underline-offset-4 hover:text-white"
                >
                  Inspect Run Timeline →
                </button>
                <button
                  type="button"
                  onClick={() => setRunFeedback(null)}
                  className="text-zinc-400 hover:text-zinc-200"
                  aria-label="Dismiss notification"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Active View Viewport */}
        <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 py-6 sm:px-8 sm:py-8">
          {activeView === "meetings" && selectedMeeting && (
            <div className="space-y-5">
              {/* Meeting Header */}
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
                <div className="min-w-0">
                  <h1 className="font-serif text-3xl italic tracking-tight text-zinc-50 sm:text-4xl">
                    {selectedMeeting.title}
                  </h1>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-xs text-zinc-400 tabular-nums">
                    <span>{selectedMeeting.date}</span>
                    <span aria-hidden="true">·</span>
                    <span>{selectedMeeting.duration}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-zinc-300">Speakers: {speakerNames}</span>
                  </div>
                </div>

                <p className="max-w-xl text-xs leading-relaxed text-zinc-400 lg:text-right">
                  {selectedMeeting.summary}
                </p>
              </div>

              {/* Consent Banner + Analyze / Paste / Upload Audio Strip */}
              <div className="flex flex-col justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#111118]/90 px-4 py-3 md:flex-row md:items-center">
                <label className="flex cursor-pointer items-center gap-2.5 text-xs text-zinc-200">
                  <input
                    type="checkbox"
                    checked={consentAccepted}
                    onChange={(e) => {
                      setConsentAccepted(e.target.checked);
                      if (e.target.checked) setExtractError(null);
                    }}
                    className="h-4 w-4 rounded border-white/20 bg-[#0b0b10] accent-[#a78bfa]"
                  />
                  <ShieldCheck className="h-4 w-4 shrink-0 text-[#a78bfa]" />
                  <span>Audio is processed once and not stored.</span>
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIngestModal({ open: true, mode: "paste" })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-zinc-200 whitespace-nowrap shrink-0 transition-colors hover:bg-white/[0.08]"
                  >
                    <FileText className="h-3.5 w-3.5 text-zinc-400" />
                    Paste your own transcript
                  </button>
                  <button
                    type="button"
                    onClick={() => setIngestModal({ open: true, mode: "audio" })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-zinc-200 whitespace-nowrap shrink-0 transition-colors hover:bg-white/[0.08]"
                  >
                    <FileAudio className="h-3.5 w-3.5 text-zinc-400" />
                    Upload audio
                  </button>
                  <button
                    type="button"
                    onClick={handleAnalyzeWithGemini}
                    disabled={isExtracting || !consentAccepted}
                    title={
                      !consentAccepted
                        ? "Confirm consent checkbox before analyzing"
                        : "Extract structured items with Gemini"
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#a78bfa] px-3.5 py-1.5 text-xs font-semibold text-[#0b0b10] whitespace-nowrap shrink-0 transition-colors hover:bg-[#c4b5fd] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {isExtracting ? "Analyzing..." : "Analyze"}
                  </button>
                </div>
              </div>

              {/* Waveform */}
              <Waveform
                durationSeconds={selectedMeeting.durationSeconds}
                currentSeconds={currentSeconds}
                isPlaying={isPlaying}
                onTogglePlay={() => setIsPlaying((prev) => !prev)}
                onSeek={(sec) => setCurrentSeconds(sec)}
                segments={selectedMeeting.segments}
                people={state.people}
              />

              {/* Split Transcript & Extracted Panel */}
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-12 xl:items-start">
                <div className="xl:col-span-7">
                  <Transcript
                    segments={selectedMeeting.segments}
                    people={state.people}
                    extractedItems={selectedMeeting.extractedItems}
                    currentSeconds={currentSeconds}
                    highlightedSegmentId={highlightedSegmentId}
                    highlightedQuote={highlightedQuote}
                    highlightNonce={highlightNonce}
                    onSeekToSegment={(seg: Segment) => {
                      setCurrentSeconds(seg.seconds);
                      setHighlightedSegmentId(seg.id);
                      setHighlightedQuote(null);
                      setHighlightNonce((n) => n + 1);
                    }}
                  />
                </div>

                <div className="xl:col-span-5">
                  <ExtractedPanel
                    items={selectedMeeting.extractedItems}
                    people={state.people}
                    consentAccepted={consentAccepted}
                    isExtracting={isExtracting}
                    extractError={extractError}
                    onJumpToQuote={handleJumpToQuote}
                    onResolveAmbiguity={handleResolveAmbiguity}
                    onDismissAmbiguity={handleDismissAmbiguity}
                    onAnalyzeWithGemini={handleAnalyzeWithGemini}
                  />
                </div>
              </div>
            </div>
          )}

          {activeView === "workflow" && (
            <div className="space-y-10">
              <WorkflowCanvas
                workflow={state.workflow}
                activeMeeting={selectedMeeting}
                people={state.people}
                isRunning={isRunningMeeting}
                onApproveAndRun={handleRunMeeting}
                onReplaceWorkflow={(nodes, edges) =>
                  setState((prev) => ({
                    ...prev,
                    workflow: {
                      ...prev.workflow,
                      nodes,
                      edges,
                    },
                  }))
                }
                onUpdateNodes={(nodes) =>
                  setState((prev) => ({
                    ...prev,
                    workflow: {
                      ...prev.workflow,
                      nodes,
                    },
                  }))
                }
              />

              <RunTimeline runs={state.runs} onSelectMeeting={selectMeeting} />
            </div>
          )}

          {activeView === "tickets" && (
            <TicketsBoard
              tickets={state.tickets}
              people={state.people}
              meetings={state.meetings}
              onJumpToMeetingQuote={handleJumpFromBoardOrLedger}
              onUpdateTicketStatus={(ticketId: string, status: TicketStatus) =>
                setState((prev) => ({
                  ...prev,
                  tickets: prev.tickets.map((t) =>
                    t.id === ticketId ? { ...t, status } : t
                  ),
                }))
              }
              onAssignTicket={(ticketId: string, assigneeId: string | null) =>
                setState((prev) => ({
                  ...prev,
                  tickets: prev.tickets.map((t) =>
                    t.id === ticketId
                      ? {
                          ...t,
                          assigneeId,
                          status:
                            assigneeId && t.status === "Blocked" ? "In Progress" : t.status,
                        }
                      : t
                  ),
                }))
              }
              onCreateTicket={(input: {
                title: string;
                priority: TicketPriority;
                assigneeId: string | null;
                dueDate: string;
              }) =>
                setState((prev) => ({
                  ...prev,
                  tickets: [
                    {
                      id: `tkt_${Date.now()}`,
                      key: `MM-${101 + prev.tickets.length}`,
                      title: input.title,
                      description: "Created from Tickets Board.",
                      status: "Backlog",
                      priority: input.priority,
                      assigneeId: input.assigneeId,
                      dueDate: input.dueDate,
                      meetingId: selectedMeeting?.id || "",
                      segmentId: "",
                      sourceKind: "Action",
                    },
                    ...prev.tickets,
                  ],
                }))
              }
            />
          )}

          {activeView === "promises" && (
            <PromiseLedger
              promises={state.promises}
              people={state.people}
              meetings={state.meetings}
              onJumpToMeetingQuote={handleJumpFromBoardOrLedger}
              onAssignPromiseOwner={(promiseId: string, ownerId: string) =>
                setState((prev) => ({
                  ...prev,
                  promises: prev.promises.map((p) =>
                    p.id === promiseId
                      ? {
                          ...p,
                          ownerId,
                          confidence: Math.max(p.confidence, 0.92),
                          status: p.status === "At Risk" ? "Open" : p.status,
                        }
                      : p
                  ),
                }))
              }
              onUpdatePromiseStatus={(promiseId: string, status: PromiseStatus) =>
                setState((prev) => ({
                  ...prev,
                  promises: prev.promises.map((p) =>
                    p.id === promiseId ? { ...p, status } : p
                  ),
                }))
              }
            />
          )}
        </main>
      </div>

      <NewMeetingModal
        isOpen={ingestModal.open}
        initialMode={ingestModal.mode}
        people={state.people}
        consentAccepted={consentAccepted}
        onToggleConsent={setConsentAccepted}
        onClose={() => setIngestModal((prev) => ({ ...prev, open: false }))}
        onCreateMeeting={handleCreateNewMeeting}
      />
    </div>
  );
}
