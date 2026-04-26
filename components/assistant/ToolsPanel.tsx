"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ToolCall } from "@/lib/voice/types";
import { tools as registeredTools } from "@/lib/voice/tools";
import { cn } from "@/lib/utils";

interface ToolsPanelProps {
  calls: ToolCall[];
  onClear?: () => void;
}

export function ToolsPanel({ calls, onClear }: ToolsPanelProps) {
  const [tab, setTab] = useState<"calls" | "registry">("calls");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [calls.length]);

  const ordered = useMemo(
    () => [...calls].sort((a, b) => a.startedAt - b.startedAt),
    [calls]
  );

  return (
    <div className="flex h-full flex-col gap-3 min-h-[340px]">
      <div className="flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-[0.3em] text-cyan-100/70">Tools</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab("calls")}
            className={cn(
              "text-[10px] uppercase tracking-widest px-2 py-1 rounded-full transition",
              tab === "calls"
                ? "bg-cyan-400/15 text-cyan-100 border border-cyan-300/30"
                : "text-cyan-100/40 hover:text-cyan-100/80"
            )}
          >
            Calls · {calls.length}
          </button>
          <button
            type="button"
            onClick={() => setTab("registry")}
            className={cn(
              "text-[10px] uppercase tracking-widest px-2 py-1 rounded-full transition",
              tab === "registry"
                ? "bg-cyan-400/15 text-cyan-100 border border-cyan-300/30"
                : "text-cyan-100/40 hover:text-cyan-100/80"
            )}
          >
            Registry · {registeredTools.length}
          </button>
        </div>
      </div>

      <div className="h-px bg-cyan-400/10" />

      <div
        ref={scrollRef}
        className="scrollbar-thin flex-1 overflow-y-auto pr-1 space-y-2"
      >
        {tab === "calls" ? (
          ordered.length === 0 ? (
            <p className="text-xs italic text-cyan-100/40 px-1 pt-2">
              Tool calls will stream here as Jarvis invokes them.
            </p>
          ) : (
            ordered.map((c) => <ToolCallCard key={c.id} call={c} />)
          )
        ) : (
          <ToolRegistryList />
        )}
      </div>

      {tab === "calls" && calls.length > 0 && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="self-end text-[10px] uppercase tracking-widest text-cyan-100/40 hover:text-cyan-100/80"
        >
          Clear
        </button>
      )}
    </div>
  );
}

const STATUS_STYLES = {
  running: {
    label: "Running",
    badge: "bg-amber-300/15 text-amber-200 border-amber-300/40",
    dot: "bg-amber-300 animate-pulse",
  },
  success: {
    label: "Success",
    badge: "bg-emerald-300/15 text-emerald-200 border-emerald-300/40",
    dot: "bg-emerald-300",
  },
  error: {
    label: "Error",
    badge: "bg-red-400/15 text-red-200 border-red-400/40",
    dot: "bg-red-400",
  },
} as const;

function ToolCallCard({ call }: { call: ToolCall }) {
  const s = STATUS_STYLES[call.status];
  const elapsed = call.endedAt
    ? `${call.endedAt - call.startedAt}ms`
    : `${Math.max(0, Date.now() - call.startedAt)}ms`;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", s.dot)} />
          <code className="font-mono text-sm text-cyan-100 truncate">{call.name}</code>
        </div>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-widest",
            s.badge
          )}
        >
          {s.label}
        </span>
      </div>

      <details className="text-xs group">
        <summary className="cursor-pointer text-cyan-100/40 hover:text-cyan-100/70 list-none flex items-center gap-1">
          <span className="transition group-open:rotate-90">▸</span> args
        </summary>
        <pre className="mt-1 overflow-x-auto rounded-md bg-black/40 p-2 text-[11px] text-cyan-100/70">
{JSON.stringify(call.args ?? {}, null, 2)}
        </pre>
      </details>

      {(call.result !== undefined || call.error) && (
        <details className="text-xs group" open>
          <summary className="cursor-pointer text-cyan-100/40 hover:text-cyan-100/70 list-none flex items-center gap-1">
            <span className="transition group-open:rotate-90">▸</span>
            {call.error ? "error" : "result"}
          </summary>
          <pre
            className={cn(
              "mt-1 overflow-x-auto rounded-md p-2 text-[11px]",
              call.error
                ? "bg-red-950/40 text-red-200"
                : "bg-black/40 text-emerald-100/80"
            )}
          >
{call.error ?? JSON.stringify(call.result, null, 2)}
          </pre>
        </details>
      )}

      <div className="text-[10px] uppercase tracking-widest text-cyan-100/30">
        {elapsed}
      </div>
    </div>
  );
}

function ToolRegistryList() {
  return (
    <ul className="space-y-2">
      {registeredTools.map((t) => (
        <li
          key={t.name}
          className="rounded-xl border border-white/10 bg-white/[0.02] p-3"
        >
          <code className="font-mono text-sm text-cyan-100">{t.name}</code>
          <p className="mt-1 text-xs text-cyan-100/60 leading-relaxed">
            {t.description}
          </p>
          {t.parameters && (t.parameters as any).properties && (
            <div className="mt-2 flex flex-wrap gap-1">
              {Object.keys((t.parameters as any).properties).map((p) => (
                <span
                  key={p}
                  className="text-[10px] font-mono bg-cyan-400/10 text-cyan-100/80 border border-cyan-400/20 rounded px-1.5 py-0.5"
                >
                  {p}
                </span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
