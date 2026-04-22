import type { Metadata } from "next";
import Script from "next/script";
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
        {/* Official Telegram Mini App script — must load before page scripts
            so window.Telegram.WebApp.initData is available synchronously */}
        <script src="https://telegram.org/js/telegram-web-app.js" />
      </head>
      <body style={{ margin: 0, background: "#0a0a0f" }}>
        <Script id="block-injected-wallets" strategy="beforeInteractive">{`
          try {
            Object.defineProperty(window, 'ethereum', {
              get: function() { return undefined; },
              set: function() {},
              configurable: false,
              enumerable: false,
            });
            window.web3 = undefined;
          } catch(e) {}
        `}</Script>
        <TelegramInit />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
