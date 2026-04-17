"use client";

import { useEffect } from "react";

// Initialises Telegram Web App SDK so the app feels native inside Telegram.
// Expands to full screen, sets the header colour, and signals ready.
export default function TelegramInit() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    import("@twa-dev/sdk").then(({ default: WebApp }) => {
      WebApp.ready();
      WebApp.expand();
      WebApp.setHeaderColor("#0a0a0f");
      WebApp.setBackgroundColor("#0a0a0f");
    });
  }, []);

  return null;
}
