import { TonClient } from "@ton/ton";

export const tonClient = new TonClient({
  endpoint: "https://toncenter.com/api/v2/jsonRPC",
  apiKey: process.env.NEXT_PUBLIC_TONCENTER_API_KEY,
});
