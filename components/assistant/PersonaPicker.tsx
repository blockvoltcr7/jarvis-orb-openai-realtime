"use client";

import { useEffect, useRef, useState } from "react";
import { PERSONAS, findPersona } from "@/lib/voice/personas";
import { cn } from "@/lib/utils";

interface PersonaPickerProps {
  personaId: string;
  onChange: (id: string) => void;
  /** When true, the picker is locked because the voice can't change mid-call. */
  locked: boolean;
}

export function PersonaPicker({ personaId, onChange, locked }: PersonaPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const persona = findPersona(personaId);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !locked && setOpen((v) => !v)}
        disabled={locked}
        className={cn(
          "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition",
          "bg-white/[0.03] border-white/10",
          locked
            ? "opacity-50 cursor-not-allowed"
            : "hover:border-cyan-300/30 hover:bg-white/[0.06]"
        )}
        title={locked ? "Stop the session to change persona" : "Choose persona"}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className="h-2 w-2 rounded-full"
          style={{
            background: `#${persona.color}`,
            boxShadow: `0 0 8px 2px #${persona.color}80`,
          }}
        />
        <span className="text-cyan-100/90">{persona.label}</span>
        <span className="text-[10px] uppercase tracking-widest text-cyan-100/40">
          {persona.voice}
        </span>
        <span className="text-cyan-100/40">▾</span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-1/2 -translate-x-1/2 bottom-full z-30 mb-2 w-80 max-h-[60vh] overflow-y-auto rounded-2xl border border-white/10 bg-black/95 backdrop-blur-md p-1 shadow-2xl scrollbar-thin"
        >
          {PERSONAS.map((p) => {
            const active = p.id === personaId;
            return (
              <button
                key={p.id}
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
                className={cn(
                  "w-full text-left rounded-xl px-3 py-2.5 transition flex items-start gap-3",
                  active ? "bg-cyan-400/10" : "hover:bg-white/[0.05]"
                )}
              >
                <span
                  className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{
                    background: `#${p.color}`,
                    boxShadow: `0 0 10px 2px #${p.color}80`,
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm text-cyan-50">{p.label}</span>
                    <span className="text-[10px] uppercase tracking-widest text-cyan-100/40 shrink-0">
                      {p.voice}
                    </span>
                  </div>
                  <p className="text-[11px] text-cyan-100/50 leading-snug mt-0.5">
                    {p.tagline}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
