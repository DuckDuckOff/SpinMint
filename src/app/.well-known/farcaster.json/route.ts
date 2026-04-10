import { NextResponse } from "next/server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://spinmint.vercel.app";

export async function GET() {
  return NextResponse.json({
    accountAssociation: {
      // Fill these in after running: npx create-onchain --mini
      // and signing with your Farcaster custody wallet
      header:    process.env.FARCASTER_HEADER    ?? "",
      payload:   process.env.FARCASTER_PAYLOAD   ?? "",
      signature: process.env.FARCASTER_SIGNATURE ?? "",
    },
    frame: {
      version: "1",
      name: "SpinMint",
      iconUrl: `${APP_URL}/icon.png`,
      homeUrl: APP_URL,
      imageUrl: `${APP_URL}/og.png`,
      buttonTitle: "Spin Now",
      splashImageUrl: `${APP_URL}/splash.png`,
      splashBackgroundColor: "#0a0a0f",
      webhookUrl: `${APP_URL}/api/webhook`,
      tags: ["game", "nft", "usdc", "win"],
    },
  });
}
