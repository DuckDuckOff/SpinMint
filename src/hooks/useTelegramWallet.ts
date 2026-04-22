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
    function init() {
      const tg = (window as any).Telegram?.WebApp;
      const initData = tg?.initData;
      if (!initData) return false;

      setLoading(true);
      fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      })
        .then((r) => r.json())
        .then(({ privateKey }) => {
          if (!privateKey) return;
          const account = privateKeyToAccount(privateKey as `0x${string}`);
          const client = createWalletClient({
            account,
            chain: base,
            transport: http("https://base.llamarpc.com"),
          });
          setAddress(account.address);
          setWalletClient(client);
        })
        .catch(() => {})
        .finally(() => setLoading(false));

      return true;
    }

    // Try immediately — if Telegram script already loaded, this works
    if (init()) return;

    // Otherwise wait 300ms for telegram-web-app.js to set window.Telegram
    const t = setTimeout(() => { init(); }, 300);
    return () => clearTimeout(t);
  }, []);

  return { address, walletClient, loading };
}
