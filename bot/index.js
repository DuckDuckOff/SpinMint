const { Telegraf, Markup } = require("telegraf");
const { TonClient, Address } = require("@ton/ton");

// ── Config ────────────────────────────────────────────────────────────────────
const BOT_TOKEN       = process.env.BOT_TOKEN;
const CONTRACT_ADDR   = process.env.CONTRACT_ADDRESS;
const CHANNEL_ID      = process.env.CHANNEL_ID;         // e.g. "@SpinMintApp" or "-1001234567890"
const TONCENTER_KEY   = process.env.TONCENTER_API_KEY;
const APP_URL         = process.env.APP_URL ?? "https://spinmint-tg.vercel.app";
const MINI_APP_URL    = process.env.MINI_APP_URL ?? "https://t.me/SpinMintingbot/play";

if (!BOT_TOKEN)     throw new Error("BOT_TOKEN is required");
if (!CONTRACT_ADDR) throw new Error("CONTRACT_ADDRESS is required");
if (!CHANNEL_ID)    throw new Error("CHANNEL_ID is required");

const bot = new Telegraf(BOT_TOKEN);

const ton = new TonClient({
  endpoint: "https://toncenter.com/api/v2/jsonRPC",
  apiKey: TONCENTER_KEY,
});

// ── Inline play button ─────────────────────────────────────────────────────────
const playButton = () =>
  Markup.inlineKeyboard([
    Markup.button.url("🎰  SPIN NOW  —  1 TON", MINI_APP_URL),
  ]);

// ── Contract reads ────────────────────────────────────────────────────────────
async function getJackpot() {
  try {
    const res = await ton.runMethod(Address.parse(CONTRACT_ADDR), "jackpot", []);
    return res.stack.readBigNumber(); // nanotons
  } catch {
    return null;
  }
}

async function getTotalSpins() {
  try {
    const res = await ton.runMethod(Address.parse(CONTRACT_ADDR), "totalSpins", []);
    return res.stack.readBigNumber();
  } catch {
    return null;
  }
}

function fmtTon(nano) {
  return `${parseFloat((Number(nano) / 1e9).toFixed(2))} TON`;
}

// ── Channel posts ─────────────────────────────────────────────────────────────
async function postToChannel(text, extra = {}) {
  try {
    await bot.telegram.sendMessage(CHANNEL_ID, text, {
      parse_mode: "HTML",
      ...extra,
      ...playButton(),
    });
  } catch (e) {
    console.error("Channel post failed:", e.message);
  }
}

const MILESTONE_MSGS = {
  10:  (j) => `🎰 <b>JACKPOT ALERT</b>\n\nThe SpinMint jackpot just crossed <b>${j}</b> TON!\n\nSpin for <b>1 TON</b> and take it all — 2% shot at the full pot.`,
  25:  (j) => `🔥 <b>JACKPOT HEATING UP</b>\n\nSpinMint pool: <b>${j}</b> TON and climbing.\n\nSomeone's going to win this. Could be you.`,
  50:  (j) => `💰 <b>BIG JACKPOT</b> — <b>${j}</b> TON\n\nThe SpinMint pool is loaded. 1 TON to spin, winner takes all.`,
  100: (j) => `🚨🚨 <b>MASSIVE JACKPOT — ${j}</b> TON 🚨🚨\n\nThis is the biggest SpinMint pot yet.\n\nSpin for 1 TON. Winner takes everything.`,
};

const MILESTONES = [10n, 25n, 50n, 100n, 200n, 500n].map(n => n * 1_000_000_000n);

// ── State tracking ────────────────────────────────────────────────────────────
let lastJackpot        = 0n;
let lastTotalSpins     = 0n;
let milestonesPosted   = new Set();
let lastHourlyPost     = 0;
let jackpotWonPosted   = false;

// ── Monitor loop ──────────────────────────────────────────────────────────────
async function monitor() {
  const jackpot    = await getJackpot();
  const totalSpins = await getTotalSpins();
  if (jackpot === null) return;

  const jackpotTon = jackpot / 1_000_000_000n;
  const now        = Date.now();

  // Jackpot won — detect big drop (>= 5 TON drop, jackpot now tiny)
  if (lastJackpot > 5_000_000_000n && jackpot < 1_000_000_000n && !jackpotWonPosted) {
    const won = fmtTon(lastJackpot);
    await postToChannel(
      `🏆 <b>JACKPOT WON!</b>\n\nSomeone just claimed the <b>${won}</b> SpinMint jackpot!\n\nThe pool resets. Be first to grow it. 1 TON per spin.`
    );
    jackpotWonPosted = true;
    milestonesPosted.clear(); // reset milestones for the new cycle
  }

  if (jackpot >= 1_000_000_000n) jackpotWonPosted = false;

  // Milestone alerts
  for (const milestone of MILESTONES) {
    const mileTon = Number(milestone / 1_000_000_000n);
    if (jackpot >= milestone && lastJackpot < milestone && !milestonesPosted.has(mileTon)) {
      const msgFn = MILESTONE_MSGS[mileTon] ?? ((j) => `🎰 SpinMint jackpot: <b>${j}</b> TON`);
      await postToChannel(msgFn(fmtTon(jackpot)));
      milestonesPosted.add(mileTon);
    }
  }

  // Hourly heartbeat when jackpot is interesting (>= 2 TON)
  if (jackpot >= 2_000_000_000n && now - lastHourlyPost > 60 * 60 * 1000) {
    const spins = totalSpins !== null ? Number(totalSpins) : "?";
    await postToChannel(
      `🎰 <b>SpinMint — Live Jackpot</b>\n\n💰 Pool: <b>${fmtTon(jackpot)}</b>\n🔄 Total spins: <b>${spins.toLocaleString()}</b>\n\nTelegram's onchain spin game. 1 TON to play.`
    );
    lastHourlyPost = now;
  }

  lastJackpot    = jackpot;
  if (totalSpins !== null) lastTotalSpins = totalSpins;
}

// ── Group commands ────────────────────────────────────────────────────────────

// /start — works in DM and groups
bot.start(async (ctx) => {
  const jackpot = await getJackpot();
  const pool    = jackpot !== null ? fmtTon(jackpot) : "growing";
  await ctx.reply(
    `🎰 <b>SpinMint</b> — Telegram's onchain spin game\n\n💰 Current jackpot: <b>${pool}</b>\n🎯 1 TON per spin  •  2% jackpot odds\n\nTap below to play inside Telegram 👇`,
    { parse_mode: "HTML", ...playButton() }
  );
});

// /play — post a spin invite in any group
bot.command("play", async (ctx) => {
  const jackpot = await getJackpot();
  const pool    = jackpot !== null ? fmtTon(jackpot) : "growing";
  await ctx.reply(
    `🎰 <b>SpinMint</b>\n\n💰 Jackpot: <b>${pool}</b>  •  1 TON to spin\n\nWin the full pool, 1.5 TON, or a rare NFT 🍭`,
    { parse_mode: "HTML", ...playButton() }
  );
});

// /jackpot — just the current pot
bot.command("jackpot", async (ctx) => {
  const jackpot = await getJackpot();
  if (jackpot === null) {
    await ctx.reply("⚠️ Couldn't fetch jackpot right now. Try again shortly.");
    return;
  }
  await ctx.reply(
    `💰 <b>SpinMint Jackpot: ${fmtTon(jackpot)}</b>\n\nSpin for 1 TON — winner takes all.`,
    { parse_mode: "HTML", ...playButton() }
  );
});

// /spins — total spin count
bot.command("spins", async (ctx) => {
  const total = await getTotalSpins();
  if (total === null) {
    await ctx.reply("⚠️ Couldn't fetch spin count right now.");
    return;
  }
  await ctx.reply(
    `🔄 <b>${Number(total).toLocaleString()} total spins</b> on SpinMint so far.`,
    { parse_mode: "HTML", ...playButton() }
  );
});

// /help
bot.command("help", async (ctx) => {
  await ctx.reply(
    `<b>SpinMint Bot</b>\n\n/play — post a spin invite\n/jackpot — current pool size\n/spins — total spin count\n\nAdd this bot to any group to bring SpinMint to your community.`,
    { parse_mode: "HTML" }
  );
});

// ── Inline mode — share anywhere ──────────────────────────────────────────────
bot.on("inline_query", async (ctx) => {
  const jackpot = await getJackpot();
  const pool    = jackpot !== null ? fmtTon(jackpot) : "growing";

  await ctx.answerInlineQuery([
    {
      type: "article",
      id: "spinmint-play",
      title: `🎰 SpinMint — Jackpot: ${pool}`,
      description: "1 TON per spin. Win the full jackpot, TON prizes, or a rare NFT.",
      input_message_content: {
        message_text: `🎰 <b>SpinMint</b>\n\n💰 Jackpot: <b>${pool}</b>  •  1 TON to spin\n\nTelegram's onchain spin game. Win the full pot, TON prizes, or a rare NFT 🍭`,
        parse_mode: "HTML",
      },
      reply_markup: playButton().reply_markup,
    },
  ], { cache_time: 30 });
});

// Bot added to a group — post intro
bot.on("my_chat_member", async (ctx) => {
  const update = ctx.update.my_chat_member;
  const isAdded =
    update.new_chat_member.status === "member" ||
    update.new_chat_member.status === "administrator";

  if (!isAdded) return;
  if (ctx.chat.type === "private") return;

  const jackpot = await getJackpot();
  const pool    = jackpot !== null ? fmtTon(jackpot) : "growing";

  await ctx.reply(
    `🎰 <b>SpinMint is here!</b>\n\nTelegram's onchain spin game just joined the group.\n\n💰 Live jackpot: <b>${pool}</b>\n🎯 1 TON per spin  •  No signup needed\n\nUse /play anytime to bring up the game.`,
    { parse_mode: "HTML", ...playButton() }
  );
});

// ── Launch ────────────────────────────────────────────────────────────────────
bot.launch(() => {
  console.log("✅ SpinMint promo bot running");

  // Start contract monitor (poll every 60s)
  monitor();
  setInterval(monitor, 60_000);
});

process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
