import { NextResponse } from "next/server";
import { appendToolCall } from "@/lib/sessions/store";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  if (!body?.id || !body?.name || !body?.status || typeof body?.startedAt !== "number") {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  await appendToolCall({
    sessionId: id,
    id: body.id,
    name: body.name,
    args: body.args,
    result: body.result,
    error: body.error,
    status: body.status,
    startedAt: body.startedAt,
    endedAt: body.endedAt,
  });
  return NextResponse.json({ ok: true });
}
