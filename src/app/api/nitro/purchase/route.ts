import { NextRequest, NextResponse } from "next/server";
import { autoPurchaseNitro, getNitroStatus } from "@/lib/nitroManager";
import { tokenIdOf } from "@/lib/tokenCheck";

export async function POST(request: NextRequest) {
  try {
    const { token, tokenId: clientTokenId } = await request.json();

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }

    const tokenId = tokenIdOf(token);

    const status = getNitroStatus(tokenId);
    if (status.inProgress) {
      return NextResponse.json({
        success: false,
        message: "Đang mua Nitro, vui lòng chờ...",
      }, { status: 409 });
    }

    const result = await autoPurchaseNitro(tokenId, token);

    return NextResponse.json({
      success: result.success,
      message: result.message,
      orbsBalance: result.orbsBalance,
    }, { status: result.success ? 200 : 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const tokenId = request.nextUrl.searchParams.get("tokenId");
    if (!tokenId) {
      return NextResponse.json({ error: "tokenId required" }, { status: 400 });
    }

    const status = getNitroStatus(tokenId);
    return NextResponse.json({ success: true, ...status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
