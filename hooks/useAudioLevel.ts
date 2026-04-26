"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Standalone hook to read audio level (0..1) from a MediaStream using
 * the Web Audio API. Used independently of a voice provider — handy
 * for visualizers or local-only mic demos.
 */
export function useAudioLevel(stream?: MediaStream | null) {
  const levelRef = useRef(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!stream) return;
    let raf = 0;
    let ctx: AudioContext | null = null;
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.7;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(buf);
        let s = 0;
        for (let i = 0; i < buf.length; i++) s += buf[i];
        const avg = s / buf.length / 255;
        levelRef.current = levelRef.current * 0.6 + Math.min(1, avg * 1.8) * 0.4;
        raf = requestAnimationFrame(tick);
      };
      tick();
      setIsAnalyzing(true);
    } catch (e: any) {
      setError(e?.message || "Audio analysis failed");
    }
    return () => {
      cancelAnimationFrame(raf);
      ctx?.close().catch(() => {});
      setIsAnalyzing(false);
    };
  }, [stream]);

  return { audioLevelRef: levelRef, isAnalyzing, error };
}
