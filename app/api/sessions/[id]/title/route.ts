import { NextResponse } from "next/server";
import { listMessages, setTitle } from "@/lib/sessions/store";

export const runtime = "nodejs";

/**
 * Auto-titles a session by sending the first few turns to a small text model.
 * Runs out-of-band from the voice loop (no audio modality), so it never
 * interrupts what Jarvis is saying.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY missing" }, { status: 400 });

  const messages = await listMessages(id);
  if (messages.length === 0) return NextResponse.json({ title: null });

  const snippet = messages
    .slice(0, 6)
    .map((m) => `${m.role}: ${m.text}`)
    .join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Title this conversation in 2–5 words. No quotes, no punctuation, Title Case.",
        },
        { role: "user", content: snippet },
      ],
      max_tokens: 16,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    return NextResponse.json({ error: txt }, { status: 500 });
  }
  const data = await res.json();
  const title = (data.choices?.[0]?.message?.content || "").trim().slice(0, 60);
  if (title) await setTitle(id, title);
  return NextResponse.json({ title });
}
