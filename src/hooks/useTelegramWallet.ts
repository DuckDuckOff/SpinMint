"use client";

import { useState, useEffect } from "react";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { base } from "viem/chains";
import type { WalletClient } from "viem";

export function useTelegramWallet() {
  const [address, setAddress] = useState<`0x${string}` | undefined>();
  const [walletClient, setWalletClient] = useState<WalletClient | undefined>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const initData = (window as any).Telegram?.WebApp?.initData;
    if (!initData) return;

    setLoading(true);
    fetch("/api/wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    })
      .then((r) => r.json())
      .then(({ privateKey }) => {
        const account = privateKeyToAccount(privateKey as `0x${string}`);
        const client = createWalletClient({
          account,
          chain: base,
          transport: http("https://mainnet.base.org"),
        });
        setAddress(account.address);
        setWalletClient(client);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { address, walletClient, loading };
}
