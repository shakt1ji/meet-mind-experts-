import { AlertTriangle, Check, Quote, Users } from "lucide-react";
import { useState } from "react";
import type {
  Meeting,
  Person,
  Promise as PromiseRecord,
  PromiseStatus,
} from "../types/meetmind";
import { computePromiseMeta, type ComputedPromiseStatus } from "../utils/metrics";
import { PreMeetingBriefCard } from "./PreMeetingBriefCard";

interface PromiseLedgerProps {
  promises: PromiseRecord[];
  people: Person[];
  meetings: Meeting[];
  nextMeetingTitle: string;
  briefLines: string[];
  briefGeneratedAt: string | null;
  isLoadingBrief: boolean;
  briefError: string | null;
  mockMode: boolean;
  externalQuery?: string;
  onRefreshBrief: () => void;
  onAssignPromiseOwner: (promiseId: string, ownerId: string) => void;
  onUpdatePromiseStatus: (promiseId: string, status: PromiseStatus) => void;
  onJumpToMeetingQuote: (meetingId: string, segmentId: string) => void;
}

type FilterTab = "All" | "Overdue" | "Open" | "Done" | "Unowned";

const FILTER_TABS: FilterTab[] = ["All", "Overdue", "Open", "Done", "Unowned"];
const STATUS_OPTIONS: Array<{ value: PromiseStatus; label: string }> = [
  { value: "Open", label: "Open" },
  { value: "Kept", label: "Done" },
  { value: "Overdue", label: "Overdue" },
];

function statusTextClass(computed: ComputedPromiseStatus): string {
  switch (computed) {
    case "done":
      return "text-emerald-300";
    case "open":
      return "text-[#5eead4]";
    case "overdue":
      return "text-rose-300";
    default:
      return "text-slate-300";
  }
}

export function PromiseLedger({
  promises,
  people,
  meetings,
  nextMeetingTitle,
  briefLines,
  briefGeneratedAt,
  isLoadingBrief,
  briefError,
  mockMode,
  externalQuery = "",
  onRefreshBrief,
  onAssignPromiseOwner,
  onUpdatePromiseStatus,
  onJumpToMeetingQuote,
}: PromiseLedgerProps) {
  const [activeTab, setActiveTab] = useState<FilterTab>("All");
  const [groupByPerson, setGroupByPerson] = useState(true);
  const trimmedQuery = externalQuery.trim().toLowerCase();

  const enriched = promises.map((promise) => ({
    promise,
    meta: computePromiseMeta(promise, meetings),
    owner: people.find((p) => p.id === promise.ownerId) || null,
  }));

  const overdueTotal = enriched.filter(
    (item) => item.meta.computedStatus === "overdue"
  ).length;
  const openTotal = enriched.filter(
    (item) => item.meta.computedStatus === "open"
  ).length;
  const doneTotal = enriched.filter(
    (item) => item.meta.computedStatus === "done"
  ).length;
  const unownedTotal = enriched.filter((item) => !item.owner).length;

  const filtered = enriched.filter((item) => {
    const matchesTab =
      activeTab === "All"
        ? true
        : activeTab === "Unowned"
        ? !item.owner
        : activeTab === "Overdue"
        ? item.meta.computedStatus === "overdue"
        : activeTab === "Open"
        ? item.meta.computedStatus === "open"
        : item.meta.computedStatus === "done";

    if (!matchesTab) return false;
    if (!trimmedQuery) return true;

    return (
      item.promise.statement.toLowerCase().includes(trimmedQuery) ||
      item.meta.quote.toLowerCase().includes(trimmedQuery) ||
      item.meta.sourceMeetingTitle.toLowerCase().includes(trimmedQuery) ||
      (item.owner?.name.toLowerCase().includes(trimmedQuery) ?? false)
    );
  });

  // Group filtered promises by person (+ Unowned bucket)
  const personGroups = (() => {
    const groups: Array<{
      id: string;
      name: string;
      role: string;
      initials: string;
      accentHex: string;
      isUnowned: boolean;
      items: typeof filtered;
      overdueCount: number;
      openCount: number;
      doneCount: number;
    }> = [];

    for (const person of people) {
      const items = filtered.filter((e) => e.owner?.id === person.id);
      if (items.length === 0) continue;
      groups.push({
        id: person.id,
        name: person.name,
        role: person.role,
        initials: person.initials,
        accentHex: person.accentHex,
        isUnowned: false,
        items,
        overdueCount: items.filter((i) => i.meta.computedStatus === "overdue").length,
        openCount: items.filter((i) => i.meta.computedStatus === "open").length,
        doneCount: items.filter((i) => i.meta.computedStatus === "done").length,
      });
    }

    const unownedItems = filtered.filter((e) => !e.owner);
    if (unownedItems.length > 0) {
      groups.unshift({
        id: "unowned",
        name: "Unowned Commitments",
        role: "Needs owner",
        initials: "??",
        accentHex: "#fbbf24",
        isUnowned: true,
        items: unownedItems,
        overdueCount: unownedItems.filter((i) => i.meta.computedStatus === "overdue").length,
        openCount: unownedItems.filter((i) => i.meta.computedStatus === "open").length,
        doneCount: unownedItems.filter((i) => i.meta.computedStatus === "done").length,
      });
    }

    return groups.sort((a, b) => b.overdueCount - a.overdueCount);
  })();

  const renderPromiseRow = (entry: (typeof enriched)[number], showOwnerCol: boolean) => {
    const { promise, meta, owner } = entry;
    const selectValue: PromiseStatus =
      meta.computedStatus === "done"
        ? "Kept"
        : meta.computedStatus === "overdue"
        ? "Overdue"
        : "Open";

    return (
      <div
        key={promise.id}
        className="flex flex-col justify-between gap-3 px-5 py-4 transition-colors hover:bg-white/[0.035] lg:flex-row lg:items-center"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-slate-100">
              {promise.statement}
            </span>
            {meta.computedStatus === "overdue" && (
              <span className="rounded-md border border-rose-400/45 bg-rose-500/18 px-1.5 py-0.5 font-mono text-[10px] font-medium text-rose-100 tabular-nums">
                {meta.daysOverdue}d overdue
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-400">
            <span className="italic text-slate-300/80">“{meta.quote}”</span>
            <span aria-hidden="true" className="text-slate-500">
              ·
            </span>
            <button
              type="button"
              onClick={() => onJumpToMeetingQuote(promise.meetingId, promise.segmentId)}
              className="font-mono text-[11px] text-[#5eead4] hover:text-[#99f6e4] hover:underline"
            >
              from {meta.sourceMeetingTitle}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {showOwnerCol && (
            <div>
              {owner ? (
                <span className="font-mono text-xs text-slate-200">{owner.name}</span>
              ) : (
                <select
                  aria-label={`Assign owner for ${promise.statement}`}
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      onAssignPromiseOwner(promise.id, e.target.value);
                    }
                  }}
                  className="rounded-lg border border-amber-300/40 bg-amber-400/12 px-2 py-1 text-[11px] text-amber-100 focus:border-[#5eead4] focus:outline-none"
                >
                  <option value="" className="bg-[#0b1b22]">Assign owner...</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id} className="bg-[#0b1b22]">
                      {person.name} ({person.role})
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {!showOwnerCol && !owner && (
            <select
              aria-label={`Assign owner for ${promise.statement}`}
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  onAssignPromiseOwner(promise.id, e.target.value);
                }
              }}
              className="rounded-lg border border-amber-300/40 bg-amber-400/12 px-2 py-1 text-[11px] text-amber-100 focus:border-[#5eead4] focus:outline-none"
            >
              <option value="" className="bg-[#0b1b22]">Assign owner...</option>
              {people.map((person) => (
                <option key={person.id} value={person.id} className="bg-[#0b1b22]">
                  {person.name} ({person.role})
                </option>
              ))}
            </select>
          )}

          <span
            className={`font-mono text-[11px] tabular-nums ${
              meta.computedStatus === "overdue" ? "text-rose-300" : "text-slate-400"
            }`}
          >
            Due {promise.dueDate}
          </span>

          <div className="flex items-center gap-1.5">
            {meta.computedStatus === "done" && (
              <Check className="h-3.5 w-3.5 text-emerald-300" />
            )}
            <select
              aria-label={`Status for ${promise.statement}`}
              value={selectValue}
              onChange={(e) =>
                onUpdatePromiseStatus(promise.id, e.target.value as PromiseStatus)
              }
              className={`glass-inset rounded-lg px-2 py-1 font-mono text-[11px] focus:border-[#5eead4] focus:outline-none ${statusTextClass(
                meta.computedStatus
              )}`}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-[#0b1b22] text-slate-200">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {promise.meetingId && (
            <button
              type="button"
              onClick={() => onJumpToMeetingQuote(promise.meetingId, promise.segmentId)}
              className="inline-flex items-center gap-1 font-mono text-[11px] text-[#5eead4] hover:text-[#99f6e4] hover:underline"
            >
              <Quote className="h-3 w-3" />
              quote
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-serif text-3xl italic text-slate-50">Promise Ledger</h1>
          <p className="mt-1 text-sm text-slate-300/80">
            Every commit and action extracted across meetings, grouped by person with live overdue tracking.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-slate-300 tabular-nums">
          <span>{promises.length} total</span>
          <span aria-hidden="true">·</span>
          <span className={overdueTotal > 0 ? "text-rose-300" : "text-emerald-300"}>
            {overdueTotal} overdue
          </span>
          <span aria-hidden="true">·</span>
          <span className="text-[#5eead4]">{openTotal} open</span>
          <span aria-hidden="true">·</span>
          <span className="text-emerald-300">{doneTotal} done</span>
        </div>
      </div>

      {/* Gemini Pre-Meeting Brief */}
      <PreMeetingBriefCard
        nextMeetingTitle={nextMeetingTitle}
        lines={briefLines}
        generatedAt={briefGeneratedAt}
        isLoading={isLoadingBrief}
        error={briefError}
        mockMode={mockMode}
        onRefresh={onRefreshBrief}
      />

      {/* Filter Tabs + Group Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTER_TABS.map((tab) => {
            const active = activeTab === tab;
            const count =
              tab === "All"
                ? promises.length
                : tab === "Overdue"
                ? overdueTotal
                : tab === "Open"
                ? openTotal
                : tab === "Done"
                ? doneTotal
                : unownedTotal;

            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-all ${
                  active
                    ? "btn-glazed-primary"
                    : "border border-white/[0.1] bg-white/[0.04] text-slate-200 hover:bg-white/[0.09]"
                }`}
              >
                <span>{tab}</span>
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    active ? "text-[#052024]/80" : "text-slate-400"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setGroupByPerson((prev) => !prev)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.12] bg-white/[0.05] px-3.5 py-1.5 text-xs font-medium text-slate-100 whitespace-nowrap shrink-0 transition-colors hover:border-[#5eead4]/45 hover:bg-white/[0.09]"
        >
          <Users className="h-3.5 w-3.5 text-[#5eead4]" />
          {groupByPerson ? "Grouped by person" : "Flat list"}
        </button>
      </div>

      {/* Empty State */}
      {filtered.length === 0 ? (
        <div className="glass-card rounded-2xl px-6 py-12 text-center">
          <p className="text-sm text-slate-200">
            No promises match the <span className="font-mono text-[#5eead4]">{activeTab}</span>{" "}
            filter.
          </p>
          <button
            type="button"
            onClick={() => setActiveTab("All")}
            className="mt-3 rounded-xl border border-white/[0.12] bg-white/[0.06] px-3.5 py-1.5 text-xs font-medium text-slate-100 hover:bg-white/[0.12]"
          >
            Show all promises
          </button>
        </div>
      ) : groupByPerson ? (
        /* Grouped by Person Cards */
        <div className="space-y-4">
          {personGroups.map((group) => (
            <section
              key={group.id}
              className="glass-card overflow-hidden rounded-2xl"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.09] bg-white/[0.03] px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.12] font-mono text-[11px] font-semibold"
                    style={{
                      backgroundColor: `${group.accentHex}24`,
                      color: group.accentHex,
                    }}
                  >
                    {group.isUnowned ? (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    ) : (
                      group.initials
                    )}
                  </span>
                  <div>
                    <span className="text-sm font-semibold text-slate-100">
                      {group.name}
                    </span>
                    <span className="ml-2 font-mono text-[11px] text-slate-400">
                      {group.role}
                    </span>
                  </div>
                </div>

                {/* Person Count Badge */}
                <div className="flex items-center gap-2 font-mono text-xs tabular-nums">
                  {group.overdueCount > 0 && (
                    <span className="rounded-lg border border-rose-400/45 bg-rose-500/18 px-2 py-0.5 text-[11px] font-medium text-rose-100">
                      {group.name.split(" ")[0]}: {group.overdueCount} overdue
                    </span>
                  )}
                  <span className="text-[11px] text-slate-300/80">
                    {group.openCount} open · {group.doneCount} done
                  </span>
                </div>
              </div>

              <div className="divide-y divide-white/[0.07]">
                {group.items.map((item) => renderPromiseRow(item, false))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        /* Flat List View */
        <div className="glass-card divide-y divide-white/[0.07] overflow-hidden rounded-2xl">
          {filtered.map((item) => renderPromiseRow(item, true))}
        </div>
      )}
    </div>
  );
}
