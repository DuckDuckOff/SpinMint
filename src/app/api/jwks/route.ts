import { NextResponse } from "next/server";

// Web3Auth fetches this URL to verify our JWTs.
// JWT_PUBLIC_JWK is the JSON string from scripts/generate-keys.mjs
export async function GET() {
  const jwk = JSON.parse(process.env.JWT_PUBLIC_JWK!);
  return NextResponse.json({ keys: [jwk] });
}
