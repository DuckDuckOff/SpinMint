import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

function verifyInitData(initData: string, botToken: string): Record<string, string> | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  return expected === hash ? Object.fromEntries(params.entries()) : null;
}

export async function POST(req: NextRequest) {
  const { initData } = await req.json();

  const data = verifyInitData(initData, process.env.TELEGRAM_BOT_TOKEN!);
  if (!data) {
    return NextResponse.json({ error: "Invalid initData" }, { status: 401 });
  }

  const user = JSON.parse(data.user ?? "{}");
  const userId = user.id?.toString();
  if (!userId) {
    return NextResponse.json({ error: "No user ID" }, { status: 401 });
  }

  // Deterministic key: same user always gets the same wallet
  const privateKey =
    "0x" +
    crypto
      .createHmac("sha256", process.env.WALLET_DERIVATION_SECRET!)
      .update(userId)
      .digest("hex");

  return NextResponse.json({ privateKey });
}
