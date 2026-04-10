"use client";

/**
 * Local Preview Tool — /preview
 *
 * Browse and test Lollie NFT generation without deploying.
 * Useful for:
 *   - Checking how traits look at different seeds
 *   - Verifying rarity distribution
 *   - Showing off the collection to partners/investors
 *
 * Visit http://localhost:3000/preview while running `npm run dev`
 */

import { useState, useEffect } from "react";
import { traitsFromSeed, rarityScore, rarityLabel, PALETTES, SHAPES, PATTERNS, BACKGROUNDS, STICKS, EFFECTS } from "@/lib/traits";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function randomSeed(): string {
  const hex = Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join("");
  return `0x${hex}`;
}

function deterministicSeed(tokenId: number): string {
  const base = BigInt(`0x${"a".repeat(64)}`) ^ BigInt(tokenId * 0xdeadbeef);
  return `0x${base.toString(16).padStart(64, "0")}`;
}

const RARITY_COLORS: Record<string, string> = {
  "⬛ Legendary": "#FFD700",
  "🟣 Rare":      "#A855F7",
  "🔵 Uncommon":  "#4ECDC4",
  "⬜ Common":    "#9CA3AF",
};

// ─── Single card ──────────────────────────────────────────────────────────────
function LollieCard({ tokenId, seed }: { tokenId: number; seed: string }) {
  const traits = traitsFromSeed(seed);
  const score  = rarityScore(traits);
  const label  = rarityLabel(score);

  return (
    <div style={{
      background: "#111",
      borderRadius: "16px",
      overflow: "hidden",
      border: `1px solid ${RARITY_COLORS[label]}44`,
      transition: "transform 0.2s",
      cursor: "pointer",
    }}
      onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.03)")}
      onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
    >
      {/* SVG preview via API */}
      <img
        src={`/api/rare/${tokenId}?format=svg&seed=${encodeURIComponent(seed)}`}
        alt={`Lollie #${tokenId}`}
        width={250}
        height={250}
        style={{ display: "block", width: "100%", aspectRatio: "1" }}
      />
      <div style={{ padding: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <span style={{ fontFamily: "monospace", fontSize: "13px", fontWeight: "bold", color: "#fff" }}>
            Lollie #{tokenId}
          </span>
          <span style={{
            fontSize: "10px", padding: "2px 8px", borderRadius: "99px",
            background: `${RARITY_COLORS[label]}22`,
            color: RARITY_COLORS[label], fontFamily: "monospace",
          }}>
            {label}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
          {[
            ["Palette",    traits.palette.value],
            ["Shape",      traits.shape.value],
            ["Pattern",    traits.pattern.value],
            ["Background", traits.background.value],
            ["Stick",      traits.stick.value],
            ["Effect",     traits.effect.value],
          ].map(([k, v]) => (
            <div key={k} style={{ fontSize: "10px", color: "#ffffff66" }}>
              <span style={{ color: "#ffffff33" }}>{k}: </span>
              <span style={{ color: "#fff" }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: "8px", fontSize: "9px", color: "#ffffff22", fontFamily: "monospace", wordBreak: "break-all" }}>
          seed: {seed.slice(0, 18)}...
        </div>
      </div>
    </div>
  );
}

// ─── Rarity distribution bar ──────────────────────────────────────────────────
function RarityStats({ seeds }: { seeds: string[] }) {
  const counts = { "⬛ Legendary": 0, "🟣 Rare": 0, "🔵 Uncommon": 0, "⬜ Common": 0 };
  seeds.forEach(s => {
    const traits = traitsFromSeed(s);
    const label  = rarityLabel(rarityScore(traits));
    counts[label as keyof typeof counts]++;
  });

  return (
    <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "24px" }}>
      {Object.entries(counts).map(([label, count]) => (
        <div key={label} style={{
          background: `${RARITY_COLORS[label]}11`,
          border: `1px solid ${RARITY_COLORS[label]}44`,
          borderRadius: "10px",
          padding: "10px 16px",
          textAlign: "center",
          minWidth: "100px",
        }}>
          <p style={{ fontSize: "20px", fontFamily: "monospace", fontWeight: "bold", color: RARITY_COLORS[label] }}>
            {count}
          </p>
          <p style={{ fontSize: "10px", color: RARITY_COLORS[label], opacity: 0.7 }}>{label}</p>
          <p style={{ fontSize: "10px", color: "#ffffff33" }}>
            {((count / seeds.length) * 100).toFixed(1)}%
          </p>
        </div>
      ))}
    </div>
  );
}

// ─── Main preview page ────────────────────────────────────────────────────────
export default function PreviewPage() {
  const [mode, setMode]           = useState<"gallery" | "single" | "traits">("gallery");
  const [count, setCount]         = useState(12);
  const [seeds, setSeeds]         = useState<string[]>([]);
  const [manualSeed, setManualSeed] = useState(randomSeed());
  const [tokenId, setTokenId]     = useState(1000);

  // Generate token IDs and seeds
  useEffect(() => {
    const s = Array.from({ length: count }, (_, i) => deterministicSeed(1000 + i));
    setSeeds(s);
  }, [count]);

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0f",
      color: "#fff",
      fontFamily: "monospace",
      padding: "24px",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Bebas+Neue&display=swap');
        input, select { background: #1a1a2e; color: #fff; border: 1px solid #ffffff22; border-radius: 8px; padding: 8px 12px; font-family: monospace; }
        button { cursor: pointer; border: none; border-radius: 8px; padding: 8px 16px; font-family: monospace; font-size: 12px; }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: "32px" }}>
        <h1 style={{ fontFamily: "'Bebas Neue'", fontSize: "36px", color: "#FF4D6D", letterSpacing: "3px", margin: 0 }}>
          🍬 SPINMINT LOLLIE PREVIEW
        </h1>
        <p style={{ color: "#ffffff44", fontSize: "12px", margin: "4px 0 0" }}>
          Local dev preview tool — not visible in production
        </p>
      </div>

      {/* Mode tabs */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
        {(["gallery", "single", "traits"] as const).map(m => (
          <button key={m} onClick={() => setMode(m)} style={{
            background: mode === m ? "#FF4D6D" : "#1a1a2e",
            color: mode === m ? "#000" : "#fff",
            fontWeight: mode === m ? "bold" : "normal",
            textTransform: "uppercase",
            letterSpacing: "1px",
          }}>
            {m}
          </button>
        ))}
      </div>

      {/* ── Gallery mode ── */}
      {mode === "gallery" && (
        <>
          <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "24px" }}>
            <label style={{ color: "#ffffff66", fontSize: "12px" }}>Show:</label>
            <select value={count} onChange={e => setCount(Number(e.target.value))}>
              {[6, 12, 24, 48].map(n => <option key={n} value={n}>{n} tokens</option>)}
            </select>
            <button
              onClick={() => setSeeds(Array.from({ length: count }, () => randomSeed()))}
              style={{ background: "#A855F7", color: "#fff" }}
            >
              🎲 Randomize
            </button>
            <button
              onClick={() => setSeeds(Array.from({ length: count }, (_, i) => deterministicSeed(1000 + i)))}
              style={{ background: "#1a1a2e", color: "#fff" }}
            >
              Reset
            </button>
          </div>

          {seeds.length > 0 && <RarityStats seeds={seeds} />}

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: "16px",
          }}>
            {seeds.map((seed, i) => (
              <LollieCard key={seed} tokenId={1000 + i} seed={seed} />
            ))}
          </div>
        </>
      )}

      {/* ── Single mode ── */}
      {mode === "single" && (
        <div style={{ display: "flex", gap: "32px", flexWrap: "wrap" }}>
          <div style={{ flex: "0 0 300px" }}>
            <img
              src={`/api/rare/${tokenId}?format=svg`}
              alt={`Lollie #${tokenId}`}
              style={{ width: "100%", borderRadius: "16px", border: "1px solid #ffffff11" }}
            />
          </div>
          <div style={{ flex: 1, minWidth: "280px" }}>
            <h2 style={{ color: "#FF4D6D", marginBottom: "16px" }}>Token #{tokenId}</h2>

            <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
              <div>
                <label style={{ display: "block", fontSize: "11px", color: "#ffffff44", marginBottom: "4px" }}>Token ID</label>
                <input
                  type="number"
                  value={tokenId}
                  min={1000}
                  onChange={e => setTokenId(Number(e.target.value))}
                  style={{ width: "100px" }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: "11px", color: "#ffffff44", marginBottom: "4px" }}>
                  Seed (hex)
                </label>
                <input
                  value={manualSeed}
                  onChange={e => setManualSeed(e.target.value)}
                  style={{ width: "100%", fontSize: "11px" }}
                  placeholder="0x..."
                />
              </div>
            </div>

            <button onClick={() => setManualSeed(randomSeed())} style={{ background: "#A855F7", color: "#fff", marginBottom: "24px" }}>
              🎲 Random Seed
            </button>

            <h3 style={{ color: "#ffffff66", fontSize: "12px", marginBottom: "12px", letterSpacing: "2px" }}>TRAITS</h3>
            {(() => {
              const traits = traitsFromSeed(manualSeed || deterministicSeed(tokenId));
              const score  = rarityScore(traits);
              const label  = rarityLabel(score);
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{
                    padding: "8px 16px", borderRadius: "8px",
                    background: `${RARITY_COLORS[label]}22`,
                    border: `1px solid ${RARITY_COLORS[label]}44`,
                    color: RARITY_COLORS[label], fontWeight: "bold",
                  }}>
                    {label} — score {score.toLocaleString()}
                  </div>
                  {[
                    ["🎨 Palette",    traits.palette.value,    traits.palette.rarity],
                    ["🔵 Shape",      traits.shape.value,      traits.shape.rarity],
                    ["✨ Pattern",    traits.pattern.value,    traits.pattern.rarity],
                    ["🌄 Background", traits.background.value, traits.background.rarity],
                    ["🪄 Stick",      traits.stick.value,      traits.stick.rarity],
                    ["💫 Effect",     traits.effect.value,     traits.effect.rarity],
                  ].map(([icon, value, rarity]) => (
                    <div key={icon as string} style={{
                      display: "flex", justifyContent: "space-between",
                      padding: "8px 12px", background: "#ffffff08",
                      borderRadius: "8px", fontSize: "13px",
                    }}>
                      <span style={{ color: "#ffffff88" }}>{icon as string}</span>
                      <span style={{ color: "#fff" }}>{value as string}</span>
                      <span style={{ color: "#ffffff33", fontSize: "11px" }}>{rarity as string}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Traits reference ── */}
      {mode === "traits" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
          {[
            { cat: PALETTES,    label: "🎨 Palettes" },
            { cat: SHAPES,      label: "🔵 Shapes" },
            { cat: PATTERNS,    label: "✨ Patterns" },
            { cat: BACKGROUNDS, label: "🌄 Backgrounds" },
            { cat: STICKS,      label: "🪄 Sticks" },
            { cat: EFFECTS,     label: "💫 Effects" },
          ].map(({ cat, label }) => (
            <div key={label}>
              <h3 style={{ color: "#FF4D6D", marginBottom: "12px", letterSpacing: "2px" }}>{label}</h3>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {cat.traits.map(t => {
                  const rarityColor = {
                    Common: "#9CA3AF", Uncommon: "#60A5FA",
                    Rare: "#4ECDC4", Epic: "#A855F7", Legendary: "#FFD700",
                  }[t.rarity as "Common" | "Uncommon" | "Rare" | "Epic" | "Legendary"];
                  return (
                    <div key={t.value} style={{
                      padding: "6px 12px", borderRadius: "8px",
                      background: `${rarityColor}11`,
                      border: `1px solid ${rarityColor}44`,
                      fontSize: "12px",
                    }}>
                      <span style={{ color: "#fff" }}>{t.value}</span>
                      <span style={{ color: rarityColor, marginLeft: "8px", fontSize: "10px" }}>
                        {t.rarity} ({t.weight}w)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
