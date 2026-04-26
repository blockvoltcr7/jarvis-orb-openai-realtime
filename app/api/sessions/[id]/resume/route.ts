import { NextResponse } from "next/server";
import { listMessages } from "@/lib/sessions/store";
import { buildSeedItems } from "@/lib/sessions/resume";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const messages = await listMessages(id);
  const seed = buildSeedItems(messages);
  return NextResponse.json({ seed });
}
