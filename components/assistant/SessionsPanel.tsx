"use client";

import type { SessionSummary } from "@/hooks/useSessions";
import { cn } from "@/lib/utils";

interface SessionsPanelProps {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function SessionsPanel({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: SessionsPanelProps) {
  return (
    <div className="flex h-full flex-col gap-3 min-h-[340px]">
      <div className="flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-[0.3em] text-cyan-100/70">Sessions</h2>
        <button
          type="button"
          onClick={onNew}
          className="text-[10px] uppercase tracking-widest px-2 py-1 rounded-full bg-cyan-400/15 text-cyan-100 border border-cyan-300/30 hover:bg-cyan-400/25 transition"
        >
          + New
        </button>
      </div>

      <div className="h-px bg-cyan-400/10" />

      <div className="scrollbar-thin flex-1 overflow-y-auto pr-1 space-y-1.5">
        {sessions.length === 0 ? (
          <p className="text-xs italic text-cyan-100/40 px-1 pt-2">
            No sessions yet. Start a new one to begin.
          </p>
        ) : (
          sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              active={s.id === activeId}
              onSelect={() => onSelect(s.id)}
              onDelete={() => onDelete(s.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SessionRow({
  session,
  active,
  onSelect,
  onDelete,
}: {
  session: SessionSummary;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const title = session.title || "Untitled session";
  const when = relativeTime(session.updatedAt);

  return (
    <div
      className={cn(
        "group rounded-xl border px-3 py-2.5 cursor-pointer transition",
        active
          ? "bg-cyan-400/10 border-cyan-300/40"
          : "bg-white/[0.02] border-white/10 hover:border-cyan-300/20 hover:bg-white/[0.04]"
      )}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "text-sm truncate",
              active ? "text-cyan-50" : "text-cyan-100/80"
            )}
          >
            {title}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-widest text-cyan-100/40">
            <span>{session.messageCount} msg</span>
            <span>·</span>
            <span>{when}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete "${title}"?`)) onDelete();
          }}
          className="opacity-0 group-hover:opacity-100 text-[10px] uppercase tracking-widest text-red-300/60 hover:text-red-300 transition"
          aria-label="Delete session"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function relativeTime(ts: number) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
