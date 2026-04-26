import type { MessageRow } from "./store";

/**
 * Hybrid resume strategy:
 *   - last N turns are replayed verbatim as conversation.item.create
 *   - older turns are collapsed into a single system note
 * Keeps token cost flat while preserving recent context faithfully.
 */
const VERBATIM_TURNS = 6;

export interface SeedItem {
  type: "message";
  role: "user" | "assistant" | "system";
  text: string;
}

export function buildSeedItems(messages: MessageRow[]): SeedItem[] {
  if (messages.length === 0) return [];

  const ordered = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  if (ordered.length <= VERBATIM_TURNS) {
    return ordered.map((m) => ({ type: "message", role: m.role, text: m.text }));
  }

  const head = ordered.slice(0, ordered.length - VERBATIM_TURNS);
  const tail = ordered.slice(-VERBATIM_TURNS);
  const summary = summarize(head);

  return [
    { type: "message", role: "system", text: `Earlier in this conversation: ${summary}` },
    ...tail.map((m) => ({ type: "message" as const, role: m.role, text: m.text })),
  ];
}

function summarize(messages: MessageRow[]): string {
  // Cheap deterministic summary — first user prompt + last assistant reply +
  // count. The model only needs enough to stay coherent; if you want a
  // higher-fidelity recap, plug in a separate /api/sessions/[id]/title-style
  // text completion here.
  const firstUser = messages.find((m) => m.role === "user")?.text;
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")?.text;
  const parts: string[] = [];
  if (firstUser) parts.push(`user opened with "${truncate(firstUser, 140)}"`);
  if (lastAssistant) parts.push(`assistant most recently said "${truncate(lastAssistant, 140)}"`);
  parts.push(`${messages.length} earlier turns omitted`);
  return parts.join("; ") + ".";
}

function truncate(s: string, n: number) {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
