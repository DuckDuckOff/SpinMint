import { NextRequest, NextResponse } from "next/server";
import { generateSVG } from "@/lib/svgGenerator";
import { traitsFromSeed, rarityScore, rarityLabel } from "@/lib/traits";

function deterministicSeed(tokenId: number): bigint {
  return BigInt(`0x${"a".repeat(64)}`) ^ BigInt(tokenId * 0xdeadbeef);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tokenId = parseInt(id, 10);

  if (isNaN(tokenId) || tokenId < 1000) {
    return NextResponse.json({ error: "Invalid token ID" }, { status: 400 });
  }

  const url = new URL(req.url);
  const wantSVG = url.searchParams.get("format") === "svg" || url.pathname.endsWith(".svg");

  const seed = deterministicSeed(tokenId);

  if (wantSVG) {
    const svg = generateSVG(tokenId, seed);
    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  const traits = traitsFromSeed(seed.toString(16));
  const score  = rarityScore(traits);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://spinmint-tg.vercel.app";

  return NextResponse.json({
    name:        `SpinMint Lollie #${tokenId}`,
    description: "A rare procedurally generated peppermint lollie NFT, won on SpinMint.",
    image:       `${appUrl}/api/rare/${tokenId}?format=svg`,
    external_url: appUrl,
    attributes: [
      { trait_type: "Palette",      value: traits.palette.value    },
      { trait_type: "Shape",        value: traits.shape.value      },
      { trait_type: "Pattern",      value: traits.pattern.value    },
      { trait_type: "Background",   value: traits.background.value },
      { trait_type: "Stick",        value: traits.stick.value      },
      { trait_type: "Effect",       value: traits.effect.value     },
      { trait_type: "Rarity",       value: rarityLabel(score)      },
      { trait_type: "Rarity Score", value: score, display_type: "number" },
    ],
  }, {
    headers: { "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
