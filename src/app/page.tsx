"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { traitsFromSeed, rarityScore, rarityLabel, RARITY_COLORS } from "../lib/traits";
import { generateSVG } from "../lib/svgGenerator";
import { useAccount, useWriteContract, useReadContract, useWaitForTransactionReceipt, useConnect, useConfig } from "wagmi";
import { waitForTransactionReceipt } from "@wagmi/core";
import { parseUnits, formatUnits, decodeEventLog } from "viem";
import { SPINMINT_ABI } from "../lib/abi";

// ─── Config ───────────────────────────────────────────────────────────────────
const SPINMINT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`;
const CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN === "mainnet" ? 8453 : 84532;
const USDC_ADDRESS = (
  process.env.NEXT_PUBLIC_CHAIN === "mainnet"
    ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    : "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
) as `0x${string}`;


const ERC20_ABI = [
  {
    name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ─── Prize config ─────────────────────────────────────────────────────────────
const PRIZES = [
  { label: "JACKPOT",    tier: 0, color: "#FFD700", dark: "#7a6200" },
  { label: "BIG WIN",    tier: 1, color: "#FF6B35", dark: "#7a3319" },
  { label: "$2 WIN",     tier: 2, color: "#4ECDC4", dark: "#1e6460" },
  { label: "RARE NFT",   tier: 3, color: "#A855F7", dark: "#531a82" },
  { label: "AGAIN",      tier: 4, color: "#374151", dark: "#1a1f27" },
  { label: "FREE SPIN!", tier: 5, color: "#2ED573", dark: "#1a6b3a" },
];

const SEGMENTS = [
  PRIZES[0], PRIZES[2], PRIZES[4], PRIZES[1],
  PRIZES[3], PRIZES[5], PRIZES[2], PRIZES[4],
  PRIZES[3], PRIZES[4], PRIZES[1], PRIZES[5],
];

type Phase = "idle" | "approving" | "minting" | "spinning" | "reveal";

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
function fmt(usdc: bigint) {
  return `$${parseFloat(formatUnits(usdc, 6)).toFixed(2)}`;
}

function getSegUnderPointer(angle: number): number {
  const slice = (2 * Math.PI) / SEGMENTS.length;
  const rel = ((-Math.PI / 2 - angle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  return Math.floor(rel / slice) % SEGMENTS.length;
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
    ["#FFD700", "#FF6B35", "#FFF8DC", "#FFEC6E"],
    ["#FF6B35", "#FF9D6B", "#FFA07A", "#FFD700"],
    ["#4ECDC4", "#7EDDD8", "#B2EBF2", "#00E5D8"],
    ["#A855F7", "#C77DFF", "#E0B4FF", "#7C3AED"],
    ["#4B5563", "#6B7280", "#374151"],
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

// ─── LED Ring ─────────────────────────────────────────────────────────────────
const LEDS = 24;
const LED_PAL = ["#FFD700","#FF6B35","#4ECDC4","#A855F7","#FF4757","#2ED573","#1E90FF","#FF69B4"];

function LEDRing({ spinning, winTier }: { spinning: boolean; winTier: number | null }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame(f => f + 1), spinning ? 50 : 180);
    return () => clearInterval(id);
  }, [spinning]);

  const tierColor = winTier !== null && winTier < 4 ? PRIZES[winTier].color : null;

  return (
    <div style={{ position: "absolute", inset: -18, borderRadius: "50%", pointerEvents: "none" }}>
      {Array.from({ length: LEDS }, (_, i) => {
        const a = (i / LEDS) * 2 * Math.PI - Math.PI / 2;
        const x = parseFloat((50 + 50 * Math.cos(a)).toFixed(4));
        const y = parseFloat((50 + 50 * Math.sin(a)).toFixed(4));
        const color = tierColor ?? LED_PAL[(i + frame) % LED_PAL.length];
        const lit = spinning ? (i + frame) % 2 === 0 : (i * 3 + frame) % 7 < 2;
        return (
          <div key={i} style={{
            position: "absolute", left: `${x}%`, top: `${y}%`,
            transform: "translate(-50%,-50%)",
            width: 7, height: 7, borderRadius: "50%",
            background: lit ? color : "#111",
            boxShadow: lit ? `0 0 8px 3px ${color}99` : "none",
            transition: "background 0.08s, box-shadow 0.08s",
          }} />
        );
      })}
    </div>
  );
}

// ─── Wheel ────────────────────────────────────────────────────────────────────
function useWheelSize() {
  const [size, setSize] = useState(280);
  useEffect(() => {
    const calc = () => {
      // fit wheel within viewport: leave room for header (~70px), jackpot (~70px), stats (~50px), buttons (~120px), gaps
      const available = Math.min(window.innerHeight - 340, window.innerWidth - 40);
      setSize(Math.max(200, Math.min(320, available)));
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);
  return size;
}

const WHEEL_SIZE = 280; // fallback for SSR

function SpinWheel({ spinning, winTier, onSpinEnd, onTick, size }: {
  spinning: boolean; winTier: number | null;
  onSpinEnd: () => void; onTick: (speed: number) => void;
  size: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const angleRef  = useRef(0);
  const rafRef    = useRef<number>(0);
  const lastSegRef = useRef(-1);
  const [angle, setAngle] = useState(0);
  const [pulsing, setPulsing] = useState(false);
  const [litSeg, setLitSeg] = useState(-1);

  const draw = useCallback((ang: number, highlight: number) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 10;
    ctx.clearRect(0, 0, W, H);
    const slice = (2 * Math.PI) / SEGMENTS.length;

    SEGMENTS.forEach((seg, i) => {
      const s = ang + i * slice, e = s + slice;
      const hot = i === highlight;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, s, e);
      ctx.closePath();
      if (hot) {
        ctx.shadowColor = seg.color; ctx.shadowBlur = 28;
        // Brighter fill for lit segment
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, seg.color + "cc");
        grad.addColorStop(1, seg.color);
        ctx.fillStyle = grad;
      } else {
        ctx.shadowBlur = 0;
        ctx.fillStyle = seg.color;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#000009"; ctx.lineWidth = 2; ctx.stroke();

      // Label
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(s + slice / 2);
      ctx.textAlign = "right";
      ctx.font = `bold ${hot ? 11 : 10}px 'Space Mono',monospace`;
      ctx.fillStyle = "#fff";
      if (hot) { ctx.shadowColor = "#fff"; ctx.shadowBlur = 10; }
      ctx.fillText(seg.label, r - 10, 4);
      ctx.restore();
    });

    // Outer decorative rings
    [{ r: r + 1, c: "#ffffff22", w: 5 }, { r: r + 5, c: "#FFD70033", w: 2 }].forEach(({ r: rr, c, w }) => {
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 2 * Math.PI);
      ctx.strokeStyle = c; ctx.lineWidth = w; ctx.stroke();
    });

    // Center hub
    const hub = ctx.createRadialGradient(cx, cy, 0, cx, cy, 24);
    hub.addColorStop(0, "#FFD70077"); hub.addColorStop(1, "#0a0a0f");
    ctx.beginPath(); ctx.arc(cx, cy, 24, 0, 2 * Math.PI);
    ctx.fillStyle = hub; ctx.fill();
    ctx.strokeStyle = "#FFD70099"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#FFD700"; ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("S", cx, cy); ctx.textBaseline = "alphabetic";

    // Pointer
    const pColor = highlight >= 0 ? "#FFD700" : "#FFD700";
    ctx.save();
    ctx.shadowColor = pColor; ctx.shadowBlur = highlight >= 0 ? 24 : 14;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r - 4);
    ctx.lineTo(cx - 13, cy - r + 18);
    ctx.lineTo(cx + 13, cy - r + 18);
    ctx.closePath();
    ctx.fillStyle = pColor; ctx.fill();
    ctx.restore();
  }, []);

  useEffect(() => { draw(angle, litSeg); }, [angle, litSeg, draw]);

  useEffect(() => {
    if (!spinning) return;
    const slice = (2 * Math.PI) / SEGMENTS.length;
    const targetIdx = winTier !== null
      ? SEGMENTS.findIndex(s => s.tier === winTier)
      : Math.floor(Math.random() * SEGMENTS.length);
    const targetAngle = -Math.PI / 2 - (targetIdx * slice + slice / 2);
    const spins = 6 + Math.random() * 3;
    const finalAngle = targetAngle - spins * 2 * Math.PI;
    const startAng = angleRef.current;
    const duration = 4200;
    const startTime = performance.now();

    function ease(t: number) { return 1 - Math.pow(1 - t, 4); }

    function frame(now: number) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = ease(t);
      const ang = startAng + (finalAngle - startAng) * eased;
      const speed = 1 - eased; // 1=fast, 0=stopped
      const seg = getSegUnderPointer(ang);
      if (seg !== lastSegRef.current) {
        lastSegRef.current = seg;
        onTick(speed);
        setLitSeg(seg);
        setPulsing(true);
        setTimeout(() => { setPulsing(false); setLitSeg(-1); }, 90);
      }
      angleRef.current = ang;
      setAngle(ang);
      draw(ang, seg);
      if (t < 1) { rafRef.current = requestAnimationFrame(frame); }
      else { draw(finalAngle, -1); onSpinEnd(); }
    }
    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [spinning, winTier, draw, onSpinEnd, onTick]);

  return (
    <div style={{
      position: "relative",
      width: size + 40, height: size + 40,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    }}>
      <LEDRing spinning={spinning} winTier={winTier} />
      <div style={{
        transform: pulsing ? "scale(1.045)" : "scale(1)",
        transition: pulsing ? "none" : "transform 0.12s ease-out",
        willChange: "transform",
      }}>
        <canvas ref={canvasRef} width={size} height={size} style={{
          borderRadius: "50%",
          filter: spinning
            ? "drop-shadow(0 0 32px #FFD70077) drop-shadow(0 0 8px #fff4)"
            : "drop-shadow(0 0 12px #FFD70033)",
          transition: "filter 0.4s",
          display: "block",
        }} />
      </div>
    </div>
  );
}

// ─── Win Celebration ──────────────────────────────────────────────────────────
function WinCelebration({ tier, onClose }: { tier: number; onClose: () => void }) {
  const [particles, setParticles] = useState<Particle[]>(() => burst(tier, tier === 0 ? 90 : tier === 4 ? 12 : 45));
  const [flash, setFlash] = useState(true);
  const rafRef = useRef<number>(0);

  const prize = PRIZES.find(p => p.tier === tier) ?? PRIZES[4];
  const MSGS = {
    0: { title: "JACKPOT!!!",       sub: "The entire pool is YOURS!",             emoji: "💰" },
    1: { title: "BIG WIN!",         sub: "$3 USDC sent to your wallet",            emoji: "🔥" },
    2: { title: "YOU WON!",         sub: "$2 USDC sent to your wallet",            emoji: "✨" },
    3: { title: "RARE NFT!",        sub: "A rare SpinMint NFT was minted for you", emoji: "💎" },
    4: { title: "BETTER LUCK...",   sub: "No win this time. Try again?",           emoji: "🎰" },
    5: { title: "FREE SPIN!",       sub: "Spin again on the house!",               emoji: "🎁" },
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
      {tier < 4 && (
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
        transform: flash && tier < 4 ? "scale(1.025)" : "scale(1)",
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

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function SpinMintApp() {
  const wheelSize = useWheelSize();
  const { address, connector } = useAccount();
  const [mounted, setMounted]     = useState(false);
  const [phase, setPhase]         = useState<Phase>("idle");
  const [winTier, setWinTier]     = useState<number | null>(null);
  const [showReveal, setShowReveal] = useState(false);
  const [txHash, setTxHash]       = useState<`0x${string}` | undefined>();
  const [error, setError]         = useState<string | null>(null);
  const [muted, setMuted]         = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [showCollectible, setShowCollectible] = useState(false);

  // Contract reads
  const { data: stats } = useReadContract({
    address: SPINMINT_ADDRESS, abi: SPINMINT_ABI, functionName: "getStats",
  });
  const { data: userInfo } = useReadContract({
    address: SPINMINT_ADDRESS, abi: SPINMINT_ABI, functionName: "getUserInfo",
    args: address ? [address] : undefined, query: { enabled: !!address },
  });
  const { data: allowance } = useReadContract({
    address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "allowance",
    args: address ? [address, SPINMINT_ADDRESS] : undefined, query: { enabled: !!address },
  });

  const config = useConfig();
  const { connectors, connect } = useConnect();
  const { writeContractAsync } = useWriteContract();
const { data: receipt } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: CHAIN_ID,
    pollingInterval: 2000,
    query: { enabled: !!txHash },
  });

  // Mounted guard — prevents SSR/client hydration mismatch for wallet-dependent UI
  useEffect(() => { setMounted(true); }, []);

  // Decode SpinResult from receipt (V2: prize + isJackpot)
  useEffect(() => {
    if (!receipt) return;
    let tier = 4;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: SPINMINT_ABI, eventName: "SpinResult", data: log.data, topics: log.topics });
        const { prize, isJackpot } = decoded.args as { prize: bigint; isJackpot: boolean };
        if (isJackpot) tier = 0;
        else if (prize >= parseUnits("3", 6)) tier = 1;
        else if (prize > 0n) tier = 2;
        else {
          // Check for free spin grant in same tx
          const hasFreeGrant = receipt.logs.some(l => {
            try { decodeEventLog({ abi: SPINMINT_ABI, eventName: "FreeSpinGranted", data: l.data, topics: l.topics }); return true; } catch { return false; }
          });
          // Check for rare NFT mint
          const hasMint = receipt.logs.some(l => {
            try { decodeEventLog({ abi: SPINMINT_ABI, eventName: "Minted", data: l.data, topics: l.topics }); return true; } catch { return false; }
          });
          tier = hasFreeGrant ? 5 : hasMint ? 3 : 4;
        }
        break;
      } catch {}
    }
    setWinTier(tier);
    setPhase("spinning");
  }, [receipt]);

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

  // Write with explicit connector + chainId so wagmi skips the getChainId probe
  const safeWrite = async (args: Parameters<typeof writeContractAsync>[0]) => {
    return writeContractAsync({ ...args, connector, chainId: CHAIN_ID });
  };

  const handleMint = async () => {
    if (!address) return;
    bootAudio();
    setError(null);
    try {
      if (!allowance || allowance < parseUnits("1", 6)) {
        setPhase("approving");
        const approveHash = await safeWrite({
          address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "approve",
          args: [SPINMINT_ADDRESS, parseUnits("1", 6)],
        });
        // Wait for approve to confirm on-chain before spending the allowance
        await waitForTransactionReceipt(config, { hash: approveHash, chainId: CHAIN_ID });
      }
      setPhase("minting");
      const hash = await safeWrite({
        address: SPINMINT_ADDRESS, abi: SPINMINT_ABI, functionName: "mintAndSpin",
      });
      setTxHash(hash);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message.slice(0, 100) : "Transaction failed");
      setPhase("idle");
    }
  };

  const handleFreeSpin = async () => {
    if (!address) return;
    bootAudio();
    setError(null);
    try {
      setPhase("minting");
      const hash = await safeWrite({
        address: SPINMINT_ADDRESS, abi: SPINMINT_ABI, functionName: "useFreeSpin",
      });
      setTxHash(hash);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message.slice(0, 100) : "Transaction failed");
      setPhase("idle");
    }
  };

  const onSpinEnd = () => { setPhase("reveal"); setShowReveal(true); if (winTier !== null) playWin(winTier); };
  const onCloseReveal = () => { setShowReveal(false); setPhase("idle"); setWinTier(null); setTxHash(undefined); };

  const jackpot    = stats ? stats[0] : 0n;
  const totalMints = stats ? stats[1] : 0n;
  const userStreak = userInfo ? userInfo[0] : 0n;
  const hasFree    = userInfo ? userInfo[1] : false;
  const isSpinning = phase === "spinning";
  const isBusy     = phase === "approving" || phase === "minting";

  const btnLabel = {
    idle:      "MINT & SPIN  -  $1 USDC",
    approving: "APPROVING USDC...",
    minting:   "MINTING...",
    spinning:  "SPINNING...",
    reveal:    "...",
  }[phase];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Bebas+Neue&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#000;color:#fff;font-family:'Space Mono',monospace;overflow-x:hidden}

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

      <CasinoBackground />

      <div className="scanline" onClick={bootAudio} style={{
        position: "relative", zIndex: 1,
        minHeight: "100dvh", display: "flex", flexDirection: "column",
        alignItems: "center", padding: "8px 12px 12px", gap: "6px",
        overflowX: "hidden", overflowY: "auto",
      }}>

        {/* Header */}
        <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ fontFamily: "'Bebas Neue'", fontSize: 34, letterSpacing: 4, lineHeight: 1 }}>
              <span style={{ color: "#FFD700", textShadow: "0 0 24px #FFD700, 0 0 48px #FFD70066" }}>SPIN</span>
              <span style={{ color: "#fff", textShadow: "0 0 12px #ffffff44" }}>MINT</span>
            </h1>
            <p style={{ fontSize: 8, color: "#FFD70077", letterSpacing: 4, fontFamily: "'Space Mono',monospace" }}>MINT · SPIN · WIN</p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: 8, color: "#ffffff44", letterSpacing: 2 }}>TOTAL MINTS</p>
              <p style={{ fontFamily: "'Bebas Neue'", fontSize: 22, color: "#4ECDC4", textShadow: "0 0 14px #4ECDC4" }}>
                {totalMints.toString()}
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
          width: "100%", borderRadius: 14, padding: "8px 14px",
          background: "linear-gradient(135deg,#1a1008,#2a1808,#1a1008)",
          border: "1px solid #FFD70066",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          animation: "glow 2.5s ease-in-out infinite",
        }}>
          <div>
            <p style={{ fontSize: 8, color: "#FFD70099", letterSpacing: 3, fontFamily: "'Space Mono',monospace" }}>JACKPOT POOL</p>
            <p className="jackpot-num" style={{ fontSize: 34, lineHeight: 1 }}>{fmt(jackpot)}</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: 8, color: "#ffffff55", letterSpacing: 2 }}>TOP PRIZE</p>
            <p style={{ fontFamily: "'Bebas Neue'", fontSize: 18, color: "#FFD700", textShadow: "0 0 10px #FFD700", letterSpacing: 2 }}>2% ODDS</p>
          </div>
        </div>

        {/* Wheel */}
        <div style={{ animation: "fadeIn 0.5s ease-out" }}>
          <SpinWheel
            spinning={isSpinning}
            winTier={winTier}
            onSpinEnd={onSpinEnd}
            onTick={handleTick}
            size={wheelSize}
          />
        </div>

        {/* User stats */}
        {mounted && address && (
          <div style={{ display: "flex", gap: "8px", width: "100%" }}>
            {[
              { label: "STREAK", val: `${userStreak.toString()}`, color: "#FF6B35" },
              { label: "FREE SPIN", val: hasFree ? "READY!" : "–", color: hasFree ? "#4ECDC4" : "#ffffff22" },
            ].map(({ label, val, color }) => (
              <div key={label} style={{
                flex: 1, borderRadius: 12, padding: "8px 12px",
                background: "#ffffff07", border: `1px solid ${color}33`,
                textAlign: "center",
              }}>
                <p style={{ fontSize: 8, color: "#ffffff44", letterSpacing: 3, fontFamily: "'Space Mono',monospace" }}>{label}</p>
                <p style={{ fontSize: 24, color, fontFamily: "'Bebas Neue'", textShadow: `0 0 14px ${color}`, letterSpacing: 2 }}>
                  {val}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            width: "100%", borderRadius: 10, padding: "8px 12px",
            background: "#ff000011", border: "1px solid #ff000033",
            fontSize: 10, color: "#ff6b6b",
          }}>
            {error}
          </div>
        )}

        {/* CTA */}
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8, marginTop: "auto" }}>
          {!mounted ? null : !address ? (
            <button
              onClick={() => { bootAudio(); connect({ connector: connectors[0], chainId: CHAIN_ID }); }}
              className="shimmer-btn"
              style={{
                width: "100%", padding: "20px", borderRadius: 16,
                border: "none", cursor: "pointer",
                fontFamily: "'Bebas Neue',sans-serif",
                fontSize: 22, letterSpacing: 4, color: "#000",
              }}
            >
              CONNECT WALLET
            </button>
          ) : (
            <>
              <button
                onClick={handleMint}
                disabled={isBusy || isSpinning}
                className={isBusy || isSpinning ? "" : "shimmer-btn"}
                style={{
                  width: "100%", padding: "18px", borderRadius: 16,
                  border: "none", cursor: isBusy || isSpinning ? "not-allowed" : "pointer",
                  fontFamily: "'Bebas Neue',sans-serif",
                  fontSize: 20, letterSpacing: 4, color: "#000",
                  opacity: isBusy || isSpinning ? 0.5 : 1,
                  background: isBusy || isSpinning ? "#555" : undefined,
                  transition: "opacity 0.2s",
                }}
              >
                {btnLabel}
              </button>

              {hasFree && (
                <button onClick={handleFreeSpin} disabled={isBusy || isSpinning} style={{
                  width: "100%", padding: "14px", borderRadius: 14,
                  background: "#4ECDC411", border: "2px solid #4ECDC4",
                  color: "#4ECDC4", fontFamily: "'Bebas Neue',sans-serif",
                  fontSize: 18, letterSpacing: 4,
                  cursor: isBusy || isSpinning ? "not-allowed" : "pointer",
                  opacity: isBusy || isSpinning ? 0.5 : 1,
                  textShadow: "0 0 14px #4ECDC4",
                  boxShadow: "0 0 20px #4ECDC433",
                }}>
                  FREE SPIN — USE IT!
                </button>
              )}

              <button onClick={() => {
                bootAudio();
                const text = encodeURIComponent("🎰 Just minted on SpinMint — $1 USDC to spin and win the jackpot!\n\nPlay onchain on Base:");
                const url = encodeURIComponent(process.env.NEXT_PUBLIC_APP_URL ?? window.location.href);
                window.open(`https://t.me/share/url?url=${url}&text=${text}`, "_blank");
              }} style={{
                width: "100%", padding: "11px", borderRadius: 12,
                background: "transparent", border: "1px solid #ffffff18",
                color: "#ffffff55", fontSize: 10, letterSpacing: 3,
                fontFamily: "'Space Mono',monospace", cursor: "pointer",
              }}>
                SHARE & EARN FREE SPIN
              </button>
            </>
          )}
        </div>

        {/* Prize table */}
        <div style={{
          width: "100%", borderRadius: 12, padding: "10px 12px",
          background: "#ffffff04", border: "1px solid #ffffff07", fontSize: 9,
        }}>
          <p style={{ color: "#ffffff33", letterSpacing: 2, marginBottom: 6 }}>PRIZE TABLE</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {PRIZES.map(p => (
              <div key={p.tier} style={{
                display: "flex", justifyContent: "space-between",
                color: "#ffffff66", paddingBottom: 3,
                borderBottom: "1px solid #ffffff06",
              }}>
                <span style={{ color: p.color, textShadow: `0 0 8px ${p.color}66` }}>{p.label}</span>
                <span style={{ color: "#ffffff33" }}>
                  {p.tier === 0 ? "2%" : p.tier === 1 ? "8%" : p.tier === 2 ? "15%" : p.tier === 3 ? "20%" : p.tier === 5 ? "coming soon" : "55%"}
                </span>
              </div>
            ))}
          </div>
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

      {showReveal && winTier !== null && (
        <WinCelebration tier={winTier} onClose={onCloseReveal} />
      )}

      {showCollectible && (
        <CollectiblePanel onClose={() => setShowCollectible(false)} />
      )}
    </>
  );
}
