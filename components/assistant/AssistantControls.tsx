"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { PersonaPicker } from "./PersonaPicker";
import type { VoiceStatus } from "@/lib/voice/types";

interface AssistantControlsProps {
  status: VoiceStatus;
  onStart: () => void;
  onStop: () => void;
  onSendText: (msg: string) => void;
  muted: boolean;
  onToggleMute: () => void;
  personaId: string;
  onChangePersona: (id: string) => void;
}

export function AssistantControls({
  status,
  onStart,
  onStop,
  onSendText,
  muted,
  onToggleMute,
  personaId,
  onChangePersona,
}: AssistantControlsProps) {
  const [text, setText] = useState("");
  const isActive = status !== "idle" && status !== "error";

  return (
    <div className="flex flex-col gap-3 w-full">
      <div className="flex items-center justify-center">
        <PersonaPicker
          personaId={personaId}
          onChange={onChangePersona}
          locked={isActive}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 justify-center">
        {!isActive ? (
          <Button onClick={onStart} aria-label="Start conversation">
            ▶ Start Conversation
          </Button>
        ) : (
          <Button variant="danger" onClick={onStop} aria-label="Stop conversation">
            ■ Stop
          </Button>
        )}

        <Button
          variant="ghost"
          onClick={onToggleMute}
          disabled={!isActive}
          aria-label={muted ? "Unmute microphone" : "Mute microphone"}
        >
          {muted ? "🔇 Muted" : "🎙 Mic on"}
        </Button>
      </div>

      <form
        className="flex gap-2 mt-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          onSendText(text.trim());
          setText("");
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message…"
          aria-label="Send a text message"
          className="flex-1 rounded-full bg-white/5 border border-white/10 px-4 py-2 text-sm text-cyan-50 placeholder:text-cyan-100/30 focus:outline-none focus:border-cyan-400/50"
        />
        <Button type="submit" variant="ghost" disabled={!text.trim() || !isActive}>
          Send
        </Button>
      </form>
    </div>
  );
}
