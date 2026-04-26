"use client";

import { useEffect, useRef } from "react";
import type { TranscriptMessage } from "@/lib/voice/types";
import { cn } from "@/lib/utils";

export function TranscriptPanel({ messages }: { messages: TranscriptMessage[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      className="scrollbar-thin flex-1 min-h-0 overflow-y-auto px-1 py-2 space-y-3"
      aria-label="Conversation transcript"
    >
      {messages.length === 0 && (
        <p className="text-sm text-cyan-100/40 italic px-2">
          Conversation transcript will appear here.
        </p>
      )}
      {messages.map((m) => (
        <div
          key={m.id}
          className={cn(
            "flex flex-col gap-1",
            m.role === "user" ? "items-end" : "items-start"
          )}
        >
          <span className="text-[10px] uppercase tracking-widest text-cyan-200/40">
            {m.role === "user" ? "You" : m.role === "assistant" ? "Jarvis" : "System"}
          </span>
          <div
            className={cn(
              "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
              m.role === "user"
                ? "bg-cyan-400/10 text-cyan-50 border border-cyan-400/20"
                : "bg-white/[0.03] text-cyan-100/90 border border-white/10"
            )}
          >
            {m.text}
          </div>
        </div>
      ))}
    </div>
  );
}
