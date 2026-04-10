import { NextRequest, NextResponse } from "next/server";
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// ─── ABI (just what we need) ──────────────────────────────────────────────────
const ABI = [
  {
    name: "grantFreeSpin",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "user", type: "address" }],
    outputs: [],
  },
] as const;

const CONTRACT = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`;

// ─── Rate limiting (in-memory for MVP, use Redis in prod) ─────────────────────
const recentGrants = new Map<string, number>();

export async function POST(req: NextRequest) {
  try {
    const { castHash, userAddress, fid } = await req.json();

    if (!castHash || !userAddress || !fid) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 });
    }

    // Rate limit: 1 free spin per user per day
    const key = `${userAddress}-${new Date().toDateString()}`;
    if (recentGrants.has(key)) {
      return NextResponse.json({ error: "Already granted today" }, { status: 429 });
    }

    // Verify cast exists on Farcaster via Neynar
    const neynarKey = process.env.NEYNAR_API_KEY;
    if (neynarKey) {
      const res = await fetch(
        `https://api.neynar.com/v2/farcaster/cast?identifier=${castHash}&type=hash`,
        { headers: { "api_key": neynarKey } }
      );
      if (!res.ok) {
        return NextResponse.json({ error: "Cast not found" }, { status: 400 });
      }
      const data = await res.json();
      // Verify the cast mentions SpinMint or contains the app URL
      const text: string = data.cast?.text ?? "";
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "spinmint.vercel.app";
      if (!text.toLowerCase().includes("spinmint") && !text.includes(appUrl)) {
        return NextResponse.json({ error: "Cast does not mention SpinMint" }, { status: 400 });
      }
    }

    // Grant free spin on-chain
    const account = privateKeyToAccount(process.env.OWNER_PRIVATE_KEY as `0x${string}`);
    const client  = createWalletClient({
      account,
      chain: base,
      transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
    });

    const txHash = await client.writeContract({
      address: CONTRACT,
      abi: ABI,
      functionName: "grantFreeSpin",
      args: [userAddress as `0x${string}`],
    });

    // Record grant
    recentGrants.set(key, Date.now());

    return NextResponse.json({ success: true, txHash });

  } catch (err) {
    console.error("grant-free-spin error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
