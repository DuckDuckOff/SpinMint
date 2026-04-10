import { traitsFromSeed, rarityScore, rarityLabel, type BackgroundTrait, type ColorTrait, type EffectTrait, type PatternTrait, type ShapeTrait, type StickTrait } from "./traits";

const W = 500;
const H = 500;
const CX = 250;
const CY = 230;

// ─── Background ───────────────────────────────────────────────────────────────
function renderBackground(bg: BackgroundTrait): string {
  if (bg.type === "space") {
    // Star field
    let stars = "";
    // Deterministic star positions using a fixed pseudo-random sequence
    for (let i = 0; i < 80; i++) {
      const x = ((i * 137 + 17) % 490) + 5;
      const y = ((i * 97  + 43) % 490) + 5;
      const r = i % 5 === 0 ? 2 : 1;
      const opacity = 0.3 + (i % 7) * 0.1;
      stars += `<circle cx="${x}" cy="${y}" r="${r}" fill="white" opacity="${opacity}"/>`;
    }
    return `
      <defs>
        <radialGradient id="bgGrad" cx="50%" cy="40%">
          <stop offset="0%" stop-color="${bg.from}"/>
          <stop offset="100%" stop-color="${bg.to}"/>
        </radialGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#bgGrad)"/>
      ${stars}`;
  }
  if (bg.type === "radial") {
    return `
      <defs>
        <radialGradient id="bgGrad" cx="50%" cy="40%">
          <stop offset="0%" stop-color="${bg.from}"/>
          <stop offset="100%" stop-color="${bg.to}"/>
        </radialGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#bgGrad)"/>`;
  }
  return `
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bg.from}"/>
        <stop offset="100%" stop-color="${bg.to}"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bgGrad)"/>`;
}

// ─── Stick ────────────────────────────────────────────────────────────────────
function renderStick(stick: StickTrait): string {
  const stickX = CX - 8;
  const stickY = CY + 160;
  const stickW = 16;
  const stickH = 110;

  if (stick.style === "rainbow") {
    const colors = ["#FF0000","#FF7700","#FFFF00","#00CC00","#0000FF","#8B00FF"];
    let stripes = "";
    const segH = stickH / colors.length;
    colors.forEach((c, i) => {
      stripes += `<rect x="${stickX}" y="${stickY + i * segH}" width="${stickW}" height="${segH + 1}" fill="${c}"/>`;
    });
    return `<g>
      <rect x="${stickX}" y="${stickY}" width="${stickW}" height="${stickH}" rx="6" fill="#fff" opacity="0.1"/>
      ${stripes}
      <rect x="${stickX}" y="${stickY}" width="${stickW}" height="${stickH}" rx="6" fill="none" stroke="#00000022" stroke-width="1"/>
    </g>`;
  }

  if (stick.style === "striped") {
    return `<g>
      <rect x="${stickX}" y="${stickY}" width="${stickW}" height="${stickH}" rx="6" fill="${stick.color}"/>
      ${[0,1,2,3,4].map(i =>
        `<rect x="${stickX}" y="${stickY + i * 22}" width="${stickW}" height="11" rx="0" fill="#ffffff33"/>`
      ).join("")}
    </g>`;
  }

  if (stick.style === "metallic") {
    return `<g>
      <defs>
        <linearGradient id="stickGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stop-color="${stick.color}" stop-opacity="0.6"/>
          <stop offset="40%"  stop-color="${stick.color}"/>
          <stop offset="60%"  stop-color="#fff" stop-opacity="0.8"/>
          <stop offset="100%" stop-color="${stick.color}" stop-opacity="0.7"/>
        </linearGradient>
      </defs>
      <rect x="${stickX}" y="${stickY}" width="${stickW}" height="${stickH}" rx="6" fill="url(#stickGrad)"/>
    </g>`;
  }

  return `<rect x="${stickX}" y="${stickY}" width="${stickW}" height="${stickH}" rx="6" fill="${stick.color}" opacity="0.95"/>`;
}

// ─── Lollie disc (spiral swirl) ───────────────────────────────────────────────
function renderLollie(
  palette: ColorTrait,
  shape: ShapeTrait,
  pattern: PatternTrait,
  seed: bigint
): string {
  const R = 130 * shape.size;
  const sw = shape.strokeWidth;
  const turns = 3.5; // spiral turns
  const segments = shape.swirls * 40;

  // Build spiral path for each swirl arm
  let spiralPaths = "";
  for (let arm = 0; arm < shape.swirls; arm++) {
    const angleOffset = (arm / shape.swirls) * Math.PI * 2;
    // Alternate primary / secondary / accent colours
    const color = arm % 3 === 0 ? palette.primary
                : arm % 3 === 1 ? palette.secondary
                : palette.accent;

    let d = "";
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const r = t * R;
      const angle = angleOffset + t * turns * Math.PI * 2;
      const x = CX + r * Math.cos(angle);
      const y = CY + r * Math.sin(angle);
      d += i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
    }

    spiralPaths += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" opacity="0.92"/>`;
  }

  // Disc background (filled circle)
  const discFill = `
    <defs>
      <radialGradient id="discGrad" cx="45%" cy="38%">
        <stop offset="0%"   stop-color="${palette.secondary}"/>
        <stop offset="100%" stop-color="${palette.primary}"/>
      </radialGradient>
      <clipPath id="discClip">
        <circle cx="${CX}" cy="${CY}" r="${R}"/>
      </clipPath>
    </defs>
    <circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#discGrad)"/>`;

  // Pattern overlay
  let patternOverlay = "";
  if (pattern.type === "dots") {
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2;
      const r = R * 0.6;
      const x = CX + r * Math.cos(angle);
      const y = CY + r * Math.sin(angle);
      patternOverlay += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${palette.accent}" opacity="0.6"/>`;
    }
  } else if (pattern.type === "stars") {
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const r = R * 0.55;
      const x = CX + r * Math.cos(angle);
      const y = CY + r * Math.sin(angle);
      patternOverlay += `<text x="${x.toFixed(1)}" y="${(y + 6).toFixed(1)}" text-anchor="middle" font-size="18" opacity="0.7">⭐</text>`;
    }
  } else if (pattern.type === "hearts") {
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const r = R * 0.5;
      const x = CX + r * Math.cos(angle);
      const y = CY + r * Math.sin(angle);
      patternOverlay += `<text x="${x.toFixed(1)}" y="${(y + 6).toFixed(1)}" text-anchor="middle" font-size="16" opacity="0.8">🩷</text>`;
    }
  } else if (pattern.type === "sparkles") {
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const r = R * (0.3 + (i % 3) * 0.2);
      const x = CX + r * Math.cos(angle);
      const y = CY + r * Math.sin(angle);
      const size = 3 + (i % 4);
      patternOverlay += `
        <line x1="${x.toFixed(1)}" y1="${(y - size).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y + size).toFixed(1)}" stroke="${palette.accent}" stroke-width="2" opacity="0.8"/>
        <line x1="${(x - size).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + size).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${palette.accent}" stroke-width="2" opacity="0.8"/>`;
    }
  } else if (pattern.type === "checkers") {
    // Radial checker rings
    for (let ring = 1; ring <= 3; ring++) {
      const segments2 = ring * 8;
      for (let seg = 0; seg < segments2; seg += 2) {
        const a1 = (seg / segments2) * Math.PI * 2;
        const a2 = ((seg + 1) / segments2) * Math.PI * 2;
        const r1 = (ring - 1) * R / 3;
        const r2 = ring * R / 3;
        const x1 = CX + r1 * Math.cos(a1), y1 = CY + r1 * Math.sin(a1);
        const x2 = CX + r2 * Math.cos(a1), y2 = CY + r2 * Math.sin(a1);
        const x3 = CX + r2 * Math.cos(a2), y3 = CY + r2 * Math.sin(a2);
        const x4 = CX + r1 * Math.cos(a2), y4 = CY + r1 * Math.sin(a2);
        patternOverlay += `<path d="M${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)} L${x3.toFixed(1)},${y3.toFixed(1)} L${x4.toFixed(1)},${y4.toFixed(1)} Z" fill="${palette.accent}" opacity="0.35"/>`;
      }
    }
  } else if (pattern.type === "glitch") {
    for (let i = 0; i < 6; i++) {
      const yOff = -R + (i / 6) * R * 2;
      const xOff = ((Number(seed >> BigInt(i * 8)) & 0xff) % 30) - 15;
      patternOverlay += `
        <rect x="${CX - R + xOff}" y="${CY + yOff}" width="${R * 2}" height="${R / 8}" fill="${palette.primary}" opacity="0.3"/>
        <rect x="${CX - R - xOff}" y="${CY + yOff + 4}" width="${R * 1.5}" height="2" fill="${palette.accent}" opacity="0.5"/>`;
    }
  }

  // Disc rim
  const rim = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${palette.primary}" stroke-width="3" opacity="0.4"/>`;

  // Shine highlight
  const shine = `
    <ellipse cx="${(CX - R * 0.25).toFixed(1)}" cy="${(CY - R * 0.3).toFixed(1)}" rx="${(R * 0.25).toFixed(1)}" ry="${(R * 0.15).toFixed(1)}"
      fill="white" opacity="0.18" transform="rotate(-30, ${CX}, ${CY})"/>`;

  return `
    ${discFill}
    <g clip-path="url(#discClip)">
      ${spiralPaths}
      ${patternOverlay}
      ${shine}
    </g>
    ${rim}`;
}

// ─── Effect layer ─────────────────────────────────────────────────────────────
function renderEffect(effect: EffectTrait, palette: ColorTrait, shape: ShapeTrait): string {
  const R = 130 * shape.size;

  if (effect.type === "glow") {
    return `
      <defs>
        <filter id="glowFilter" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="12" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <circle cx="${CX}" cy="${CY}" r="${R + 15}" fill="${palette.glow}" filter="url(#glowFilter)" opacity="0.5"/>`;
  }

  if (effect.type === "halo") {
    return `
      <circle cx="${CX}" cy="${CY}" r="${R + 20}" fill="none" stroke="${palette.accent}" stroke-width="3" opacity="0.6"/>
      <circle cx="${CX}" cy="${CY}" r="${R + 30}" fill="none" stroke="${palette.accent}" stroke-width="1" opacity="0.3"/>
      <circle cx="${CX}" cy="${CY}" r="${R + 40}" fill="none" stroke="${palette.accent}" stroke-width="0.5" opacity="0.15"/>`;
  }

  if (effect.type === "sparkle") {
    let sparks = "";
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const r = R + 25 + (i % 3) * 10;
      const x = CX + r * Math.cos(angle);
      const y = CY + r * Math.sin(angle);
      sparks += `<text x="${x.toFixed(1)}" y="${(y+6).toFixed(1)}" text-anchor="middle" font-size="16">✨</text>`;
    }
    return sparks;
  }

  if (effect.type === "rainbow-glow") {
    const colors = ["#FF0080","#FF8800","#FFFF00","#00FF00","#0088FF","#8800FF"];
    return colors.map((c, i) => {
      const r = R + 12 + i * 6;
      return `<circle cx="${CX}" cy="${CY}" r="${r}" fill="none" stroke="${c}" stroke-width="3" opacity="${0.4 - i * 0.05}"/>`;
    }).join("");
  }

  if (effect.type === "matrix") {
    let chars = "";
    const matrixChars = "01アイウエオカキクケコ";
    for (let i = 0; i < 15; i++) {
      const x = 20 + (i * 33) % 460;
      const y = 20 + (i * 47) % 460;
      const char = matrixChars[i % matrixChars.length];
      chars += `<text x="${x}" y="${y}" font-size="12" fill="#39FF14" opacity="0.4" font-family="monospace">${char}</text>`;
    }
    return chars;
  }

  return "";
}

// ─── Badge / label ────────────────────────────────────────────────────────────
function renderBadge(tokenId: number, score: number, palette: ColorTrait): string {
  const label = rarityLabel(score);
  return `
    <rect x="10" y="10" width="160" height="36" rx="8" fill="#00000066"/>
    <text x="20" y="33" font-size="13" fill="${palette.accent}" font-family="monospace" font-weight="bold">LOLLIE #${tokenId}</text>
    <rect x="10" y="${H - 46}" width="200" height="36" rx="8" fill="#00000066"/>
    <text x="20" y="${H - 23}" font-size="12" fill="${palette.primary}" font-family="monospace">${label}</text>`;
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function generateSVG(tokenId: number, seed: string | bigint): string {
  const s = typeof seed === "string" ? BigInt(seed) : seed;
  const traits = traitsFromSeed(s);
  const score = rarityScore(traits);

  const bg      = renderBackground(traits.background);
  const effect  = renderEffect(traits.effect, traits.palette, traits.shape);
  const stick   = renderStick(traits.stick);
  const lollie  = renderLollie(traits.palette, traits.shape, traits.pattern, s);
  const badge   = renderBadge(tokenId, score, traits.palette);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  ${bg}
  ${effect}
  ${stick}
  ${lollie}
  ${badge}
</svg>`;
}
