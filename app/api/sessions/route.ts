import { NextResponse } from "next/server";
import { createSession, listSessions } from "@/lib/sessions/store";

export const runtime = "nodejs";

export async function GET() {
  const sessions = await listSessions();
  return NextResponse.json({ sessions });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const session = await createSession({
    title: body?.title,
    personaId: body?.personaId,
  });
  return NextResponse.json({ session });
}
