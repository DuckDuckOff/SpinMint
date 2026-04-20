import type { Metadata } from "next";
import { Providers } from "./providers";
import TelegramInit from "./telegram-init";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://spinmint-tg.vercel.app";

export const metadata: Metadata = {
  title: "SpinMint - Mint. Spin. Win.",
  description: "Spin to win real USDC. Earn $SPINMINT tokens. Collect Peppermint NFTs. All onchain on Base.",
  openGraph: {
    title: "SpinMint",
    description: "Spin to win USDC onchain on Base",
    url: APP_URL,
    images: [`${APP_URL}/og.png`],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Block injected wallets (Coinbase, MetaMask etc) from auto-connecting.
            This app uses an embedded server-derived wallet — window.ethereum is unused. */}
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            Object.defineProperty(window, 'ethereum', {
              get: function() { return undefined; },
              set: function() {},
              configurable: false,
              enumerable: false,
            });
          } catch(e) {}
        `}} />
      </head>
      <body style={{ margin: 0, background: "#0a0a0f" }}>
        <TelegramInit />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
