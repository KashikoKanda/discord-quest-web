import { NextResponse } from "next/server";

/**
 * Route chẩn đoán proxy — ĐÃ KHOÁ.
 *
 * Trước đây ai biết URL cũng gọi được và nhận về host/port/user/pass của proxy
 * cùng số GB còn lại. Đó là rò rỉ tài nguyên trả tiền và manh mối hạ tầng.
 * Giữ 404 để không lộ sự tồn tại của endpoint.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return new NextResponse("Not Found", { status: 404 });
}

export async function POST() {
  return new NextResponse("Not Found", { status: 404 });
}
