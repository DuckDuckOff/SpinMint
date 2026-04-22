import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const rpcUrl = process.env.BASE_RPC_URL ?? "https://base.llamarpc.com";
const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });

// Top up if balance below 0.000005 ETH; send 0.00002 ETH (~10 spins on Base, ~$0.06/user)
const GAS_THRESHOLD = parseEther("0.000005");
const GAS_TOPUP     = parseEther("0.00002");

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

  // Auto-fund gas if wallet is empty and gas bank is configured
  if (process.env.GAS_BANK_PRIVATE_KEY) {
    try {
      const userAddress = privateKeyToAccount(privateKey as `0x${string}`).address;
      const balance = await publicClient.getBalance({ address: userAddress });
      if (balance < GAS_THRESHOLD) {
        const bankAccount = privateKeyToAccount(process.env.GAS_BANK_PRIVATE_KEY as `0x${string}`);
        const bankWallet = createWalletClient({ account: bankAccount, chain: base, transport: http(rpcUrl) });
        const hash = await bankWallet.sendTransaction({ to: userAddress, value: GAS_TOPUP });
        await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 1000 });
      }
    } catch {
      // Don't block wallet access if top-up fails
    }
  }

  return NextResponse.json({ privateKey });
}
