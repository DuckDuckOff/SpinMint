/**
 * Peppermint Lollie — Trait System
 *
 * Every rare NFT is a unique procedurally-generated peppermint lollie.
 * Traits are derived deterministically from the on-chain seed so the
 * same token ID always renders identically — no IPFS, no server state.
 *
 * Rarity tiers:
 *   Common    (weight 50)
 *   Uncommon  (weight 30)
 *   Rare      (weight 15)
 *   Legendary (weight  5)
 */

export type RarityTier = "Common" | "Uncommon" | "Rare" | "Epic" | "Legendary";

export interface Trait {
  value: string;
  rarity: RarityTier;
  weight: number;
}

export interface TraitCategory<T extends Trait = Trait> {
  name: string;
  traits: T[];
}

// ─── Colour palettes ──────────────────────────────────────────────────────────
export interface ColorTrait extends Trait {
  primary: string;
  secondary: string;
  accent: string;
  glow: string;
}

export const PALETTES: TraitCategory<ColorTrait> = {
  name: "Palette",
  traits: [
    // Common
    { value: "Classic Mint",    rarity: "Common",    weight: 50, primary: "#FF4D6D", secondary: "#FFFFFF", accent: "#FF8FAB", glow: "#FF4D6D66" },
    { value: "Spearmint",       rarity: "Common",    weight: 45, primary: "#2ECC71", secondary: "#FFFFFF", accent: "#A8E6CF", glow: "#2ECC7166" },
    { value: "Candy Cane",      rarity: "Common",    weight: 40, primary: "#E63946", secondary: "#F1FAEE", accent: "#457B9D", glow: "#E6394666" },
    // Uncommon
    { value: "Bubblegum",       rarity: "Uncommon",  weight: 30, primary: "#FF85A1", secondary: "#FFC8DD", accent: "#FFAFCC", glow: "#FF85A166" },
    { value: "Arctic Blast",    rarity: "Uncommon",  weight: 28, primary: "#48CAE4", secondary: "#FFFFFF", accent: "#90E0EF", glow: "#48CAE466" },
    { value: "Sunset Swirl",    rarity: "Uncommon",  weight: 25, primary: "#FF6B35", secondary: "#FFDD57", accent: "#FF9F1C", glow: "#FF6B3566" },
    { value: "Grape Frost",     rarity: "Uncommon",  weight: 22, primary: "#9B5DE5", secondary: "#F0DFFF", accent: "#C77DFF", glow: "#9B5DE566" },
    // Rare
    { value: "Cosmic Berry",    rarity: "Rare",      weight: 15, primary: "#5E0D97", secondary: "#FF6BFF", accent: "#FF9CEE", glow: "#FF6BFF88" },
    { value: "Glacier",         rarity: "Rare",      weight: 12, primary: "#00F5FF", secondary: "#001AFF", accent: "#80FFFF", glow: "#00F5FF88" },
    { value: "Lava Mint",       rarity: "Rare",      weight: 10, primary: "#FF0000", secondary: "#FF8C00", accent: "#FFDD00", glow: "#FF000088" },
    // Legendary
    { value: "Prismatic",       rarity: "Legendary", weight: 5,  primary: "#FF0080", secondary: "#00FF80", accent: "#8000FF", glow: "#FFFFFF99" },
    { value: "Void Mint",       rarity: "Legendary", weight: 3,  primary: "#0D0D0D", secondary: "#00FF41", accent: "#39FF14", glow: "#39FF1499" },
    { value: "Golden Swirl",    rarity: "Legendary", weight: 2,  primary: "#FFD700", secondary: "#FFF8DC", accent: "#FFA500", glow: "#FFD70099" },
  ],
};

// ─── Lollie shape ─────────────────────────────────────────────────────────────
export interface ShapeTrait extends Trait {
  swirls: number;       // number of spiral arms
  size: number;         // radius multiplier 0.8–1.2
  strokeWidth: number;
}

export const SHAPES: TraitCategory<ShapeTrait> = {
  name: "Shape",
  traits: [
    { value: "Classic Round",   rarity: "Common",    weight: 50, swirls: 4, size: 1.0, strokeWidth: 8  },
    { value: "Petite",          rarity: "Common",    weight: 40, swirls: 3, size: 0.8, strokeWidth: 6  },
    { value: "Chunky",          rarity: "Uncommon",  weight: 30, swirls: 5, size: 1.1, strokeWidth: 10 },
    { value: "Oversized",       rarity: "Uncommon",  weight: 25, swirls: 6, size: 1.2, strokeWidth: 12 },
    { value: "Spiral Crown",    rarity: "Rare",      weight: 12, swirls: 8, size: 1.0, strokeWidth: 7  },
    { value: "Twin Swirl",      rarity: "Rare",      weight: 10, swirls: 2, size: 1.0, strokeWidth: 14 },
    { value: "Mega Lollie",     rarity: "Legendary", weight: 4,  swirls: 12, size: 1.3, strokeWidth: 6 },
  ],
};

// ─── Pattern / overlay ────────────────────────────────────────────────────────
export interface PatternTrait extends Trait {
  type: "none" | "dots" | "stars" | "hearts" | "sparkles" | "checkers" | "glitch";
}

export const PATTERNS: TraitCategory<PatternTrait> = {
  name: "Pattern",
  traits: [
    { value: "None",        rarity: "Common",    weight: 50, type: "none"     },
    { value: "Dots",        rarity: "Common",    weight: 35, type: "dots"     },
    { value: "Stars",       rarity: "Uncommon",  weight: 25, type: "stars"    },
    { value: "Hearts",      rarity: "Uncommon",  weight: 20, type: "hearts"   },
    { value: "Sparkles",    rarity: "Rare",      weight: 12, type: "sparkles" },
    { value: "Checkers",    rarity: "Rare",      weight: 8,  type: "checkers" },
    { value: "Glitch",      rarity: "Legendary", weight: 3,  type: "glitch"   },
  ],
};

// ─── Background ───────────────────────────────────────────────────────────────
export interface BackgroundTrait extends Trait {
  from: string;
  to: string;
  type: "solid" | "radial" | "linear" | "space";
}

export const BACKGROUNDS: TraitCategory<BackgroundTrait> = {
  name: "Background",
  traits: [
    { value: "Midnight",      rarity: "Common",    weight: 45, from: "#0a0a0f", to: "#1a0a2e", type: "radial" },
    { value: "Candy Shop",    rarity: "Common",    weight: 40, from: "#FFE4E1", to: "#FFC0CB", type: "linear" },
    { value: "Deep Ocean",    rarity: "Uncommon",  weight: 28, from: "#001845", to: "#023E8A", type: "radial" },
    { value: "Minty Fresh",   rarity: "Uncommon",  weight: 25, from: "#D8F3DC", to: "#B7E4C7", type: "linear" },
    { value: "Neon Nights",   rarity: "Rare",      weight: 12, from: "#10002B", to: "#240046", type: "radial" },
    { value: "Aurora",        rarity: "Rare",      weight: 10, from: "#00204A", to: "#005C97", type: "linear" },
    { value: "Void",          rarity: "Legendary", weight: 5,  from: "#000000", to: "#0D0D0D", type: "space"  },
    { value: "Cotton Candy",  rarity: "Legendary", weight: 3,  from: "#FF9CEE", to: "#FFDDE1", type: "radial" },
  ],
};

// ─── Stick ────────────────────────────────────────────────────────────────────
export interface StickTrait extends Trait {
  color: string;
  style: "plain" | "striped" | "metallic" | "rainbow";
}

export const STICKS: TraitCategory<StickTrait> = {
  name: "Stick",
  traits: [
    { value: "White",       rarity: "Common",    weight: 50, color: "#F5F5F5", style: "plain"    },
    { value: "Natural",     rarity: "Common",    weight: 40, color: "#D4A96A", style: "plain"    },
    { value: "Striped",     rarity: "Uncommon",  weight: 28, color: "#FF6B6B", style: "striped"  },
    { value: "Metallic",    rarity: "Rare",      weight: 12, color: "#C0C0C0", style: "metallic" },
    { value: "Gold",        rarity: "Rare",      weight: 8,  color: "#FFD700", style: "metallic" },
    { value: "Rainbow",     rarity: "Legendary", weight: 4,  color: "#FF0000", style: "rainbow"  },
  ],
};

// ─── Special effects ──────────────────────────────────────────────────────────
export interface EffectTrait extends Trait {
  type: "none" | "glow" | "sparkle" | "halo" | "rainbow-glow" | "matrix";
}

export const EFFECTS: TraitCategory<EffectTrait> = {
  name: "Effect",
  traits: [
    { value: "None",          rarity: "Common",    weight: 50, type: "none"         },
    { value: "Soft Glow",     rarity: "Common",    weight: 35, type: "glow"         },
    { value: "Sparkle",       rarity: "Uncommon",  weight: 22, type: "sparkle"      },
    { value: "Halo",          rarity: "Rare",      weight: 12, type: "halo"         },
    { value: "Rainbow Glow",  rarity: "Legendary", weight: 5,  type: "rainbow-glow" },
    { value: "Matrix Rain",   rarity: "Legendary", weight: 2,  type: "matrix"       },
  ],
};

// ─── Trait resolution from seed ───────────────────────────────────────────────

/** Pick a trait from a weighted list using a portion of the seed */
export function pickTrait<T extends Trait>(category: TraitCategory<T>, seedSlice: bigint): T {
  const totalWeight = category.traits.reduce((sum, t) => sum + t.weight, 0);
  let roll = Number(seedSlice % BigInt(totalWeight));
  for (const trait of category.traits) {
    if (roll < trait.weight) return trait;
    roll -= trait.weight;
  }
  return category.traits[0];
}

/** Derive all traits from a uint256 seed (as hex string or bigint) */
export function traitsFromSeed(seed: string | bigint) {
  const s = typeof seed === "string" ? BigInt(seed) : seed;

  // Slice the seed into 6 independent 40-bit windows
  const slice = (shift: number) => (s >> BigInt(shift)) & BigInt("0xFFFFFFFFFF");

  return {
    palette:    pickTrait(PALETTES,    slice(0)),
    shape:      pickTrait(SHAPES,      slice(40)),
    pattern:    pickTrait(PATTERNS,    slice(80)),
    background: pickTrait(BACKGROUNDS, slice(120)),
    stick:      pickTrait(STICKS,      slice(160)),
    effect:     pickTrait(EFFECTS,     slice(200)),
  };
}

/** Compute overall rarity score (lower = rarer) */
export function rarityScore(traits: ReturnType<typeof traitsFromSeed>): number {
  const weights = Object.values(traits).map(t => t.weight);
  return weights.reduce((product, w) => product * w, 1);
}

export function rarityLabel(score: number): string {
  if (score < 500)     return "Legendary";
  if (score < 5_000)   return "Epic";
  if (score < 30_000)  return "Rare";
  if (score < 150_000) return "Uncommon";
  return "Common";
}

export const RARITY_COLORS: Record<string, { color: string; glow: string }> = {
  Legendary: { color: "#FFD700", glow: "#FFD70099" },
  Epic:      { color: "#A855F7", glow: "#A855F799" },
  Rare:      { color: "#4ECDC4", glow: "#4ECDC499" },
  Uncommon:  { color: "#60A5FA", glow: "#60A5FA99" },
  Common:    { color: "#9CA3AF", glow: "#9CA3AF66" },
};
