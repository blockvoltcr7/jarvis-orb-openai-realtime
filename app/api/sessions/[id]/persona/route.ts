import { NextResponse } from "next/server";
import { setPersona } from "@/lib/sessions/store";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  if (!body?.personaId) {
    return NextResponse.json({ error: "personaId required" }, { status: 400 });
  }
  await setPersona(id, body.personaId);
  return NextResponse.json({ ok: true });
}
