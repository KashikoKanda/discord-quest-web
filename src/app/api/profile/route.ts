import { NextRequest, NextResponse } from "next/server";
import { getDiscordProfile } from "@/lib/discord";

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }

    const data = await getDiscordProfile(token);
    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    // Check for token expiry
    if (err.message?.includes("401")) {
      return NextResponse.json(
        { error: "Token hết hạn", tokenExpired: true },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}
