import { NextResponse } from "next/server";

/**
 * Mints an ephemeral client secret for the OpenAI Realtime API.
 * The browser uses this short-lived token to open a WebRTC session
 * directly to api.openai.com/v1/realtime/calls — the long-lived
 * OPENAI_API_KEY never leaves the server.
 *
 * Pattern follows the official Realtime console example:
 *   https://github.com/openai/openai-realtime-console
 */
const REALTIME_MODEL = "gpt-realtime";

export async function POST() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "OPENAI_API_KEY is not configured. Add it to .env.local before starting a session.",
      },
      { status: 400 }
    );
  }

  try {
    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
        },
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      return NextResponse.json(
        { error: `OpenAI session error: ${txt}` },
        { status: 500 }
      );
    }

    const data = await res.json();
    // Pass the model along so the client knows which one to use for SDP exchange.
    return NextResponse.json({ ...data, model: REALTIME_MODEL });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
