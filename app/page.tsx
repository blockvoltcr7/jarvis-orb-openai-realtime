"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useVoiceAssistant } from "@/hooks/useVoiceAssistant";
import { useSessions } from "@/hooks/useSessions";
import { StatusBadge } from "@/components/assistant/StatusBadge";
import { AssistantControls } from "@/components/assistant/AssistantControls";
import { TranscriptPanel } from "@/components/assistant/TranscriptPanel";
import { LeftPanel } from "@/components/assistant/LeftPanel";
import { Card } from "@/components/ui/Card";
import { DEFAULT_PERSONA_ID, findPersona } from "@/lib/voice/personas";

// R3F + browser-only — disable SSR
const OrbScene = dynamic(
  () => import("@/components/orb/OrbScene").then((m) => m.OrbScene),
  { ssr: false }
);
const ParticleOrbScene = dynamic(
  () =>
    import("@/components/orb/ParticleOrbScene").then((m) => m.ParticleOrbScene),
  { ssr: false }
);
const ParticleFaceScene = dynamic(
  () =>
    import("@/components/orb/ParticleFaceScene").then((m) => m.ParticleFaceScene),
  { ssr: false }
);

type OrbVariant = "classic" | "particle" | "face";
const ORB_VARIANTS: OrbVariant[] = ["classic", "particle", "face"];
const VARIANT_LABEL: Record<OrbVariant, string> = {
  classic: "Classic",
  particle: "Particle",
  face: "Face",
};

export default function Page() {
  const {
    sessions,
    activeId,
    select,
    createNew,
    remove,
    refresh,
    setPersona,
  } = useSessions();

  // Last-used persona persists in localStorage so "+ New" feels consistent.
  const [defaultPersonaId, setDefaultPersonaId] = useState<string>(
    DEFAULT_PERSONA_ID
  );
  useEffect(() => {
    const saved = localStorage.getItem("jarvis.defaultPersona");
    if (saved) setDefaultPersonaId(saved);
  }, []);

  // Orb scene variant — persisted so refresh keeps your choice.
  const [orbVariant, setOrbVariant] = useState<OrbVariant>("classic");
  useEffect(() => {
    const saved = localStorage.getItem("jarvis.orbVariant") as OrbVariant | null;
    if (saved && ORB_VARIANTS.includes(saved)) setOrbVariant(saved);
  }, []);
  const toggleOrbVariant = () => {
    const idx = ORB_VARIANTS.indexOf(orbVariant);
    const next = ORB_VARIANTS[(idx + 1) % ORB_VARIANTS.length];
    setOrbVariant(next);
    localStorage.setItem("jarvis.orbVariant", next);
  };

  // Active persona = active session's persona (if a session is selected),
  // else the default. This is the source of truth for voice + orb color.
  const activeSession = sessions.find((s) => s.id === activeId);
  const activePersonaId =
    activeSession?.personaId || defaultPersonaId || DEFAULT_PERSONA_ID;
  const activePersona = useMemo(
    () => findPersona(activePersonaId),
    [activePersonaId]
  );

  const {
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
  } = useVoiceAssistant(activeId, activePersonaId);

  useEffect(() => {
    if (!activeId) return;
    refresh();
  }, [transcript.length, activeId, refresh]);

  const handleStart = async () => {
    let id = activeId;
    if (!id) id = await createNew(defaultPersonaId);
    await start();
  };

  const handleNew = async () => {
    await stop();
    await createNew(defaultPersonaId);
  };

  const handleSelect = async (id: string) => {
    if (id === activeId) return;
    await stop();
    select(id);
  };

  const handleDelete = async (id: string) => {
    if (id === activeId) await stop();
    await remove(id);
  };

  const handleChangePersona = async (personaId: string) => {
    setDefaultPersonaId(personaId);
    localStorage.setItem("jarvis.defaultPersona", personaId);
    if (activeId) await setPersona(activeId, personaId);
  };

  const appName = process.env.NEXT_PUBLIC_APP_NAME || "JARVIS AI";

  return (
    <main className="relative min-h-screen w-full overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(circle at 50% 30%, #${activePersona.color}14, transparent 55%)`,
        }}
      />

      <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-10">
        <div className="flex items-center gap-3">
          <div
            className="h-2.5 w-2.5 rounded-full"
            style={{
              background: `#${activePersona.color}`,
              boxShadow: `0 0 12px 4px #${activePersona.color}99`,
            }}
          />
          <span className="text-xs uppercase tracking-[0.45em] text-cyan-100/70">
            {appName}
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-[0.4em] text-cyan-100/40">
          Realtime voice assistant interface
        </span>
      </header>

      <section className="relative z-10 grid gap-6 px-6 pb-10 md:px-10 md:pb-16 lg:grid-cols-[320px_1fr_360px] lg:gap-8">
        <Card className="order-2 lg:order-1 lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
          <LeftPanel
            sessions={sessions}
            activeSessionId={activeId}
            onSelectSession={handleSelect}
            onNewSession={handleNew}
            onDeleteSession={handleDelete}
            toolCalls={toolCalls}
            onClearToolCalls={clearToolCalls}
          />
        </Card>

        <div className="order-1 lg:order-2 flex flex-col items-center justify-start gap-6">
          <div className="relative h-[420px] w-full max-w-[520px] md:h-[520px]">
            {orbVariant === "face" ? (
              <ParticleFaceScene
                audioLevelRef={audioLevelRef}
                status={status}
                personaColor={activePersona.color}
              />
            ) : orbVariant === "particle" ? (
              <ParticleOrbScene
                audioLevelRef={audioLevelRef}
                status={status}
                personaColor={activePersona.color}
              />
            ) : (
              <OrbScene
                audioLevelRef={audioLevelRef}
                status={status}
                personaColor={activePersona.color}
              />
            )}
            <button
              onClick={toggleOrbVariant}
              className="absolute top-2 right-2 z-10 rounded-md border border-cyan-300/30 bg-black/40 px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-cyan-100/80 backdrop-blur transition hover:border-cyan-300/60 hover:text-cyan-100"
              title="Cycle orb style"
            >
              {VARIANT_LABEL[orbVariant]}
            </button>
          </div>

          <div className="flex flex-col items-center gap-3">
            <h1
              className="text-4xl md:text-5xl font-light tracking-[0.3em] text-glow"
              style={{ color: `#${activePersona.color}` }}
            >
              {activePersona.label.toUpperCase()}
            </h1>
            <p className="text-xs uppercase tracking-[0.35em] text-cyan-100/50">
              {activePersona.tagline}
            </p>
            <StatusBadge status={status} />
            {error && (
              <p className="text-xs text-red-300/80 max-w-sm text-center">
                {error}
              </p>
            )}
          </div>

          <Card className="w-full max-w-xl">
            <AssistantControls
              status={status}
              onStart={handleStart}
              onStop={stop}
              onSendText={sendText}
              muted={muted}
              onToggleMute={() => setMuted(!muted)}
              personaId={activePersonaId}
              onChangePersona={handleChangePersona}
            />
          </Card>
        </div>

        <Card className="order-3 flex flex-col gap-3 min-h-[420px] lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
          <div className="flex items-center justify-between">
            <h2 className="text-sm uppercase tracking-[0.3em] text-cyan-100/70">
              Transcript
            </h2>
            <span className="text-[10px] uppercase tracking-widest text-cyan-100/30">
              {transcript.length} messages
            </span>
          </div>
          <div className="h-px bg-cyan-400/10" />
          <TranscriptPanel messages={transcript} />
        </Card>
      </section>

      <footer className="relative z-10 px-6 pb-6 md:px-10">
        <p className="text-[10px] uppercase tracking-[0.4em] text-cyan-100/30">
          Connected via OpenAI Realtime · ephemeral tokens minted server-side ·
          sessions persisted to libsql
        </p>
      </footer>
    </main>
  );
}
