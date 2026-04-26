"use client";

import { useState } from "react";
import type { SessionSummary } from "@/hooks/useSessions";
import type { ToolCall } from "@/lib/voice/types";
import { SessionsPanel } from "./SessionsPanel";
import { ToolsPanel } from "./ToolsPanel";
import { cn } from "@/lib/utils";

interface LeftPanelProps {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  toolCalls: ToolCall[];
  onClearToolCalls: () => void;
}

export function LeftPanel(props: LeftPanelProps) {
  const [tab, setTab] = useState<"sessions" | "tools">("sessions");

  return (
    <div className="flex h-full flex-col gap-3 min-h-[340px]">
      <div className="flex items-center gap-2">
        <TabButton active={tab === "sessions"} onClick={() => setTab("sessions")}>
          Sessions · {props.sessions.length}
        </TabButton>
        <TabButton active={tab === "tools"} onClick={() => setTab("tools")}>
          Tools · {props.toolCalls.length}
        </TabButton>
      </div>

      <div className="flex-1 min-h-0">
        {tab === "sessions" ? (
          <SessionsPanel
            sessions={props.sessions}
            activeId={props.activeSessionId}
            onSelect={props.onSelectSession}
            onNew={props.onNewSession}
            onDelete={props.onDeleteSession}
          />
        ) : (
          <ToolsPanel calls={props.toolCalls} onClear={props.onClearToolCalls} />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full transition",
        active
          ? "bg-cyan-400/15 text-cyan-100 border border-cyan-300/30"
          : "text-cyan-100/40 hover:text-cyan-100/80 border border-transparent"
      )}
    >
      {children}
    </button>
  );
}
