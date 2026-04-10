"use client";

import { OnchainKitProvider } from "@coinbase/onchainkit";
import { MiniKitProvider } from "@coinbase/onchainkit/minikit";
import { base, baseSepolia } from "viem/chains";
import { WagmiProvider, createConfig, http, fallback } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";

const chain = process.env.NEXT_PUBLIC_CHAIN === "mainnet" ? base : baseSepolia;

// Provide config upfront with farcasterMiniApp connector so AutoConnect
// doesn't race against async MiniKit context loading
// Put the target chain first so it becomes the default for new connections
const wagmiConfig = createConfig({
  chains: chain.id === base.id ? [base, baseSepolia] : [baseSepolia, base],
  connectors: [farcasterMiniApp()],
  transports: {
    [base.id]: fallback([
      http("https://mainnet.base.org"),
      http("https://base.drpc.org"),
      http("https://base.llamarpc.com"),
    ]),
    [baseSepolia.id]: http("https://sepolia.base.org"),
  },
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <OnchainKitProvider
          apiKey={process.env.NEXT_PUBLIC_CDP_CLIENT_API_KEY!}
          chain={chain}
          config={{
            appearance: {
              mode: "dark",
            },
          }}
        >
          <MiniKitProvider enabled={true}>
            {children}
          </MiniKitProvider>
        </OnchainKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
