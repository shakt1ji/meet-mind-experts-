import { Plus, Quote, Search } from "lucide-react";
import { useState } from "react";
import type {
  Meeting,
  Person,
  Ticket,
  TicketPriority,
  TicketStatus,
} from "../types/meetmind";

interface TicketsBoardProps {
  tickets: Ticket[];
  people: Person[];
  meetings: Meeting[];
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
      return "text-zinc-400";
  }
}

export function TicketsBoard({
  tickets,
  people,
  meetings,
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
  const [newDueDate, setNewDueDate] = useState("Fri, 20 Nov");

  const filtered = tickets.filter((t) => {
    const matchesQuery =
      !query.trim() ||
      t.title.toLowerCase().includes(query.toLowerCase()) ||
      t.key.toLowerCase().includes(query.toLowerCase());
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
          <h1 className="font-serif text-3xl italic text-zinc-50">Tickets Board</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Complaints, actions, and commits traced directly to their meeting quotes.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowNewForm((prev) => !prev)}
          className="inline-flex items-center gap-2 rounded-lg border border-[#a78bfa]/35 bg-[#a78bfa]/15 px-3.5 py-2 text-xs font-medium text-[#e9d5ff] whitespace-nowrap shrink-0 transition-colors hover:bg-[#a78bfa] hover:text-[#0b0b10]"
        >
          <Plus className="h-3.5 w-3.5" />
          New Ticket
        </button>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by key or title..."
            className="w-full rounded-lg border border-white/[0.08] bg-[#111118] py-2 pl-9 pr-3 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-[#a78bfa] focus:outline-none"
          />
        </div>

        <select
          aria-label="Filter by assignee"
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="rounded-lg border border-white/[0.08] bg-[#111118] px-3 py-2 text-xs text-zinc-200 focus:border-[#a78bfa] focus:outline-none"
        >
          <option value="all">All assignees</option>
          <option value="unassigned">Unassigned</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.role})
            </option>
          ))}
        </select>
      </div>

      {showNewForm && (
        <form
          onSubmit={handleSubmitNew}
          className="grid grid-cols-1 gap-3 rounded-xl border border-[#a78bfa]/30 bg-[#111118] p-4 sm:grid-cols-12"
        >
          <input
            type="text"
            required
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Ticket title..."
            className="sm:col-span-5 rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3 py-2 text-xs text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
          />
          <select
            value={newPriority}
            onChange={(e) => setNewPriority(e.target.value as TicketPriority)}
            className="sm:col-span-2 rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3 py-2 text-xs text-zinc-200 focus:border-[#a78bfa] focus:outline-none"
          >
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
          <select
            value={newAssigneeId}
            onChange={(e) => setNewAssigneeId(e.target.value)}
            className="sm:col-span-2 rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3 py-2 text-xs text-zinc-200 focus:border-[#a78bfa] focus:outline-none"
          >
            <option value="">Unassigned</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={newDueDate}
            onChange={(e) => setNewDueDate(e.target.value)}
            placeholder="Due date"
            className="sm:col-span-2 rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3 py-2 font-mono text-xs text-zinc-200 focus:border-[#a78bfa] focus:outline-none"
          />
          <button
            type="submit"
            className="sm:col-span-1 rounded-lg bg-[#a78bfa] px-3 py-2 text-xs font-semibold text-[#0b0b10] hover:bg-[#c4b5fd]"
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
              className="flex flex-col rounded-xl border border-white/[0.08] bg-[#111118]/75"
            >
              <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
                <h2 className="text-xs font-semibold text-zinc-200">{status}</h2>
                <span className="font-mono text-xs text-zinc-500 tabular-nums">
                  {colTickets.length}
                </span>
              </div>

              <div className="flex-1 divide-y divide-white/[0.06]">
                {colTickets.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-zinc-600">
                    No tickets in {status}
                  </div>
                ) : (
                  colTickets.map((ticket) => {
                    const meeting = meetings.find((m) => m.id === ticket.meetingId);
                    return (
                      <div key={ticket.id} className="p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                          <span className="text-zinc-400 tabular-nums">{ticket.key}</span>
                          <span className={priorityTextClass(ticket.priority)}>
                            {ticket.priority}
                          </span>
                        </div>

                        <p className="text-[13px] font-medium leading-snug text-zinc-100">
                          {ticket.title}
                        </p>

                        <div className="flex items-center justify-between gap-2 pt-1">
                          <select
                            aria-label={`Assign ${ticket.key}`}
                            value={ticket.assigneeId || ""}
                            onChange={(e) =>
                              onAssignTicket(ticket.id, e.target.value || null)
                            }
                            className="max-w-[130px] rounded border border-white/[0.08] bg-[#0b0b10] px-2 py-1 text-[11px] text-zinc-300 focus:border-[#a78bfa] focus:outline-none"
                          >
                            <option value="">Unassigned</option>
                            {people.map((p) => (
                              <option key={p.id} value={p.id}>
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
                            className="rounded border border-white/[0.08] bg-[#0b0b10] px-2 py-1 font-mono text-[11px] text-zinc-300 focus:border-[#a78bfa] focus:outline-none"
                          >
                            {COLUMNS.map((col) => (
                              <option key={col} value={col}>
                                {col}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex items-center justify-between font-mono text-[11px] text-zinc-500">
                          <span className="tabular-nums">Due {ticket.dueDate}</span>
                          {meeting && ticket.segmentId && (
                            <button
                              type="button"
                              onClick={() =>
                                onJumpToMeetingQuote(ticket.meetingId, ticket.segmentId)
                              }
                              className="inline-flex items-center gap-1 text-[#a78bfa] hover:text-[#c4b5fd] hover:underline"
                            >
                              <Quote className="h-3 w-3" />
                              quote
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
