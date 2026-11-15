import { Plus, Quote, Search } from "lucide-react";
import { useState } from "react";
import type {
  Meeting,
  Person,
  Ticket,
  TicketPriority,
  TicketStatus,
} from "../types/meetmind";
import { computeTicketSla } from "../utils/metrics";

interface TicketsBoardProps {
  tickets: Ticket[];
  people: Person[];
  meetings: Meeting[];
  externalQuery?: string;
  onUpdateTicketStatus: (ticketId: string, status: TicketStatus) => void;
  onAssignTicket: (ticketId: string, assigneeId: string | null) => void;
  onCreateTicket: (input: {
    title: string;
    priority: TicketPriority;
    assigneeId: string | null;
    dueDate: string;
  }) => void;
  onJumpToMeetingQuote: (meetingId: string, segmentId: string) => void;
}

const COLUMNS: TicketStatus[] = ["Backlog", "In Progress", "Blocked", "Done"];

function priorityTextClass(priority: TicketPriority): string {
  switch (priority) {
    case "High":
      return "text-rose-300";
    case "Medium":
      return "text-amber-300";
    case "Low":
      return "text-slate-400";
    default:
      return "text-slate-400";
  }
}

export function TicketsBoard({
  tickets,
  people,
  meetings,
  externalQuery = "",
  onUpdateTicketStatus,
  onAssignTicket,
  onCreateTicket,
  onJumpToMeetingQuote,
}: TicketsBoardProps) {
  const [query, setQuery] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<TicketPriority>("Medium");
  const [newAssigneeId, setNewAssigneeId] = useState<string>("");
  const [newDueDate, setNewDueDate] = useState("Fri 20 Nov");

  const combinedQuery = (query || externalQuery).trim().toLowerCase();

  const filtered = tickets.filter((t) => {
    const matchesQuery =
      !combinedQuery ||
      t.title.toLowerCase().includes(combinedQuery) ||
      t.key.toLowerCase().includes(combinedQuery);
    const matchesAssignee =
      assigneeFilter === "all"
        ? true
        : assigneeFilter === "unassigned"
        ? t.assigneeId === null
        : t.assigneeId === assigneeFilter;
    return matchesQuery && matchesAssignee;
  });

  const handleSubmitNew = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    onCreateTicket({
      title: newTitle.trim(),
      priority: newPriority,
      assigneeId: newAssigneeId || null,
      dueDate: newDueDate.trim() || "TBD",
    });
    setNewTitle("");
    setShowNewForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-serif text-3xl italic text-slate-50">Tickets Board</h1>
          <p className="mt-1 text-sm text-slate-300/80">
            Complaints, actions, and commits with Complaint SLA tiers and transcript quote anchors.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowNewForm((prev) => !prev)}
          className="btn-glazed-soft inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-all"
        >
          <Plus className="h-3.5 w-3.5" />
          New Ticket
        </button>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by key or title..."
            className="glass-inset w-full rounded-xl py-2 pl-9 pr-3 text-xs text-slate-100 placeholder:text-slate-400 focus:border-[#5eead4] focus:outline-none"
          />
        </div>

        <select
          aria-label="Filter by assignee"
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="glass-inset rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-[#5eead4] focus:outline-none"
        >
          <option value="all" className="bg-[#0b1b22]">All assignees</option>
          <option value="unassigned" className="bg-[#0b1b22]">Unassigned</option>
          {people.map((p) => (
            <option key={p.id} value={p.id} className="bg-[#0b1b22]">
              {p.name} ({p.role})
            </option>
          ))}
        </select>

        {(query.trim() || assigneeFilter !== "all") && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setAssigneeFilter("all");
            }}
            className="rounded-xl border border-white/[0.12] bg-white/[0.05] px-3 py-2 text-xs text-slate-200 hover:bg-white/[0.1]"
          >
            Clear filters
          </button>
        )}
      </div>

      {showNewForm && (
        <form
          onSubmit={handleSubmitNew}
          className="glass-card-elevated grid grid-cols-1 gap-3 rounded-2xl p-4 sm:grid-cols-12"
        >
          <input
            type="text"
            required
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Ticket title..."
            className="glass-inset sm:col-span-5 rounded-xl px-3 py-2 text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
          />
          <select
            value={newPriority}
            onChange={(e) => setNewPriority(e.target.value as TicketPriority)}
            className="glass-inset sm:col-span-2 rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-[#5eead4] focus:outline-none"
          >
            <option value="High" className="bg-[#0b1b22]">High</option>
            <option value="Medium" className="bg-[#0b1b22]">Medium</option>
            <option value="Low" className="bg-[#0b1b22]">Low</option>
          </select>
          <select
            value={newAssigneeId}
            onChange={(e) => setNewAssigneeId(e.target.value)}
            className="glass-inset sm:col-span-2 rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-[#5eead4] focus:outline-none"
          >
            <option value="" className="bg-[#0b1b22]">Unassigned</option>
            {people.map((p) => (
              <option key={p.id} value={p.id} className="bg-[#0b1b22]">
                {p.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={newDueDate}
            onChange={(e) => setNewDueDate(e.target.value)}
            placeholder="Due date"
            className="glass-inset sm:col-span-2 rounded-xl px-3 py-2 font-mono text-xs text-slate-200 focus:border-[#5eead4] focus:outline-none"
          />
          <button
            type="submit"
            className="btn-glazed-primary sm:col-span-1 rounded-xl px-3 py-2 text-xs font-semibold"
          >
            Add
          </button>
        </form>
      )}

      {/* 4-column board */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((status) => {
          const colTickets = filtered.filter((t) => t.status === status);
          return (
            <div
              key={status}
              className="glass-card flex flex-col overflow-hidden rounded-2xl"
            >
              <div className="flex items-center justify-between border-b border-white/[0.09] px-4 py-3.5">
                <h2 className="text-xs font-semibold tracking-tight text-slate-100">{status}</h2>
                <span className="font-mono text-xs text-slate-400 tabular-nums">
                  {colTickets.length}
                </span>
              </div>

              <div className="flex-1 divide-y divide-white/[0.07]">
                {colTickets.length === 0 ? (
                  <div className="px-4 py-9 text-center text-xs text-slate-500">
                    No tickets in {status}
                  </div>
                ) : (
                  colTickets.map((ticket) => {
                    const meeting = meetings.find((m) => m.id === ticket.meetingId);
                    const sla = computeTicketSla(ticket);

                    return (
                      <div key={ticket.id} className="space-y-2.5 p-4 transition-colors hover:bg-white/[0.03]">
                        <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                          <span className="text-slate-400 tabular-nums">{ticket.key}</span>
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${
                                sla.breached
                                  ? "border-rose-400/50 bg-rose-500/18 text-rose-100"
                                  : sla.isComplaint
                                  ? "border-amber-300/40 bg-amber-400/12 text-amber-100"
                                  : "border-white/[0.12] bg-white/[0.05] text-slate-200"
                              }`}
                            >
                              {sla.isComplaint ? `Complaint SLA ${sla.tier}` : `SLA ${sla.tier}`}
                              {sla.breached ? ` · breached (${sla.daysOverdue}d)` : ""}
                            </span>
                            <span className={priorityTextClass(ticket.priority)}>
                              {ticket.priority}
                            </span>
                          </div>
                        </div>

                        <p className="text-[13px] font-medium leading-snug text-slate-100">
                          {ticket.title}
                        </p>

                        <div className="flex items-center justify-between gap-2 pt-1">
                          <select
                            aria-label={`Assign ${ticket.key}`}
                            value={ticket.assigneeId || ""}
                            onChange={(e) =>
                              onAssignTicket(ticket.id, e.target.value || null)
                            }
                            className="glass-inset max-w-[130px] rounded-lg px-2 py-1 text-[11px] text-slate-200 focus:border-[#5eead4] focus:outline-none"
                          >
                            <option value="" className="bg-[#0b1b22]">Unassigned</option>
                            {people.map((p) => (
                              <option key={p.id} value={p.id} className="bg-[#0b1b22]">
                                {p.name}
                              </option>
                            ))}
                          </select>

                          <select
                            aria-label={`Status for ${ticket.key}`}
                            value={ticket.status}
                            onChange={(e) =>
                              onUpdateTicketStatus(ticket.id, e.target.value as TicketStatus)
                            }
                            className="glass-inset rounded-lg px-2 py-1 font-mono text-[11px] text-slate-200 focus:border-[#5eead4] focus:outline-none"
                          >
                            {COLUMNS.map((col) => (
                              <option key={col} value={col} className="bg-[#0b1b22]">
                                {col}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                          <span
                            className={`tabular-nums ${
                              sla.breached ? "font-medium text-rose-300" : "text-slate-400"
                            }`}
                          >
                            Due {ticket.dueDate}
                          </span>
                          {meeting && (
                            <button
                              type="button"
                              onClick={() =>
                                onJumpToMeetingQuote(
                                  ticket.meetingId,
                                  ticket.segmentId || meeting.segments[0]?.id || ""
                                )
                              }
                              className="inline-flex max-w-[180px] items-center gap-1 truncate text-[#5eead4] hover:text-[#99f6e4] hover:underline"
                              title={`Jump to ${meeting.title}`}
                            >
                              <Quote className="h-3 w-3 shrink-0" />
                              <span className="truncate">from {meeting.title}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
