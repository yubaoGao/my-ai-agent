import { NextResponse } from "next/server";
import { createChatSession, listChatSessions } from "@/lib/server/chat-repository";

export async function GET() {
  try {
    const sessions = await listChatSessions();
    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("Failed to list sessions:", error);
    return NextResponse.json(
      { error: "Failed to list sessions" },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const session = await createChatSession();
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    console.error("Failed to create session:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }
}
