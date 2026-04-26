import type { VoiceProvider, VoiceProviderEvents, TranscriptMessage } from "./types";
import { uid } from "../utils";
import { findTool, toolsForSessionUpdate } from "./tools";

const DEFAULT_SYSTEM_PROMPT =
  "You are Jarvis, a calm, concise, highly capable AI assistant. You help the user think clearly, automate tasks, summarize information, plan projects, and answer questions. Speak naturally and avoid long monologues unless asked. Use the available tools when they would help.";

const REALTIME_BASE = "https://api.openai.com/v1/realtime/calls";

export interface SeedItem {
  type: "message";
  role: "user" | "assistant" | "system";
  text: string;
}

export interface ProviderOptions {
  /** Items replayed via conversation.item.create after session.update. */
  seedItems?: SeedItem[];
  /** Override the default Jarvis instructions. */
  instructions?: string;
  /**
   * OpenAI Realtime built-in voice. Locked for the lifetime of the WebRTC
   * call once the model has emitted audio — switch personas by stopping
   * and restarting the provider.
   */
  voice?: string;
}

/**
 * OpenAI Realtime provider using WebRTC.
 *
 * Implementation follows the official Realtime API patterns:
 *   https://github.com/openai/openai-realtime-console
 *
 *   1. POST /api/realtime-session — server route mints an ephemeral
 *      client_secret using OPENAI_API_KEY (server-only).
 *   2. Open RTCPeerConnection, attach mic track, create data channel.
 *   3. Exchange SDP with /v1/realtime/calls?model=gpt-realtime.
 *   4. After session.created, send session.update with tools + instructions.
 *   5. Handle data-channel events:
 *        - response.audio_transcript.delta  → stream assistant text
 *        - response.done                    → look for function_call output items
 *        - input_audio_transcription.completed → user transcript
 *   6. For function calls: execute handler, send function_call_output, then
 *      response.create to let the model speak the result.
 */
export class OpenAIRealtimeProvider implements VoiceProvider {
  readonly name = "openai-realtime";
  private events: VoiceProviderEvents;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private remoteAudioEl: HTMLAudioElement | null = null;
  private audioCtx: AudioContext | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private remoteAnalyser: AnalyserNode | null = null;
  private rafId: number | null = null;
  private muted = false;
  private currentAssistantBuffer = "";
  private currentAssistantId: string | null = null;
  private executedCallIds = new Set<string>();

  private options: ProviderOptions;

  constructor(events: VoiceProviderEvents, options: ProviderOptions = {}) {
    this.events = events;
    this.options = options;
  }

  private send(message: any) {
    if (!this.dc || this.dc.readyState !== "open") return;
    if (!message.event_id) message.event_id = crypto.randomUUID();
    this.dc.send(JSON.stringify(message));
  }

  async start() {
    this.events.onStatus("connecting");
    try {
      const tokenRes = await fetch("/api/realtime-session", { method: "POST" });
      if (!tokenRes.ok) {
        const body = await tokenRes.json().catch(() => ({}));
        throw new Error(body.error || `Session error (${tokenRes.status})`);
      }
      const session = await tokenRes.json();
      const ephemeralKey: string =
        session.client_secret?.value ?? session.value ?? session.client_secret;
      const model: string = session.model || "gpt-realtime";

      this.pc = new RTCPeerConnection();

      // remote audio
      this.remoteAudioEl = document.createElement("audio");
      this.remoteAudioEl.autoplay = true;
      this.pc.ontrack = (e) => {
        if (this.remoteAudioEl) this.remoteAudioEl.srcObject = e.streams[0];
        this.attachRemoteAnalyser(e.streams[0]);
      };

      // mic
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.localStream.getTracks().forEach((t) => this.pc!.addTrack(t, this.localStream!));
      this.attachMicAnalyser(this.localStream);

      // events channel
      this.dc = this.pc.createDataChannel("oai-events");
      this.dc.addEventListener("open", () => {
        this.send({
          type: "session.update",
          session: {
            type: "realtime",
            instructions: this.options.instructions || DEFAULT_SYSTEM_PROMPT,
            tools: toolsForSessionUpdate(),
            tool_choice: "auto",
            // GA `session.audio.input.transcription` config (the older flat
            // `input_audio_transcription` field is rejected by gpt-realtime).
            // `gpt-4o-transcribe-diarize` has the longest support window
            // (retires April 2027); older `gpt-4o-transcribe` / `whisper-1`
            // retire June 2026.
            // `gpt-4o-mini-transcribe` is broadly available without
            // gated-access approval. Upgrade to `gpt-4o-transcribe` or
            // `gpt-4o-transcribe-diarize` once your org is granted access.
            audio: {
              input: {
                transcription: {
                  model: "gpt-4o-mini-transcribe",
                },
              },
              output: this.options.voice ? { voice: this.options.voice } : undefined,
            },
          },
        });
        // Replay prior conversation. Realtime treats these as if they
        // happened in the live call, so the model has full recent context
        // when the user speaks next.
        const seed = this.options.seedItems || [];
        for (const item of seed) {
          this.send({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: item.role,
              content: [
                {
                  // assistant items must use output_text;
                  // user/system items use input_text.
                  type: item.role === "assistant" ? "output_text" : "input_text",
                  text: item.text,
                },
              ],
            },
          });
        }
        this.events.onStatus("listening");
      });
      this.dc.addEventListener("message", (ev) => this.handleEvent(ev.data));

      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      const sdpRes = await fetch(`${REALTIME_BASE}?model=${model}`, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
      });
      if (!sdpRes.ok) {
        const txt = await sdpRes.text();
        throw new Error(`SDP exchange failed (${sdpRes.status}): ${txt}`);
      }
      const answer = { type: "answer" as const, sdp: await sdpRes.text() };
      await this.pc.setRemoteDescription(answer);

      this.tick();
    } catch (e: any) {
      this.events.onError(e?.message || "Failed to connect");
      this.events.onStatus("error");
      await this.stop();
    }
  }

  private attachMicAnalyser(stream: MediaStream) {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    this.audioCtx = this.audioCtx || new Ctx();
    const src = this.audioCtx.createMediaStreamSource(stream);
    this.micAnalyser = this.audioCtx.createAnalyser();
    this.micAnalyser.fftSize = 512;
    this.micAnalyser.smoothingTimeConstant = 0.7;
    src.connect(this.micAnalyser);
  }

  private attachRemoteAnalyser(stream: MediaStream) {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    this.audioCtx = this.audioCtx || new Ctx();
    const src = this.audioCtx.createMediaStreamSource(stream);
    this.remoteAnalyser = this.audioCtx.createAnalyser();
    this.remoteAnalyser.fftSize = 512;
    this.remoteAnalyser.smoothingTimeConstant = 0.7;
    src.connect(this.remoteAnalyser);
  }

  private tick = () => {
    const read = (a: AnalyserNode | null) => {
      if (!a) return 0;
      const buf = new Uint8Array(a.frequencyBinCount);
      a.getByteFrequencyData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += buf[i];
      return s / buf.length / 255;
    };
    const mic = this.muted ? 0 : read(this.micAnalyser);
    const remote = read(this.remoteAnalyser);
    const level = Math.min(1, Math.max(mic, remote) * 1.8);
    this.events.onAudioLevel?.(level);
    this.rafId = requestAnimationFrame(this.tick);
  };

  private handleEvent(raw: any) {
    let evt: any;
    try {
      evt = JSON.parse(raw);
    } catch {
      return;
    }

    switch (evt.type) {
      case "input_audio_buffer.speech_started":
        this.events.onStatus("listening");
        break;
      case "input_audio_buffer.speech_stopped":
        this.events.onStatus("thinking");
        break;
      case "conversation.item.input_audio_transcription.completed": {
        const text = evt.transcript?.trim();
        if (text) {
          this.events.onTranscript({
            id: uid(),
            role: "user",
            text,
            timestamp: Date.now(),
          });
        }
        break;
      }
      // gpt-realtime emits `response.output_audio_transcript.*`. The older
      // `response.audio_transcript.*` events are kept for backwards compat
      // with prior preview models.
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta": {
        if (!this.currentAssistantId) {
          this.currentAssistantId = uid();
          this.currentAssistantBuffer = "";
          this.events.onStatus("speaking");
        }
        this.currentAssistantBuffer += evt.delta || "";
        this.events.onTranscript({
          id: this.currentAssistantId,
          role: "assistant",
          text: this.currentAssistantBuffer,
          timestamp: Date.now(),
        });
        break;
      }
      case "response.done": {
        // Per the official OpenAI Realtime console pattern, function calls
        // arrive as fully-formed items in response.output once the response
        // is complete. We execute them here.
        const output = evt.response?.output;
        if (Array.isArray(output)) {
          for (const item of output) {
            if (item.type === "function_call") {
              this.executeTool(item.call_id, item.name, item.arguments);
            }
          }
        }
        this.currentAssistantId = null;
        this.events.onStatus("listening");
        break;
      }
      case "error":
        this.events.onError(evt.error?.message || "Realtime error");
        break;
    }
  }

  private async executeTool(callId: string, name: string, argsJson: string) {
    if (this.executedCallIds.has(callId)) return;
    this.executedCallIds.add(callId);

    let args: any = {};
    try {
      args = JSON.parse(argsJson || "{}");
    } catch {}

    const startedAt = Date.now();
    this.events.onStatus("thinking");
    this.events.onToolCall?.({ id: callId, name, args, status: "running", startedAt });

    const tool = findTool(name);
    let result: unknown;
    let error: string | undefined;
    try {
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      result = await tool.handler(args);
    } catch (e: any) {
      error = e?.message || "Tool failed";
      result = { error };
    }

    this.events.onToolCall?.({
      id: callId,
      name,
      args,
      status: error ? "error" : "success",
      result,
      error,
      startedAt,
      endedAt: Date.now(),
    });

    // Push the result back into the conversation, then ask the model to continue.
    this.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(result),
      },
    });
    this.send({ type: "response.create" });
  }

  async sendText(message: string) {
    if (!this.dc || this.dc.readyState !== "open") return;
    this.events.onTranscript({ id: uid(), role: "user", text: message, timestamp: Date.now() });
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: message }],
      },
    });
    this.send({ type: "response.create" });
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  async stop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.dc?.close();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.pc?.getSenders().forEach((s) => s.track?.stop());
    this.pc?.close();
    await this.audioCtx?.close().catch(() => {});
    this.dc = null;
    this.pc = null;
    this.localStream = null;
    this.audioCtx = null;
    this.micAnalyser = null;
    this.remoteAnalyser = null;
    this.executedCallIds.clear();
    this.events.onAudioLevel?.(0);
    this.events.onStatus("idle");
  }
}
