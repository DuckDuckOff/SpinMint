import type { Metadata } from "next";
import { Providers } from "./providers";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://spinmint.vercel.app";

export const metadata: Metadata = {
  title: "SpinMint - Mint. Spin. Win.",
  description: "Mint an NFT for $1 USDC and spin to win the jackpot on Farcaster.",
  other: {
    // Farcaster Mini App manifest
    "fc:frame": JSON.stringify({
      version: "next",
      imageUrl: `${APP_URL}/og.png`,
      button: {
        title: "Spin Now",
        action: {
          type: "launch_frame",
          name: "SpinMint",
          url: APP_URL,
          splashImageUrl: `${APP_URL}/splash.png`,
          splashBackgroundColor: "#0a0a0f",
        },
      },
    }),
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0a0f" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
