"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type MicPermission = "unknown" | "granted" | "denied" | "prompt";

/**
 * Lightweight microphone access hook. The voice providers manage their
 * own streams during sessions — use this for standalone visualizers or
 * pre-flight permission checks.
 */
export function useMicrophone() {
  const streamRef = useRef<MediaStream | null>(null);
  const [permission, setPermission] = useState<MicPermission>("unknown");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async () => {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = s;
      setStream(s);
      setPermission("granted");
      return s;
    } catch (e: any) {
      setPermission("denied");
      setError(e?.message || "Microphone permission denied");
      return null;
    }
  }, []);

  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  useEffect(() => () => release(), [release]);

  return { permission, stream, error, request, release };
}
