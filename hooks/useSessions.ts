"use client";

import { useCallback, useEffect, useState } from "react";

export interface SessionSummary {
  id: string;
  title: string | null;
  personaId: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export function useSessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/sessions");
    if (!res.ok) return;
    const data = await res.json();
    setSessions(data.sessions);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createNew = useCallback(
    async (personaId?: string): Promise<string> => {
      setLoading(true);
      try {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ personaId }),
        });
        const data = await res.json();
        const id = data.session.id as string;
        await refresh();
        setActiveId(id);
        return id;
      } finally {
        setLoading(false);
      }
    },
    [refresh]
  );

  const select = useCallback((id: string | null) => setActiveId(id), []);

  const remove = useCallback(
    async (id: string) => {
      await fetch(`/api/sessions/${id}`, { method: "DELETE" });
      if (activeId === id) setActiveId(null);
      await refresh();
    },
    [activeId, refresh]
  );

  const titleSession = useCallback(
    async (id: string) => {
      await fetch(`/api/sessions/${id}/title`, { method: "POST" }).catch(() => {});
      await refresh();
    },
    [refresh]
  );

  const setPersona = useCallback(
    async (id: string, personaId: string) => {
      await fetch(`/api/sessions/${id}/persona`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaId }),
      });
      await refresh();
    },
    [refresh]
  );

  return {
    sessions,
    activeId,
    loading,
    createNew,
    select,
    remove,
    refresh,
    titleSession,
    setPersona,
  };
}
