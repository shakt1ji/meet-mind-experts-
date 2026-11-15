import { AlertTriangle, Check, Quote } from "lucide-react";
import { useState } from "react";
import type {
  Meeting,
  Person,
  Promise as PromiseRecord,
  PromiseStatus,
} from "../types/meetmind";

interface PromiseLedgerProps {
  promises: PromiseRecord[];
  people: Person[];
  meetings: Meeting[];
  onAssignPromiseOwner: (promiseId: string, ownerId: string) => void;
  onUpdatePromiseStatus: (promiseId: string, status: PromiseStatus) => void;
  onJumpToMeetingQuote: (meetingId: string, segmentId: string) => void;
}

type FilterTab = "All" | "Unowned" | "Open" | "At Risk" | "Kept";

const FILTER_TABS: FilterTab[] = ["All", "Unowned", "Open", "At Risk", "Kept"];
const STATUS_OPTIONS: PromiseStatus[] = ["Open", "At Risk", "Kept", "Overdue"];

function statusTextClass(status: PromiseStatus): string {
  switch (status) {
    case "Kept":
      return "text-emerald-300";
    case "Open":
      return "text-[#c4b5fd]";
    case "At Risk":
      return "text-amber-300";
    case "Overdue":
      return "text-rose-300";
  }
}

export function PromiseLedger({
  promises,
  people,
  meetings,
  onAssignPromiseOwner,
  onUpdatePromiseStatus,
  onJumpToMeetingQuote,
}: PromiseLedgerProps) {
  const [activeTab, setActiveTab] = useState<FilterTab>("All");

  const unownedCount = promises.filter((p) => p.ownerId === null).length;

  const filtered = promises.filter((p) => {
    if (activeTab === "All") return true;
    if (activeTab === "Unowned") return p.ownerId === null;
    return p.status === activeTab;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-serif text-3xl italic text-zinc-50">Promise Ledger</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Every spoken commitment tracked by owner, counterparty, due date, and quote anchor.
          </p>
        </div>

        <div className="flex items-center gap-4 font-mono text-xs text-zinc-400 tabular-nums">
          <span>{promises.length} total promises</span>
          <span aria-hidden="true">·</span>
          <span className={unownedCount > 0 ? "text-amber-300" : "text-emerald-300"}>
            {unownedCount} unowned
          </span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTER_TABS.map((tab) => {
          const active = activeTab === tab;
          const count =
            tab === "All"
              ? promises.length
              : tab === "Unowned"
              ? unownedCount
              : promises.filter((p) => p.status === tab).length;

          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                active
                  ? "bg-[#a78bfa] text-[#0b0b10]"
                  : "border border-white/[0.08] bg-[#111118] text-zinc-300 hover:bg-white/[0.06]"
              }`}
            >
              <span>{tab}</span>
              <span
                className={`font-mono text-[11px] tabular-nums ${
                  active ? "text-[#0b0b10]/80" : "text-zinc-500"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Ledger Table */}
      <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-[#111118]/90">
        <table className="w-full min-w-[820px] border-collapse text-left">
          <thead>
            <tr className="border-b border-white/[0.08] font-mono text-[11px] text-zinc-400">
              <th className="px-4 py-3 font-medium">Promise</th>
              <th className="px-4 py-3 font-medium">Owner</th>
              <th className="px-4 py-3 font-medium">Counterparty</th>
              <th className="px-4 py-3 font-medium">Source Meeting</th>
              <th className="px-4 py-3 font-medium">Due</th>
              <th className="px-4 py-3 font-medium text-right">Conf.</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Anchor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06] text-xs">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-zinc-500">
                  No promises match the current filter.
                </td>
              </tr>
            ) : (
              filtered.map((promise) => {
                const owner = people.find((p) => p.id === promise.ownerId);
                const meeting = meetings.find((m) => m.id === promise.meetingId);
                return (
                  <tr
                    key={promise.id}
                    className="transition-colors hover:bg-white/[0.02]"
                  >
                    <td className="px-4 py-3.5 max-w-[300px]">
                      <div className="font-medium text-zinc-100">{promise.statement}</div>
                    </td>

                    <td className="px-4 py-3.5">
                      {owner ? (
                        <div className="flex items-center gap-2">
                          <span
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-[10px] font-semibold"
                            style={{
                              backgroundColor: `${owner.accentHex}22`,
                              color: owner.accentHex,
                            }}
                          >
                            {owner.initials}
                          </span>
                          <span className="text-zinc-200">{owner.name}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                          <select
                            aria-label={`Assign owner for ${promise.statement}`}
                            value=""
                            onChange={(e) => {
                              if (e.target.value) {
                                onAssignPromiseOwner(promise.id, e.target.value);
                              }
                            }}
                            className="rounded border border-amber-400/35 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-200 focus:border-[#a78bfa] focus:outline-none"
                          >
                            <option value="">Assign owner...</option>
                            {people.map((person) => (
                              <option key={person.id} value={person.id} className="bg-[#111118]">
                                {person.name} ({person.role})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-zinc-300">{promise.counterparty}</td>

                    <td className="px-4 py-3.5 text-zinc-400">
                      {meeting ? meeting.title : "Manual"}
                    </td>

                    <td className="px-4 py-3.5 font-mono text-zinc-300 tabular-nums">
                      {promise.dueDate}
                    </td>

                    <td className="px-4 py-3.5 text-right font-mono text-zinc-400 tabular-nums">
                      {Math.round(promise.confidence <= 1 ? promise.confidence * 100 : promise.confidence)}%
                    </td>

                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        {promise.status === "Kept" && (
                          <Check className="h-3.5 w-3.5 text-emerald-300" />
                        )}
                        <select
                          aria-label={`Status for ${promise.statement}`}
                          value={promise.status}
                          onChange={(e) =>
                            onUpdatePromiseStatus(promise.id, e.target.value as PromiseStatus)
                          }
                          className={`rounded border border-white/[0.08] bg-[#0b0b10] px-2 py-1 font-mono text-[11px] focus:border-[#a78bfa] focus:outline-none ${statusTextClass(
                            promise.status
                          )}`}
                        >
                          {STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status} className="text-zinc-200">
                              {status}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>

                    <td className="px-4 py-3.5 text-right">
                      {meeting && promise.segmentId ? (
                        <button
                          type="button"
                          onClick={() =>
                            onJumpToMeetingQuote(promise.meetingId, promise.segmentId)
                          }
                          className="inline-flex items-center gap-1 font-mono text-[11px] text-[#a78bfa] hover:text-[#c4b5fd] hover:underline"
                        >
                          <Quote className="h-3 w-3" />
                          quote
                        </button>
                      ) : (
                        <span className="font-mono text-[11px] text-zinc-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
