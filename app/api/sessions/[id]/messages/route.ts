import { NextResponse } from "next/server";
import { appendMessage } from "@/lib/sessions/store";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  if (!body?.role || typeof body?.text !== "string") {
    return NextResponse.json({ error: "role and text required" }, { status: 400 });
  }
  const message = await appendMessage({
    sessionId: id,
    id: body.id,
    role: body.role,
    text: body.text,
  });
  return NextResponse.json({ message });
}
