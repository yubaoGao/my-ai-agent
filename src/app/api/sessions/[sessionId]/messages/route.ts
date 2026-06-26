import { NextRequest, NextResponse } from "next/server";
import {
  clearSessionMessages,
  listSessionMessages,
} from "@/lib/server/chat-repository";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await context.params;
    const messages = await listSessionMessages(sessionId);
    return NextResponse.json({ messages });
  } catch (error) {
    console.error("Failed to list session messages:", error);
    return NextResponse.json(
      { error: "Failed to list session messages" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await context.params;
    await clearSessionMessages(sessionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to clear session messages:", error);
    return NextResponse.json(
      { error: "Failed to clear session messages" },
      { status: 500 }
    );
  }
}
