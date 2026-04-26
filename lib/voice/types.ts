export type VoiceStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  timestamp: number;
}

export type ToolCallStatus = "running" | "success" | "error";

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
  status: ToolCallStatus;
  result?: unknown;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export interface VoiceProviderEvents {
  onStatus: (status: VoiceStatus) => void;
  onTranscript: (message: TranscriptMessage) => void;
  onError: (error: string) => void;
  onAudioLevel?: (level: number) => void;
  onToolCall?: (call: ToolCall) => void;
}

export interface VoiceProvider {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendText?(message: string): Promise<void>;
  setMuted?(muted: boolean): void;
  readonly name: string;
}

/** A function the model can call. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Executed in the browser. Use a server route for sensitive work. */
  handler: (args: any) => Promise<unknown> | unknown;
}
