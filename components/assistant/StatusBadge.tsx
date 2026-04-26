import type { VoiceStatus } from "@/lib/voice/types";
import { cn } from "@/lib/utils";

const LABELS: Record<VoiceStatus, string> = {
  idle: "Ready",
  connecting: "Connecting…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  error: "Error",
};

const COLORS: Record<VoiceStatus, string> = {
  idle: "bg-cyan-400/10 text-cyan-200 border-cyan-400/30",
  connecting: "bg-purple-400/10 text-purple-200 border-purple-400/30",
  listening: "bg-cyan-300/15 text-cyan-100 border-cyan-300/40",
  thinking: "bg-indigo-400/15 text-indigo-200 border-indigo-400/40",
  speaking: "bg-emerald-300/15 text-emerald-100 border-emerald-300/40",
  error: "bg-red-500/15 text-red-200 border-red-400/40",
};

export function StatusBadge({ status }: { status: VoiceStatus }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs uppercase tracking-[0.2em]",
        COLORS[status]
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "idle" ? "bg-cyan-300" : "bg-current animate-pulse"
        )}
      />
      {LABELS[status]}
    </div>
  );
}
