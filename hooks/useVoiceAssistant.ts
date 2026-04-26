"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  VoiceProvider,
  VoiceStatus,
  TranscriptMessage,
  ToolCall,
} from "@/lib/voice/types";
import {
  OpenAIRealtimeProvider,
  type SeedItem,
} from "@/lib/voice/openaiRealtimeProvider";
import { findPersona } from "@/lib/voice/personas";

export function useVoiceAssistant(
  sessionId: string | null,
  personaId: string
) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const audioLevelRef = useRef(0);
  const providerRef = useRef<VoiceProvider | null>(null);
  const sessionIdRef = useRef<string | null>(sessionId);
  const didTitleRef = useRef<Set<string>>(new Set());

  // Keep ref in sync so async event handlers always see the latest sessionId.
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // When the active session changes, hydrate transcript + tool calls
  // from the database and stop any in-flight call.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!sessionId) {
        setTranscript([]);
        setToolCalls([]);
        return;
      }
      const res = await fetch(`/api/sessions/${sessionId}`);
      if (!res.ok || cancelled) return;
      const { session } = await res.json();
      if (cancelled) return;
      setTranscript(
        session.messages.map((m: any) => ({
          id: m.id,
          role: m.role,
          text: m.text,
          timestamp: m.createdAt,
        }))
      );
      setToolCalls(
        session.toolCalls.map((c: any) => ({
          id: c.id,
          name: c.name,
          args: c.args,
          status: c.status,
          result: c.result ?? undefined,
          error: c.error ?? undefined,
          startedAt: c.startedAt,
          endedAt: c.endedAt ?? undefined,
        }))
      );
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const persistMessage = useCallback(async (m: TranscriptMessage) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    await fetch(`/api/sessions/${sid}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: m.id, role: m.role, text: m.text }),
    }).catch(() => {});
  }, []);

  const persistToolCall = useCallback(async (c: ToolCall) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    await fetch(`/api/sessions/${sid}/tool-calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: c.id,
        name: c.name,
        args: c.args,
        result: c.result,
        error: c.error,
        status: c.status,
        startedAt: c.startedAt,
        endedAt: c.endedAt,
      }),
    }).catch(() => {});
  }, []);

  // Auto-title once a session has its first user+assistant pair.
  const maybeTitle = useCallback((messages: TranscriptMessage[]) => {
    const sid = sessionIdRef.current;
    if (!sid || didTitleRef.current.has(sid)) return;
    const hasUser = messages.some((m) => m.role === "user");
    const hasAssistant = messages.some(
      (m) => m.role === "assistant" && m.text.trim().length > 10
    );
    if (hasUser && hasAssistant) {
      didTitleRef.current.add(sid);
      fetch(`/api/sessions/${sid}/title`, { method: "POST" }).catch(() => {});
    }
  }, []);

  const events = useMemo(
    () => ({
      onStatus: (s: VoiceStatus) => setStatus(s),
      onTranscript: (m: TranscriptMessage) => {
        setTranscript((prev) => {
          const idx = prev.findIndex((p) => p.id === m.id);
          let next: TranscriptMessage[];
          if (idx === -1) next = [...prev, m];
          else {
            next = prev.slice();
            next[idx] = m;
          }
          maybeTitle(next);
          return next;
        });
        persistMessage(m);
      },
      onError: (e: string) => setError(e),
      onToolCall: (call: ToolCall) => {
        setToolCalls((prev) => {
          const idx = prev.findIndex((c) => c.id === call.id);
          if (idx === -1) return [...prev, call];
          const copy = prev.slice();
          copy[idx] = call;
          return copy;
        });
        persistToolCall(call);
      },
      onAudioLevel: (l: number) => {
        audioLevelRef.current = audioLevelRef.current * 0.6 + l * 0.4;
      },
    }),
    [persistMessage, persistToolCall, maybeTitle]
  );

  const start = useCallback(async () => {
    setError(null);
    if (providerRef.current) return;
    const sid = sessionIdRef.current;
    let seedItems: SeedItem[] = [];
    if (sid) {
      const res = await fetch(`/api/sessions/${sid}/resume`);
      if (res.ok) {
        const data = await res.json();
        seedItems = data.seed || [];
      }
    }
    const persona = findPersona(personaId);
    const p = new OpenAIRealtimeProvider(events, {
      seedItems,
      voice: persona.voice,
      instructions: persona.instructions,
    });
    providerRef.current = p;
    await p.start();
  }, [events, personaId]);

  const stop = useCallback(async () => {
    await providerRef.current?.stop();
    providerRef.current = null;
  }, []);

  const sendText = useCallback(async (msg: string) => {
    if (!providerRef.current) {
      setError("Start a conversation before sending a text message.");
      return;
    }
    await providerRef.current.sendText?.(msg);
  }, []);

  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
    providerRef.current?.setMuted?.(m);
  }, []);

  const clearToolCalls = useCallback(() => setToolCalls([]), []);

  useEffect(() => {
    return () => {
      providerRef.current?.stop();
    };
  }, []);

  return {
    status,
    transcript,
    toolCalls,
    clearToolCalls,
    error,
    audioLevelRef,
    muted,
    setMuted,
    start,
    stop,
    sendText,
    isConnected: status !== "idle" && status !== "error",
  };
}
