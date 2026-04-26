"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { traitsFromSeed, rarityScore, rarityLabel, RARITY_COLORS } from "../lib/traits";
import { generateSVG } from "../lib/svgGenerator";
import { useTonConnectUI, useTonAddress, useTonWallet } from "@tonconnect/ui-react";
import { Address, beginCell, toNano, fromNano } from "@ton/ton";
import { tonClient } from "../lib/tonClient";

// ─── Config ───────────────────────────────────────────────────────────────────
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? "";
// Spin opcode matches Tact message(0x7370696e) Spin {}
const SPIN_PAYLOAD      = beginCell().storeUint(0x7370696e, 32).endCell().toBoc().toString("base64");
const CLAIM_PAYLOAD     = beginCell().storeUint(0x636c6169, 32).endCell().toBoc().toString("base64");
const FREE_SPIN_PAYLOAD = beginCell().storeUint(0x66726565, 32).endCell().toBoc().toString("base64");
const JETTON_MASTER     = process.env.NEXT_PUBLIC_JETTON_MASTER ?? "";


// ─── Prize config ─────────────────────────────────────────────────────────────
const PRIZES = [
  { label: "JACKPOT",  tier: 0, color: "#FFD700", dark: "#FF8C00" },
  { label: "5 TON",    tier: 1, color: "#FF4785", dark: "#CC1155" },
  { label: "1.5 TON",  tier: 2, color: "#00E5FF", dark: "#0099BB" },
  { label: "3K $SM",   tier: 3, color: "#CC44FF", dark: "#8800CC" },
  { label: "2K $SM",   tier: 4, color: "#FF7A00", dark: "#CC4400" },
  { label: "FREE!",    tier: 5, color: "#00E676", dark: "#00AA44" },
  { label: "50 $SM",   tier: 6, color: "#FF6B6B", dark: "#CC2222" },
];

// 12 segments clockwise from top — matches wheel image
const SEGMENTS = [
  PRIZES[3], // 3K $SM
  PRIZES[6], // 50 $SM
  PRIZES[2], // 1.5 TON
  PRIZES[6], // 50 $SM
  PRIZES[4], // 2K $SM
  PRIZES[5], // FREE!
  PRIZES[6], // 50 $SM
  PRIZES[3], // 3K $SM
  PRIZES[6], // 50 $SM
  PRIZES[1], // 5 TON
  PRIZES[4], // 2K $SM
  PRIZES[0], // JACKPOT
];

type Phase = "idle" | "minting" | "spinning" | "reveal";

// ─── Audio engine ─────────────────────────────────────────────────────────────
let _ctx: AudioContext | null = null;
let _ambientStop: (() => void) | null = null;
let _mutedGlobal = false;

function getCtx(): AudioContext | null {
  try {
    if (!_ctx) _ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (_ctx.state === "suspended") _ctx.resume();
    return _ctx;
  } catch { return null; }
}

function playTick(speed: number) {
  if (_mutedGlobal) return;
  const ctx = getCtx(); if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    const slowness = 1 - Math.min(Math.max(speed, 0), 1);
    osc.type = "square";
    osc.frequency.value = 280 + slowness * 520;
    gain.gain.setValueAtTime(0.07 + slowness * 0.13, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05 + slowness * 0.04);
    osc.start(); osc.stop(ctx.currentTime + 0.09);
  } catch {}
}

function playWin(tier: number) {
  if (_mutedGlobal) return;
  const ctx = getCtx(); if (!ctx) return;
  try {
    if (tier === 4) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = "sine";
      o.frequency.setValueAtTime(320, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(160, ctx.currentTime + 0.7);
      g.gain.setValueAtTime(0.18, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      o.start(); o.stop(ctx.currentTime + 0.8);
      return;
    }
    const noteGroups = [
      [523, 659, 784, 1047, 1319, 1568, 2093],
      [523, 659, 784, 1047, 1319],
      [523, 659, 784, 1047],
      [523, 659, 784],
    ];
    const notes = noteGroups[tier] ?? noteGroups[3];
    const gap = tier === 0 ? 0.055 : 0.08;
    notes.forEach((freq, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = tier === 0 ? "triangle" : "sine";
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = freq;
      const t = ctx.currentTime + i * gap;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(tier === 0 ? 0.35 : 0.22, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.start(t); o.stop(t + 0.4);
    });
    if (tier === 0) {
      // Jackpot boom
      const bufSize = Math.floor(ctx.sampleRate * 0.2);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 2);
      const src = ctx.createBufferSource();
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = 180;
      src.buffer = buf; src.connect(f); f.connect(g); g.connect(ctx.destination);
      g.gain.value = 0.6; src.start();
    }
  } catch {}
}

let _ambientAudio: HTMLAudioElement | null = null;

function startAmbient() {
  if (_mutedGlobal) return;
  if (!_ambientAudio) {
    _ambientAudio = new Audio("/ambient.mp3");
    _ambientAudio.loop   = true;
    _ambientAudio.volume = 0.15;
  }
  _ambientAudio.play().catch(() => {}); // silently ignore if blocked
  _ambientStop = () => {
    _ambientAudio?.pause();
    if (_ambientAudio) _ambientAudio.currentTime = 0;
  };
}

function stopAmbient() { _ambientStop?.(); _ambientStop = null; }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(nanotons: bigint) {
  return `${parseFloat(fromNano(nanotons)).toFixed(2)} TON`;
}

// ─── Particle system ──────────────────────────────────────────────────────────
interface Particle {
  id: number; x: number; y: number; vx: number; vy: number;
  color: string; size: number; life: number; rot: number; rotV: number;
  shape: "circle" | "rect";
}
let _pid = 0;
function burst(tier: number, n: number): Particle[] {
  const palettes = [
    ["#FFD700", "#FF8C00", "#FFF8DC", "#FFEC6E"],   // 0 jackpot
    ["#FF4785", "#FF99BB", "#FFB3CC", "#CC1155"],   // 1 big win
    ["#00E5FF", "#66F0FF", "#B3F8FF", "#0099BB"],   // 2 ton win
    ["#CC44FF", "#E088FF", "#F0CCFF", "#8800CC"],   // 3 sm big
    ["#FF7A00", "#FFA855", "#FFCC99", "#CC4400"],   // 4 sm small
    ["#00E676", "#66F5A8", "#B3FAD4", "#00AA44"],   // 5 free spin
    ["#FF6B6B", "#FF9999", "#FFCCCC", "#CC2222"],   // 6 try again
  ];
  const pal = palettes[tier] ?? palettes[4];
  return Array.from({ length: n }, () => {
    const a = Math.random() * 2 * Math.PI;
    const spd = 1.5 + Math.random() * (tier === 0 ? 7 : 4);
    return {
      id: _pid++, x: 50, y: 38,
      vx: Math.cos(a) * spd, vy: Math.sin(a) * spd - 2.5,
      color: pal[Math.floor(Math.random() * pal.length)],
      size: 4 + Math.random() * (tier === 0 ? 12 : 7),
      life: 1, rot: Math.random() * 360, rotV: (Math.random() - 0.5) * 12,
      shape: Math.random() > 0.4 ? "rect" : "circle",
    };
  });
}

// ─── Wheel (SVG) ──────────────────────────────────────────────────────────────
function useWheelSize() {
  const [size, setSize] = useState(260);
  useEffect(() => {
    const calc = () => {
      const available = Math.min(window.innerHeight - 340, window.innerWidth - 40);
      setSize(Math.max(212, Math.min(307, available)));
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);
  return size;
}

const WHEEL_IMG = "https://res.cloudinary.com/dr38zeh9b/image/upload/v1777213161/Screenshot_2026-04-27_001848_lxiozl.png";

function SpinWheel({ spinning, winTier, onSpinEnd, onTick, size }: {
  spinning: boolean; winTier: number | null;
  onSpinEnd: () => void; onTick: (speed: number) => void;
  size: number;
}) {
  const wheelRef   = useRef<HTMLDivElement>(null);
  const angleRef   = useRef(0);
  const rafRef     = useRef<number>(0);
  const lastSegRef = useRef(-1);

  const padded = size + 48;
  const cx     = padded / 2;
  const cy     = padded / 2;
  const r      = size / 2;
  const slice  = (2 * Math.PI) / SEGMENTS.length;

  const setWheelAngle = useCallback((ang: number) => {
    if (wheelRef.current) {
      wheelRef.current.style.transform = `rotate(${(ang * 180 / Math.PI).toFixed(3)}deg)`;
    }
  }, []);

  useEffect(() => { setWheelAngle(angleRef.current); }, [setWheelAngle, size]);

  useEffect(() => {
    if (!spinning) return;
    const targetIdx = winTier !== null
      ? Math.max(0, SEGMENTS.findIndex(s => s.tier === winTier))
      : Math.floor(Math.random() * SEGMENTS.length);
    const targetAngle = -Math.PI / 2 - (targetIdx * slice + slice / 2);
    const spins       = 6 + Math.random() * 3;
    const finalAngle  = targetAngle - spins * 2 * Math.PI;
    const startAng    = angleRef.current;
    const duration    = 4200;
    const startTime   = performance.now();
    function ease(t: number) { return 1 - Math.pow(1 - t, 4); }
    function frame(now: number) {
      const t   = Math.min((now - startTime) / duration, 1);
      const ang = startAng + (finalAngle - startAng) * ease(t);
      const rel = ((-ang - Math.PI / 2) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      const seg = Math.floor(rel / slice) % SEGMENTS.length;
      if (seg !== lastSegRef.current) {
        lastSegRef.current = seg;
        onTick(1 - ease(t));
      }
      angleRef.current = ang;
      setWheelAngle(ang);
      if (t < 1) { rafRef.current = requestAnimationFrame(frame); }
      else { setWheelAngle(finalAngle); onSpinEnd(); }
    }
    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [spinning, winTier, slice, onTick, onSpinEnd, setWheelAngle]);

  return (
    <div style={{ position: "relative", width: padded, height: padded, flexShrink: 0 }}>
      {/* Spinning wheel image */}
      <div
        ref={wheelRef}
        style={{
          position: "absolute",
          top: 24, left: 24,
          width: size, height: size,
          borderRadius: "50%",
          overflow: "hidden",
          transformOrigin: "center center",
          boxShadow: "0 0 32px #FF478566, 0 0 64px #FF478522",
        }}
      >
        <img
          src={WHEEL_IMG}
          alt="SpinMint wheel"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          crossOrigin="anonymous"
        />
      </div>

      {/* Fixed pointer + outer glow overlay */}
      <svg
        width={padded} height={padded}
        style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
      >
        <defs>
          <filter id="ptrglow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        {/* Candy pointer */}
        <polygon
          points={`${cx},${cy - r - 4} ${cx - 13},${cy - r + 26} ${cx + 13},${cy - r + 26}`}
          fill="#FF1744" stroke="white" strokeWidth="2.5"
          filter="url(#ptrglow)"
        />
        <line
          x1={cx - 3} y1={cy - r - 1}
          x2={cx - 7} y2={cy - r + 18}
          stroke="rgba(255,255,255,0.6)" strokeWidth="2.5" strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

// ─── Win Celebration ──────────────────────────────────────────────────────────
function WinCelebration({ tier, onClose }: { tier: number; onClose: () => void }) {
  const [particles, setParticles] = useState<Particle[]>(() => burst(tier, tier === 0 ? 90 : tier === 6 ? 12 : 45));
  const [flash, setFlash] = useState(true);
  const rafRef = useRef<number>(0);

  const prize = PRIZES.find(p => p.tier === tier) ?? PRIZES[6];
  const MSGS = {
    0: { title: "JACKPOT!!!",  sub: "The entire pool is YOURS!",          emoji: "💰" },
    1: { title: "BIG WIN!",    sub: "5 TON sent to your wallet",          emoji: "🔥" },
    2: { title: "TON WIN!",    sub: "1.5 TON sent to your wallet",        emoji: "✨" },
    3: { title: "SPINMINT!",   sub: "3,000 $SM on its way to you",        emoji: "🍬" },
    4: { title: "SPINMINT!",   sub: "2,000 $SM on its way to you",        emoji: "🍬" },
    5: { title: "FREE SPIN!",  sub: "150 $SM + a free spin banked!",      emoji: "🎁" },
    6: { title: "TRY AGAIN",   sub: "50 $SM consolation — keep spinning", emoji: "🎰" },
  };
  const msg = MSGS[tier as keyof typeof MSGS] ?? MSGS[4];

  useEffect(() => {
    let alive = true;
    function tick() {
      if (!alive) return;
      setParticles(prev => prev
        .map(p => ({ ...p, x: p.x + p.vx * 0.9, y: p.y + p.vy * 0.9, vy: p.vy + 0.12, life: p.life - 0.009, rot: p.rot + p.rotV }))
        .filter(p => p.life > 0)
      );
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);

    // Flash strobe
    const flashId = setInterval(() => setFlash(f => !f), 130);
    const stopId  = setTimeout(() => clearInterval(flashId), tier === 0 ? 3500 : 1000);

    return () => { alive = false; cancelAnimationFrame(rafRef.current); clearInterval(flashId); clearTimeout(stopId); };
  }, [tier]);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: `${prize.color}${tier === 0 ? "1a" : "0d"}`,
      backdropFilter: "blur(6px)",
    }}>
      {/* Particles */}
      {particles.map(p => (
        <div key={p.id} style={{
          position: "absolute",
          left: `${p.x}%`, top: `${p.y}%`,
          width: p.size, height: p.size,
          borderRadius: p.shape === "circle" ? "50%" : "2px",
          background: p.color,
          opacity: Math.min(p.life * 1.5, 1),
          transform: `rotate(${p.rot}deg)`,
          pointerEvents: "none",
          boxShadow: `0 0 ${p.size}px ${p.color}`,
        }} />
      ))}

      {/* Tier badge banner for wins */}
      {tier !== 6 && (
        <div style={{
          position: "absolute", top: 24, left: 0, right: 0,
          textAlign: "center",
          fontFamily: "'Space Mono',monospace",
          fontSize: 11, letterSpacing: 6,
          color: flash ? prize.color : "#ffffff55",
          textShadow: flash ? `0 0 20px ${prize.color}` : "none",
          transition: "color 0.1s, text-shadow 0.1s",
        }}>
          {[..."YOU'VE WON"].map((c, i) => (
            <span key={i} style={{
              display: "inline-block",
              animation: `ledBlink ${0.2 + i * 0.04}s ease-in-out ${i * 0.03}s infinite alternate`,
            }}>{c === "'" ? c : c}</span>
          ))}
        </div>
      )}

      {/* Panel */}
      <div style={{
        background: "linear-gradient(145deg, #0f0f1a, #0a0a12)",
        border: `2px solid ${prize.color}`,
        borderRadius: 24, padding: "28px 24px",
        textAlign: "center", maxWidth: 290, width: "85%",
        boxShadow: `0 0 60px ${prize.color}55, 0 0 120px ${prize.color}22, inset 0 1px 0 ${prize.color}33`,
        transform: flash && tier !== 6 ? "scale(1.025)" : "scale(1)",
        transition: "transform 0.1s",
        position: "relative", zIndex: 10,
      }}>
        <div style={{ fontSize: 52, lineHeight: 1, marginBottom: 8 }}>{msg.emoji}</div>
        <h2 style={{
          fontFamily: "'Bebas Neue',sans-serif",
          fontSize: tier === 0 ? 50 : 38,
          color: prize.color,
          letterSpacing: 3, margin: "4px 0", lineHeight: 1,
          textShadow: `0 0 30px ${prize.color}, 0 0 60px ${prize.color}55`,
        }}>
          {msg.title}
        </h2>
        <p style={{ color: "#ffffffaa", fontSize: 12, margin: "10px 0 18px", fontFamily: "'Space Mono',monospace" }}>
          {msg.sub}
        </p>
        <button onClick={onClose} style={{
          width: "100%", padding: "13px",
          borderRadius: 12, border: "none",
          background: prize.color, color: "#000",
          fontFamily: "'Space Mono',monospace",
          fontWeight: "bold", fontSize: 12, letterSpacing: 2, cursor: "pointer",
        }}>
          SPIN AGAIN
        </button>
      </div>
    </div>
  );
}

// ─── Animated background ──────────────────────────────────────────────────────
function CasinoBackground() {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none" }}>
      {/* Looping video */}
      <video
        autoPlay loop muted playsInline
        onEnded={e => { (e.target as HTMLVideoElement).play(); }}
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%",
          objectFit: "cover",
          opacity: 0.55,
        }}
      >
        <source src="/bg.mp4" type="video/mp4" />
      </video>
      {/* Dark tint so UI stays readable */}
      <div style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(to bottom, #00000077 0%, #00000044 50%, #00000088 100%)",
      }} />
      {/* Neon grid overlay */}
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.12 }} preserveAspectRatio="none">
        <defs>
          <pattern id="g" width="44" height="44" patternUnits="userSpaceOnUse">
            <path d="M44 0L0 0 0 44" fill="none" stroke="#8B5CF6" strokeWidth="0.6"/>
          </pattern>
          <linearGradient id="gf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="white" stopOpacity="0"/>
            <stop offset="40%" stopColor="white" stopOpacity="1"/>
          </linearGradient>
          <mask id="gm"><rect width="100%" height="100%" fill="url(#gf)"/></mask>
        </defs>
        <rect width="100%" height="100%" fill="url(#g)" mask="url(#gm)"/>
      </svg>
      {/* Fine scanlines */}
      <div style={{
        position: "absolute", inset: 0,
        background: "repeating-linear-gradient(0deg,transparent,transparent 3px,#00000018 3px,#00000018 4px)",
      }} />
      {/* Vignette */}
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse at 50% 50%, transparent 40%, #000000aa 100%)",
      }} />
    </div>
  );
}

// ─── NFT Collectible helpers ──────────────────────────────────────────────────
function randomSeed(): bigint {
  // Build a 256-bit seed from eight 32-bit random chunks
  return Array.from({ length: 8 }, (_, i) =>
    BigInt(Math.floor(Math.random() * 2 ** 32)) << BigInt(i * 32)
  ).reduce((acc, v) => acc | v, 0n);
}

// ─── NFT Collectible Panel ────────────────────────────────────────────────────
function CollectiblePanel({
  onClose,
}: {
  onClose: () => void;
}) {
  const [seed, setSeed] = useState<bigint>(randomSeed);

  const traits = traitsFromSeed(seed);
  const score  = rarityScore(traits);
  const label  = rarityLabel(score);
  const rc     = RARITY_COLORS[label] ?? RARITY_COLORS.Common;
  const svg    = generateSVG(0, seed);
  const svgUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

  const TRAIT_ENTRIES = [
    { name: "Palette",    value: traits.palette.value,    rarity: traits.palette.rarity },
    { name: "Shape",      value: traits.shape.value,      rarity: traits.shape.rarity },
    { name: "Pattern",    value: traits.pattern.value,    rarity: traits.pattern.rarity },
    { name: "Background", value: traits.background.value, rarity: traits.background.rarity },
    { name: "Stick",      value: traits.stick.value,      rarity: traits.stick.rarity },
    { name: "Effect",     value: traits.effect.value,     rarity: traits.effect.rarity },
  ];

  const TRAIT_RARITY_COLORS: Record<string, string> = {
    Legendary: "#FFD700", Epic: "#A855F7", Rare: "#4ECDC4", Uncommon: "#60A5FA", Common: "#9CA3AF",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      display: "flex", flexDirection: "column", justifyContent: "flex-end",
    }} onClick={onClose}>
      {/* Backdrop */}
      <div style={{ position: "absolute", inset: 0, background: "#00000088", backdropFilter: "blur(4px)" }} />

      {/* Panel */}
      <div onClick={e => e.stopPropagation()} style={{
        position: "relative", zIndex: 1,
        background: "linear-gradient(170deg, #0f0f1e, #0a0a14)",
        border: "1px solid #ffffff18",
        borderRadius: "20px 20px 0 0",
        padding: "16px 16px 32px",
        maxHeight: "88vh", overflowY: "auto",
      }}>
        {/* Handle */}
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "#ffffff33", margin: "0 auto 14px" }} />

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <h2 style={{ fontFamily: "'Bebas Neue'", fontSize: 26, letterSpacing: 3, color: "#fff", lineHeight: 1 }}>
              MINT COLLECTIBLE
            </h2>
            <p style={{ fontSize: 9, color: "#ffffff55", letterSpacing: 2 }}>PEPPERMINT LOLLIE NFT  —  $2 USDC</p>
          </div>
          <button onClick={onClose} style={{
            background: "#ffffff11", border: "1px solid #ffffff22",
            borderRadius: 8, padding: "4px 10px", color: "#fff", cursor: "pointer", fontSize: 16,
          }}>✕</button>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          {/* NFT Preview */}
          <div style={{ flexShrink: 0 }}>
            <div style={{
              width: 140, height: 140, borderRadius: 14,
              border: `2px solid ${rc.color}`,
              boxShadow: `0 0 20px ${rc.glow}`,
              overflow: "hidden", background: "#000",
            }}>
              <img src={svgUrl} alt="NFT preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            {/* Rarity badge */}
            <div style={{
              marginTop: 6, textAlign: "center",
              fontFamily: "'Space Mono',monospace",
              fontSize: 10, fontWeight: "bold",
              color: rc.color, textShadow: `0 0 10px ${rc.glow}`,
              letterSpacing: 1,
            }}>
              {label.toUpperCase()}
            </div>
            <div style={{ textAlign: "center", fontSize: 8, color: "#ffffff33", marginTop: 2 }}>
              score: {score.toLocaleString()}
            </div>
          </div>

          {/* Traits */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
            {TRAIT_ENTRIES.map(({ name, value, rarity }) => (
              <div key={name} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "4px 8px", borderRadius: 6,
                background: "#ffffff07", border: "1px solid #ffffff0a",
                fontSize: 9,
              }}>
                <span style={{ color: "#ffffff55", letterSpacing: 1 }}>{name.toUpperCase()}</span>
                <span style={{ color: TRAIT_RARITY_COLORS[rarity] ?? "#fff", fontWeight: "bold" }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Rarity breakdown */}
        <div style={{ marginTop: 12, padding: "8px 10px", borderRadius: 10, background: "#ffffff05", border: "1px solid #ffffff0a" }}>
          <p style={{ fontSize: 8, color: "#ffffff44", letterSpacing: 2, marginBottom: 6 }}>RARITY TIERS</p>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {(["Legendary","Epic","Rare","Uncommon","Common"] as const).map(r => (
              <div key={r} style={{
                padding: "2px 8px", borderRadius: 20,
                background: `${RARITY_COLORS[r].color}22`,
                border: `1px solid ${RARITY_COLORS[r].color}55`,
                fontSize: 8, color: RARITY_COLORS[r].color, letterSpacing: 1,
              }}>{r}</div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button onClick={() => { setSeed(randomSeed()); }} style={{
            flex: 1, padding: "11px", borderRadius: 10,
            background: "transparent", border: "1px solid #ffffff22",
            color: "#ffffffaa", fontFamily: "'Space Mono',monospace",
            fontSize: 10, letterSpacing: 2, cursor: "pointer",
          }}>
            SHUFFLE
          </button>
          <div style={{
            flex: 2, padding: "11px", borderRadius: 10,
            background: "#A855F711", border: "1px solid #A855F755",
            color: "#A855F7", fontFamily: "'Space Mono',monospace",
            fontSize: 9, letterSpacing: 1, textAlign: "center",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            EARN VIA LUCKY SPIN
          </div>
        </div>

        <p style={{ marginTop: 10, fontSize: 8, color: "#ffffff22", textAlign: "center", letterSpacing: 1 }}>
          Each collectible is unique on-chain — traits locked at mint. OpenSea compatible.
        </p>
      </div>
    </div>
  );
}

// ─── Prize Tiers Panel ───────────────────────────────────────────────────────
function PrizeTiersPanel({ onClose }: { onClose: () => void }) {
  const TIERS = [
    { label: "JACKPOT",   odds: "0.05%", prize: "Full TON Pool",        color: "#FFD700", icon: "💰" },
    { label: "BIG WIN",   odds: "0.20%", prize: "5 TON",                color: "#FF6B35", icon: "🔥" },
    { label: "TON WIN",   odds: "3.90%", prize: "1.5 TON",              color: "#4ECDC4", icon: "✨" },
    { label: "SM BIG",    odds: "9.60%", prize: "3,000 SPINMINT",       color: "#A855F7", icon: "🍬" },
    { label: "SM SMALL",  odds: "18.0%", prize: "2,000 SPINMINT",       color: "#8B5CF6", icon: "🍬" },
    { label: "FREE SPIN", odds: "10.0%", prize: "150 SM + Free Spin",   color: "#2ED573", icon: "🎁" },
    { label: "TRY AGAIN", odds: "58.25%","prize": "50 SPINMINT",        color: "#6B7280", icon: "🎰" },
  ];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}
      onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "#00000088", backdropFilter: "blur(4px)" }} />
      <div onClick={e => e.stopPropagation()} style={{
        position: "relative", zIndex: 1,
        background: "linear-gradient(170deg,#0f0f1e,#0a0a14)",
        border: "1px solid #ffffff18", borderRadius: "20px 20px 0 0",
        padding: "16px 16px 32px", maxHeight: "80vh", overflowY: "auto",
      }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "#ffffff33", margin: "0 auto 14px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ fontFamily: "'Bebas Neue'", fontSize: 26, letterSpacing: 3, color: "#fff" }}>PRIZE TABLE</h2>
          <button onClick={onClose} style={{ background: "#ffffff11", border: "1px solid #ffffff22", borderRadius: 8, padding: "4px 10px", color: "#fff", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
        {TIERS.map(t => (
          <div key={t.label} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px 10px", borderRadius: 10,
            background: "#ffffff05", border: `1px solid ${t.color}22`, marginBottom: 6,
          }}>
            <span style={{ fontSize: 20 }}>{t.icon}</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontFamily: "'Bebas Neue'", fontSize: 16, color: t.color, letterSpacing: 2, lineHeight: 1 }}>{t.label}</p>
              <p style={{ fontSize: 9, color: "#ffffff55", letterSpacing: 1 }}>{t.prize}</p>
            </div>
            <div style={{
              background: `${t.color}22`, border: `1px solid ${t.color}55`,
              borderRadius: 8, padding: "3px 8px",
              fontFamily: "'Space Mono',monospace", fontSize: 9, color: t.color, whiteSpace: "nowrap",
            }}>{t.odds}</div>
          </div>
        ))}
        <p style={{ fontSize: 8, color: "#ffffff22", textAlign: "center", marginTop: 10, letterSpacing: 1 }}>
          1 TON PER SPIN  •  ODDS OUT OF 10,000
        </p>
      </div>
    </div>
  );
}

// ─── Withdraw Modal ───────────────────────────────────────────────────────────
function WithdrawModal({ claimable, onClose, onWithdraw }: {
  claimable: bigint;
  onClose: () => void;
  onWithdraw: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}
      onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "#00000099", backdropFilter: "blur(4px)" }} />
      <div onClick={e => e.stopPropagation()} style={{
        position: "relative", zIndex: 1,
        background: "linear-gradient(170deg,#0f0f1e,#0a0a14)",
        border: "1px solid #FFD70044", borderRadius: "20px 20px 0 0",
        padding: "20px 16px 36px",
      }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "#ffffff33", margin: "0 auto 16px" }} />
        <h2 style={{ fontFamily: "'Bebas Neue'", fontSize: 26, letterSpacing: 3, color: "#FFD700", marginBottom: 4 }}>
          CLAIM WINNINGS
        </h2>
        <p style={{ fontSize: 28, fontFamily: "'Bebas Neue'", color: "#fff", marginBottom: 4 }}>
          {parseFloat(fromNano(claimable)).toFixed(2)} TON
        </p>
        <p style={{ fontSize: 9, color: "#ffffff55", letterSpacing: 1, marginBottom: 16 }}>
          SENT DIRECTLY TO YOUR CONNECTED WALLET
        </p>
        <button onClick={onWithdraw} style={{
          width: "100%", padding: "14px", borderRadius: 12,
          background: "#FFD700", border: "none", color: "#000",
          fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 3, cursor: "pointer",
        }}>
          CLAIM NOW
        </button>
        <p style={{ fontSize: 8, color: "#ffffff22", textAlign: "center", marginTop: 10, letterSpacing: 1 }}>
          Unclaimed winnings return to the jackpot pool after 7 days.
        </p>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function SpinMintApp() {
  const wheelSize = useWheelSize();
  const [tonConnectUI] = useTonConnectUI();
  const address    = useTonAddress();
  const wallet     = useTonWallet();

  const [mounted, setMounted]       = useState(false);
  const [phase, setPhase]           = useState<Phase>("idle");
  const [winTier, setWinTier]       = useState<number | null>(null);
  const [showReveal, setShowReveal] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [muted, setMuted]           = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [showCollectible, setShowCollectible] = useState(false);
  const [showWithdraw, setShowWithdraw]       = useState(false);
  const [showPrizeTiers, setShowPrizeTiers]   = useState(false);
  const [freeSpins, setFreeSpins]             = useState<bigint>(0n);

  // TON contract state
  const [jackpot, setJackpot]         = useState<bigint>(0n);
  const [totalSpins, setTotalSpins]   = useState<bigint>(0n);
  const [claimableAmt, setClaimable]  = useState<bigint>(0n);

  const refetchUserState = useCallback(async () => {
    if (!address || !CONTRACT_ADDRESS) return;
    try {
      const addrCell = { type: "slice" as const, cell: beginCell().storeAddress(Address.parse(address)).endCell() };
      const [claimRes, fsRes] = await Promise.all([
        tonClient.runMethod(Address.parse(CONTRACT_ADDRESS), "claimable", [addrCell]),
        tonClient.runMethod(Address.parse(CONTRACT_ADDRESS), "freeSpins", [addrCell]),
      ]);
      setClaimable(claimRes.stack.readBigNumber());
      setFreeSpins(fsRes.stack.readBigNumber());
    } catch {}
  }, [address]);

  // Poll jackpot + totalSpins every 30s
  useEffect(() => {
    if (!CONTRACT_ADDRESS) return;
    const load = async () => {
      try {
        const j = await tonClient.runMethod(Address.parse(CONTRACT_ADDRESS), "jackpot", []);
        setJackpot(j.stack.readBigNumber());
        const t = await tonClient.runMethod(Address.parse(CONTRACT_ADDRESS), "totalSpins", []);
        setTotalSpins(t.stack.readBigNumber());
      } catch {}
    };
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  // Load user state when wallet connects
  useEffect(() => {
    if (!address) return;
    refetchUserState();
  }, [address, refetchUserState]);

  useEffect(() => { setMounted(true); }, []);

  // Boot audio on first interaction
  const bootAudio = useCallback(() => {
    if (!audioReady) {
      getCtx();
      if (!muted) startAmbient();
      setAudioReady(true);
    }
  }, [audioReady, muted]);

  const handleTick = useCallback((speed: number) => { playTick(speed); }, []);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    _mutedGlobal = next;
    if (_ambientAudio) {
      if (next) { _ambientAudio.pause(); }
      else      { _ambientAudio.play().catch(() => {}); }
    } else if (!next && audioReady) {
      startAmbient();
    }
  };

  // Poll contract state to detect spin result
  const pollForResult = useCallback(async (prevClaimable: bigint, prevFreeSpins: bigint, prevTotalSpins: bigint) => {
    const deadline = Date.now() + 30_000;
    const addrCell = { type: "slice" as const, cell: beginCell().storeAddress(Address.parse(address!)).endCell() };
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2500));
      try {
        const [claimRes, fsRes, spinsRes] = await Promise.all([
          tonClient.runMethod(Address.parse(CONTRACT_ADDRESS), "claimable", [addrCell]),
          tonClient.runMethod(Address.parse(CONTRACT_ADDRESS), "freeSpins", [addrCell]),
          tonClient.runMethod(Address.parse(CONTRACT_ADDRESS), "totalSpins", []),
        ]);
        const newClaimable   = claimRes.stack.readBigNumber();
        const newFreeSpins   = fsRes.stack.readBigNumber();
        const newTotalSpins  = spinsRes.stack.readBigNumber();
        const tonGained      = newClaimable - prevClaimable;
        const fsGained       = newFreeSpins - prevFreeSpins;
        const spinProcessed  = newTotalSpins > prevTotalSpins;

        if (!spinProcessed) continue;

        setTotalSpins(newTotalSpins);
        if (tonGained >= toNano("3")) {
          setWinTier(0); setClaimable(newClaimable);
        } else if (tonGained >= toNano("4")) {
          setWinTier(1); setClaimable(newClaimable);
        } else if (tonGained > 0n) {
          setWinTier(2); setClaimable(newClaimable);
        } else if (fsGained > 0n) {
          setWinTier(5); setFreeSpins(newFreeSpins);
        } else {
          // SPINMINT tier (3, 4, or 6) — can't distinguish without events
          setWinTier(6);
        }
        return;
      } catch {}
    }
    setWinTier(6);
  }, [address]);

  const handleSpin = async () => {
    if (!address) return;
    bootAudio();
    setError(null);
    try {
      setPhase("minting");
      const prevClaimable  = claimableAmt;
      const prevFreeSpins  = freeSpins;
      const prevTotalSpins = totalSpins;
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 60,
        messages: [{
          address: CONTRACT_ADDRESS,
          amount: toNano("1.05").toString(),
          payload: SPIN_PAYLOAD,
        }],
      });
      setPhase("spinning");
      await pollForResult(prevClaimable, prevFreeSpins, prevTotalSpins);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message.slice(0, 80) : "Transaction cancelled");
      setPhase("idle");
    }
  };

  const handleClaim = async () => {
    setShowWithdraw(false);
    setError(null);
    try {
      setPhase("minting");
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 60,
        messages: [{
          address: CONTRACT_ADDRESS,
          amount: toNano("0.05").toString(), // gas only
          payload: CLAIM_PAYLOAD,
        }],
      });
      setClaimable(0n);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message.slice(0, 80) : "Claim failed");
    } finally {
      setPhase("idle");
    }
  };

  const onSpinEnd = () => { setPhase("reveal"); setShowReveal(true); if (winTier !== null) playWin(winTier); };
  const onCloseReveal = () => { setShowReveal(false); setPhase("idle"); setWinTier(null); };

  const hasWinnings   = claimableAmt > 0n;
  const isSpinning    = phase === "spinning";
  const isBusy        = phase === "minting";
  const isConnected   = !!wallet;

  const btnLabel = {
    idle:      "SPIN  —  1 TON",
    approving: "...",
    minting:   "SENDING...",
    spinning:  "SPINNING...",
    reveal:    "...",
  }[phase];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Bebas+Neue&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        html,body{height:100%;overflow:hidden;background:#000}
        body{color:#fff;font-family:'Space Mono',monospace}
        #scroll-root{position:fixed;inset:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch}

        @keyframes orbFloat {
          from{transform:translateY(0) scale(1)}
          to{transform:translateY(-30px) scale(1.1)}
        }
        @keyframes shimmer {
          0%{background-position:-200% center}
          100%{background-position:200% center}
        }
        @keyframes jackpotPulse {
          0%,100%{text-shadow:0 0 20px #FFD700,0 0 40px #FFD70066}
          50%{text-shadow:0 0 40px #FFD700,0 0 80px #FFD700aa,0 0 120px #FF6B3555}
        }
        @keyframes glow {
          0%,100%{box-shadow:0 0 20px #FFD70033,inset 0 0 20px #FFD70011}
          50%{box-shadow:0 0 40px #FFD70066,inset 0 0 30px #FFD70022}
        }
        @keyframes scanline {
          0%{transform:translateY(-100%)}
          100%{transform:translateY(100vh)}
        }
        @keyframes ledBlink {
          from{opacity:1} to{opacity:0.3}
        }
        @keyframes fadeIn {
          from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)}
        }
        @keyframes nftPulse {
          0%,100%{box-shadow:0 0 18px #A855F7,0 0 36px #A855F755,0 0 8px #4ECDC4}
          50%{box-shadow:0 0 32px #A855F7,0 0 60px #A855F799,0 0 20px #4ECDC4aa}
        }
        @keyframes nftFloat {
          0%,100%{transform:translateY(0)}
          50%{transform:translateY(-5px)}
        }
        @keyframes rainbowText {
          0%{color:#FFD700} 20%{color:#FF6B35} 40%{color:#A855F7}
          60%{color:#4ECDC4} 80%{color:#FF4757} 100%{color:#FFD700}
        }

        .shimmer-btn {
          background:linear-gradient(90deg,#FFD700,#FF8C00,#FFD700,#FF6B35,#FFD700);
          background-size:300% auto;
          animation:shimmer 2.5s linear infinite;
        }
        .jackpot-num {
          font-family:'Bebas Neue',sans-serif;
          animation:jackpotPulse 2s ease-in-out infinite;
          background:linear-gradient(135deg,#FFD700,#FF8C00,#FFD700);
          -webkit-background-clip:text;-webkit-text-fill-color:transparent;
          background-clip:text;
        }
        .scanline::before {
          content:'';position:fixed;top:0;left:0;right:0;height:3px;
          background:linear-gradient(transparent,#ffffff08,transparent);
          animation:scanline 5s linear infinite;pointer-events:none;
        }
      `}</style>

      <div id="scroll-root">
      <CasinoBackground />

      <div className="scanline" onClick={bootAudio} style={{
        position: "relative", zIndex: 1,
        minHeight: "100dvh", display: "flex", flexDirection: "column",
        alignItems: "center", padding: "6px 10px 14px", gap: "6px",
      }}>

        {/* Header */}
        <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ fontFamily: "'Bebas Neue'", fontSize: 28, letterSpacing: 3, lineHeight: 1 }}>
              <span style={{ color: "#FFD700", textShadow: "0 0 24px #FFD700, 0 0 48px #FFD70066" }}>SPIN</span>
              <span style={{ color: "#fff", textShadow: "0 0 12px #ffffff44" }}>MINT</span>
            </h1>
            <p style={{ fontSize: 8, color: "#FFD70077", letterSpacing: 4, fontFamily: "'Space Mono',monospace" }}>MINT · SPIN · WIN</p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: 8, color: "#ffffff44", letterSpacing: 2 }}>TOTAL SPINS</p>
              <p style={{ fontFamily: "'Bebas Neue'", fontSize: 22, color: "#4ECDC4", textShadow: "0 0 14px #4ECDC4" }}>
                {totalSpins.toString()}
              </p>
            </div>
            <button onClick={toggleMute} style={{
              background: "#ffffff0a", border: "1px solid #ffffff22",
              borderRadius: 10, padding: "6px 10px",
              color: muted ? "#ffffff33" : "#FFD700",
              fontSize: 16, cursor: "pointer",
            }}>
              {muted ? "🔇" : "🔊"}
            </button>
          </div>
        </div>

        {/* Jackpot banner */}
        <div style={{
          width: "100%", borderRadius: 12, padding: "6px 12px",
          background: "linear-gradient(135deg,#1a1008,#2a1808,#1a1008)",
          border: "1px solid #FFD70066",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          animation: "glow 2.5s ease-in-out infinite",
        }}>
          <div>
            <p style={{ fontSize: 8, color: "#FFD70099", letterSpacing: 3, fontFamily: "'Space Mono',monospace" }}>JACKPOT POOL</p>
            <p className="jackpot-num" style={{ fontSize: 28, lineHeight: 1 }}>{fmt(jackpot)}</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <button onClick={() => setShowPrizeTiers(true)} style={{
              background: "#FFD70022", border: "1px solid #FFD70055",
              borderRadius: 8, padding: "4px 10px", cursor: "pointer",
              fontFamily: "'Space Mono',monospace", fontSize: 8,
              color: "#FFD700", letterSpacing: 2,
            }}>PRIZES ↑</button>
            <p style={{ fontFamily: "'Bebas Neue'", fontSize: 14, color: "#FFD700", letterSpacing: 2, marginTop: 3 }}>0.05% JACKPOT</p>
          </div>
        </div>

        {/* Wheel */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", animation: "fadeIn 0.5s ease-out" }}>
          <SpinWheel
            spinning={isSpinning}
            winTier={winTier}
            onSpinEnd={onSpinEnd}
            onTick={handleTick}
            size={wheelSize}
          />
        </div>

        {/* Wallet address pill */}
        {mounted && isConnected && (
          <div style={{ display: "flex", gap: "6px", width: "100%", flexShrink: 0, alignItems: "center" }}>
            <div style={{
              flex: 1, borderRadius: 8, padding: "5px 10px",
              background: "#ffffff05", border: "1px solid #ffffff0f",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <p style={{ fontSize: 7, color: "#ffffff33", letterSpacing: 2 }}>TON WALLET</p>
              <p style={{ fontSize: 9, color: "#ffffff55", fontFamily: "'Space Mono',monospace" }}>
                {address.slice(0, 6)}…{address.slice(-4)}
              </p>
            </div>
            <button onClick={() => tonConnectUI.disconnect()} style={{
              background: "#ffffff08", border: "1px solid #ffffff15",
              borderRadius: 8, padding: "5px 10px", color: "#ffffff44",
              fontSize: 9, cursor: "pointer", whiteSpace: "nowrap",
            }}>
              DISCONNECT
            </button>
          </div>
        )}

        {/* Claimable winnings banner */}
        {mounted && isConnected && hasWinnings && (
          <div
            onClick={() => setShowWithdraw(true)}
            style={{
              width: "100%", borderRadius: 12, padding: "10px 14px",
              background: "linear-gradient(135deg,#1a2a0a,#1e3a0a)",
              border: "1px solid #2ED57366", cursor: "pointer",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}
          >
            <div>
              <p style={{ fontSize: 8, color: "#2ED57399", letterSpacing: 3 }}>YOUR WINNINGS</p>
              <p style={{ fontFamily: "'Bebas Neue'", fontSize: 28, color: "#2ED573", textShadow: "0 0 14px #2ED573", lineHeight: 1 }}>
                {parseFloat(fromNano(claimableAmt)).toFixed(2)} TON
              </p>
            </div>
            <div style={{
              background: "#2ED573", color: "#000", padding: "8px 14px",
              borderRadius: 8, fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 2,
            }}>
              CLAIM
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ width: "100%", borderRadius: 10, padding: "6px 10px", background: "#ff000011", border: "1px solid #ff000033", fontSize: 9, color: "#ff6b6b", flexShrink: 0 }}>
            {error}
          </div>
        )}

        {/* CTA */}
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6, flexShrink: 0, paddingBottom: 10 }}>
          {!mounted ? null : !isConnected ? (
            <button
              onClick={() => { bootAudio(); tonConnectUI.openModal(); }}
              className="shimmer-btn"
              style={{
                width: "100%", padding: "15px", borderRadius: 14,
                border: "none", cursor: "pointer",
                fontFamily: "'Bebas Neue',sans-serif",
                fontSize: 18, letterSpacing: 4, color: "#000",
              }}
            >
              CONNECT TON WALLET
            </button>
          ) : (
            <>
              <button
                onClick={handleSpin}
                disabled={isBusy || isSpinning}
                className={isBusy || isSpinning ? "" : "shimmer-btn"}
                style={{
                  width: "100%", padding: "15px", borderRadius: 14,
                  border: "none", cursor: isBusy || isSpinning ? "not-allowed" : "pointer",
                  fontFamily: "'Bebas Neue',sans-serif",
                  fontSize: 18, letterSpacing: 4, color: "#000",
                  opacity: isBusy || isSpinning ? 0.5 : 1,
                  background: isBusy || isSpinning ? "#555" : undefined,
                  transition: "opacity 0.2s",
                }}
              >
                {btnLabel}
              </button>

              {freeSpins > 0n && (
                <button onClick={async () => {
                  bootAudio();
                  setError(null);
                  try {
                    setPhase("minting");
                    const prevClaimable  = claimableAmt;
                    const prevFreeSpins  = freeSpins;
                    const prevTotalSpins = totalSpins;
                    await tonConnectUI.sendTransaction({
                      validUntil: Math.floor(Date.now() / 1000) + 60,
                      messages: [{ address: CONTRACT_ADDRESS, amount: toNano("0.05").toString(), payload: FREE_SPIN_PAYLOAD }],
                    });
                    setPhase("spinning");
                    await pollForResult(prevClaimable, prevFreeSpins, prevTotalSpins);
                  } catch (e: unknown) {
                    setError(e instanceof Error ? e.message.slice(0, 80) : "Transaction cancelled");
                    setPhase("idle");
                  }
                }} style={{
                  width: "100%", padding: "11px", borderRadius: 12,
                  background: "linear-gradient(135deg,#2ED57333,#1a6b3a33)",
                  border: "1px solid #2ED57366", cursor: "pointer",
                  fontFamily: "'Bebas Neue',sans-serif", fontSize: 16, letterSpacing: 3,
                  color: "#2ED573",
                }}>
                  USE FREE SPIN  ({freeSpins.toString()} banked)
                </button>
              )}

              <button onClick={() => {
                bootAudio();
                const text = encodeURIComponent("🎰 Spinning on SpinMint — 1 TON to win the jackpot on Telegram!");
                const url = encodeURIComponent(process.env.NEXT_PUBLIC_APP_URL ?? window.location.href);
                window.open(`https://t.me/share/url?url=${url}&text=${text}`, "_blank");
              }} style={{
                width: "100%", padding: "8px", borderRadius: 10,
                background: "transparent", border: "1px solid #ffffff18",
                color: "#ffffff55", fontSize: 9, letterSpacing: 3,
                fontFamily: "'Space Mono',monospace", cursor: "pointer",
              }}>
                SHARE & EARN FREE SPIN
              </button>
            </>
          )}
        </div>

      </div>

      {/* ── Floating NFT Mint Orb ─────────────────────────────────────── */}
      {mounted && (
        <div
          onClick={() => { bootAudio(); setShowCollectible(true); }}
          style={{
            position: "fixed", right: 10, top: "50%",
            transform: "translateY(-50%)",
            zIndex: 50, cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            animation: "nftFloat 3s ease-in-out infinite",
          }}
        >
          {/* Glow orb */}
          <div style={{
            width: 58, height: 58, borderRadius: "50%",
            background: "radial-gradient(circle at 35% 35%, #C77DFF, #7B2FBE, #1a0a2e)",
            border: "2px solid #A855F7",
            boxShadow: "0 0 20px #A855F7, 0 0 40px #A855F755, 0 0 8px #4ECDC4",
            animation: "nftPulse 2.5s ease-in-out infinite",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 26,
          }}>
            🍭
          </div>
          {/* Label */}
          <div style={{
            background: "linear-gradient(135deg, #A855F7dd, #4ECDC4dd)",
            backdropFilter: "blur(6px)",
            border: "1px solid #A855F799",
            borderRadius: 8, padding: "3px 8px",
            fontFamily: "'Bebas Neue',sans-serif",
            fontSize: 13, letterSpacing: 2, color: "#fff",
            textShadow: "0 0 8px #A855F7",
            whiteSpace: "nowrap",
          }}>
            MINT NFT
          </div>
          <div style={{
            fontFamily: "'Space Mono',monospace",
            fontSize: 8, color: "#A855F7aa", letterSpacing: 1,
          }}>
            $2 USDC
          </div>
        </div>
      )}

      {showPrizeTiers && <PrizeTiersPanel onClose={() => setShowPrizeTiers(false)} />}

      {showReveal && winTier !== null && (
        <WinCelebration tier={winTier} onClose={onCloseReveal} />
      )}

      {showCollectible && (
        <CollectiblePanel onClose={() => setShowCollectible(false)} />
      )}

      {showWithdraw && (
        <WithdrawModal
          claimable={claimableAmt}
          onClose={() => setShowWithdraw(false)}
          onWithdraw={handleClaim}
        />
      )}
      </div>{/* end scroll-root */}
    </>
  );
}
