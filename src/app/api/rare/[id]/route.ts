import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { generateSVG } from "@/lib/svgGenerator";
import { traitsFromSeed, rarityScore, rarityLabel } from "@/lib/traits";

// ─── Contract ABI (just what we need) ────────────────────────────────────────
const ABI = [
  {
    name: "getRareInfo",
    type: "function",
    stateMutability: "view",
    inputs:  [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "seed",    type: "uint256" },
      { name: "minter",  type: "address" },
      { name: "exists",  type: "bool"    },
    ],
  },
] as const;

const CONTRACT = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`;

// ─── Public client (read-only, no API key needed) ─────────────────────────────
const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
});

// ─── Seed cache (in-memory for MVP, use Redis/KV in prod) ─────────────────────
const seedCache = new Map<number, { seed: bigint; minter: string }>();

async function getSeedForToken(tokenId: number): Promise<{ seed: bigint; minter: string } | null> {
  // Check cache first
  if (seedCache.has(tokenId)) return seedCache.get(tokenId)!;

  // Validate token ID range
  if (tokenId < 1000) {
    return null; // IDs below 1000 are spin tickets, not rare NFTs
  }

  try {
    const [seed, minter, exists] = await publicClient.readContract({
      address: CONTRACT,
      abi: ABI,
      functionName: "getRareInfo",
      args: [BigInt(tokenId)],
    });

    if (!exists) return null;

    const result = { seed, minter };
    seedCache.set(tokenId, result);
    return result;
  } catch {
    return null;
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tokenId = parseInt(id, 10);

  if (isNaN(tokenId) || tokenId < 1000) {
    return NextResponse.json({ error: "Invalid token ID" }, { status: 400 });
  }

  // Check if requesting raw SVG image
  const url = new URL(req.url);
  const wantSVG = url.searchParams.get("format") === "svg" || url.pathname.endsWith(".svg");

  // ── Dev mode: generate from a mock seed without hitting chain ──────────────
  const isDev = process.env.NODE_ENV === "development";
  let seed: bigint;
  let minter: string;

  if (isDev && !process.env.NEXT_PUBLIC_CONTRACT_ADDRESS) {
    // Deterministic dev seed from token ID
    seed   = BigInt(`0x${tokenId.toString(16).padStart(64, "a")}`) ^ BigInt(tokenId * 0xdeadbeef);
    minter = "0x0000000000000000000000000000000000000000";
  } else {
    const info = await getSeedForToken(tokenId);
    if (!info) {
      return NextResponse.json({ error: "Token not found" }, { status: 404 });
    }
    seed   = info.seed;
    minter = info.minter;
  }

  // ── Return SVG image ───────────────────────────────────────────────────────
  if (wantSVG) {
    const svg = generateSVG(tokenId, seed);
    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=31536000, immutable", // SVG is deterministic → cache forever
      },
    });
  }

  // ── Return ERC-1155 metadata JSON ─────────────────────────────────────────
  const traits   = traitsFromSeed(seed);
  const score    = rarityScore(traits);
  const appUrl   = process.env.NEXT_PUBLIC_APP_URL ?? "https://spinmint.vercel.app";
  const imageUrl = `${appUrl}/api/rare/${tokenId}?format=svg`;

  const metadata = {
    name:        `SpinMint Lollie #${tokenId}`,
    description: `A rare procedurally generated peppermint lollie NFT, won on SpinMint. Each lollie is unique — its art is generated entirely from an on-chain seed. No two are the same.`,
    image:        imageUrl,
    external_url: `${appUrl}`,
    attributes: [
      { trait_type: "Palette",    value: traits.palette.value    },
      { trait_type: "Shape",      value: traits.shape.value      },
      { trait_type: "Pattern",    value: traits.pattern.value    },
      { trait_type: "Background", value: traits.background.value },
      { trait_type: "Stick",      value: traits.stick.value      },
      { trait_type: "Effect",     value: traits.effect.value     },
      { trait_type: "Rarity",     value: rarityLabel(score)      },
      { trait_type: "Rarity Score", value: score, display_type: "number" },
      { trait_type: "Minter",     value: minter                  },
    ],
  };

  return NextResponse.json(metadata, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
