import { NextRequest, NextResponse } from "next/server";
import { SignJWT, importPKCS8 } from "jose";
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

  const privateKey = await importPKCS8(
    process.env.JWT_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    "ES256"
  );

  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "ES256", kid: "spinmint-1" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .setIssuer(process.env.NEXT_PUBLIC_APP_URL ?? "https://spinmint-tg.vercel.app")
    .setAudience(process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID!)
    .sign(privateKey);

  return NextResponse.json({ token, userId });
}
