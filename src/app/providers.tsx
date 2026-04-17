"use client";

import { WagmiProvider, createConfig, http, fallback } from "wagmi";
import { coinbaseWallet, walletConnect, injected } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { base } from "viem/chains";

const PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    // Coinbase Smart Wallet — best UX for users without a wallet
    coinbaseWallet({ appName: "SpinMint", preference: { options: "smartWalletOnly" } }),
    // WalletConnect — MetaMask, Rainbow, etc.
    ...(PROJECT_ID ? [walletConnect({ projectId: PROJECT_ID })] : []),
    // Injected — MetaMask browser extension
    injected(),
  ],
  transports: {
    [base.id]: fallback([
      http("https://mainnet.base.org"),
      http("https://base.drpc.org"),
      http("https://base.llamarpc.com"),
    ]),
  },
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
