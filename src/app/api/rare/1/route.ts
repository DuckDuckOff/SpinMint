import { NextResponse } from "next/server";

/**
 * Static metadata for the Spin Ticket (token ID 1).
 * This is the fungible NFT every user receives when they mint.
 */
export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://spinmint.vercel.app";

  return NextResponse.json({
    name:        "SpinMint Ticket",
    description: "A SpinMint spin ticket. Mint one for $1 USDC and spin the wheel — win USDC or a rare peppermint lollie NFT.",
    image:        `${appUrl}/ticket.svg`,
    external_url: appUrl,
    attributes: [
      { trait_type: "Type",  value: "Spin Ticket" },
      { trait_type: "Price", value: "$1 USDC"     },
    ],
  });
}
