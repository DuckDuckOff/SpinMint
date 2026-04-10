/**
 * SPINMINT — SEED STRATEGY
 * ========================
 *
 * Every rare NFT's visual identity is derived from a single uint256 seed
 * stored on-chain in the SpinMint contract at `rareSeed[tokenId]`.
 *
 * HOW THE SEED IS GENERATED (on-chain)
 * ─────────────────────────────────────
 * When a user wins a rare NFT during a spin, the contract runs:
 *
 *   seed = keccak256(abi.encodePacked(block.prevrandao, user, nonce, rareId))
 *
 * This means:
 *   • The seed is unique per token (includes rareId)
 *   • It's unpredictable before the block (includes block.prevrandao)
 *   • It's tied to the winner's address (includes user)
 *   • It's stored permanently in contract storage
 *
 * HOW TRAITS ARE DERIVED (off-chain, deterministic)
 * ──────────────────────────────────────────────────
 * The seed is sliced into 6 independent 40-bit windows:
 *
 *   bits 0–39   → palette    (colour scheme)
 *   bits 40–79  → shape      (swirl count, size)
 *   bits 80–119 → pattern    (overlay decoration)
 *   bits 120–159→ background (scene type + colours)
 *   bits 160–199→ stick      (handle style)
 *   bits 200–239→ effect     (glow, sparkle, etc.)
 *
 * Each window is used to pick a weighted-random trait from its category.
 * Because the seed is fixed on-chain, the same token always produces
 * identical traits and SVG art — fully deterministic, no IPFS pinning needed.
 *
 * WHY NO IPFS?
 * ─────────────
 * Most NFT projects store image files on IPFS. SpinMint doesn't need to
 * because the art is algorithmically generated from the seed at request time.
 * The SVG returned by /api/rare/[id]?format=svg is always identical for a
 * given token, so it can be cached forever (Cache-Control: immutable).
 *
 * THE METADATA URI IN THE CONTRACT
 * ──────────────────────────────────
 * The contract is deployed with URI = "https://yourapp.vercel.app/api"
 *
 * The overridden `uri(tokenId)` function returns:
 *   - Token 1:         "https://yourapp.vercel.app/api/rare/1"   (spin ticket)
 *   - Token 1000+:     "https://yourapp.vercel.app/api/rare/1234" (rare NFTs)
 *
 * Marketplaces (OpenSea, Blur, etc.) call this URL to get metadata JSON,
 * which includes the image URL pointing back to ?format=svg.
 *
 * UPGRADING TO CHAINLINK VRF
 * ───────────────────────────
 * block.prevrandao is sufficient for low-stakes prizes. For a jackpot >$500,
 * consider Chainlink VRF v2.5 on Base:
 *
 *   1. Import VRFConsumerBaseV2Plus
 *   2. Replace _spin() with a two-step request/callback pattern:
 *      - requestRandomWords()  → stores requestId → rareId mapping
 *      - fulfillRandomWords()  → uses VRF output as seed, mints NFT
 *   3. Fund your VRF subscription with LINK (~$0.001 per call on Base)
 *
 * RARITY DISTRIBUTION (expected at scale)
 * ─────────────────────────────────────────
 * Run this file to simulate distribution:
 *   npx ts-node src/lib/seedStrategy.ts
 */

import { traitsFromSeed, rarityScore, rarityLabel } from "./traits";

function simulateDistribution(sampleSize = 10_000) {
  const counts: Record<string, number> = {
    "⬛ Legendary": 0,
    "🟣 Rare":      0,
    "🔵 Uncommon":  0,
    "⬜ Common":    0,
  };

  // Use deterministic seeds for reproducible results
  for (let i = 0; i < sampleSize; i++) {
    // Simulate a keccak-like seed using BigInt arithmetic
    const seed = BigInt(`0x${(i * 0xdeadbeef).toString(16).padStart(64, "0")}`);
    const traits = traitsFromSeed(seed);
    const score  = rarityScore(traits);
    const label  = rarityLabel(score);
    counts[label]++;
  }

  console.log(`\n🍬 SpinMint Lollie — Simulated Rarity Distribution (n=${sampleSize.toLocaleString()})\n`);
  console.log("─".repeat(50));
  for (const [label, count] of Object.entries(counts)) {
    const pct = ((count / sampleSize) * 100).toFixed(2);
    const bar = "█".repeat(Math.floor(Number(pct) / 2));
    console.log(`${label.padEnd(18)} ${String(count).padStart(5)}  ${pct.padStart(5)}%  ${bar}`);
  }
  console.log("─".repeat(50));

  // Trait breakdown
  console.log("\n📊 Trait Category Breakdown:\n");
  const traitCounts: Record<string, Record<string, number>> = {};
  for (let i = 0; i < Math.min(sampleSize, 1000); i++) {
    const seed = BigInt(`0x${(i * 0xdeadbeef).toString(16).padStart(64, "0")}`);
    const traits = traitsFromSeed(seed);
    for (const [cat, trait] of Object.entries(traits)) {
      if (!traitCounts[cat]) traitCounts[cat] = {};
      traitCounts[cat][trait.value] = (traitCounts[cat][trait.value] ?? 0) + 1;
    }
  }

  for (const [cat, values] of Object.entries(traitCounts)) {
    console.log(`  ${cat.toUpperCase()}:`);
    const sorted = Object.entries(values).sort(([,a],[,b]) => b - a);
    for (const [v, c] of sorted.slice(0, 5)) {
      const pct = ((c / 1000) * 100).toFixed(1);
      console.log(`    ${v.padEnd(20)} ${pct}%`);
    }
  }
}

// Run if called directly
if (require.main === module) {
  simulateDistribution(10_000);
}
