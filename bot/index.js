const { Telegraf, Markup } = require("telegraf");
const { TonClient, Address } = require("@ton/ton");
const fs   = require("fs");
const path = require("path");

// ── Config ────────────────────────────────────────────────────────────────────
const BOT_TOKEN     = process.env.BOT_TOKEN;
const CONTRACT_ADDR = process.env.CONTRACT_ADDRESS;
const CHANNEL_ID    = process.env.CHANNEL_ID;
const TONCENTER_KEY = process.env.TONCENTER_API_KEY;
const MINI_APP_URL  = process.env.MINI_APP_URL  ?? "https://t.me/SpinMintingbot/play";
const OWNER_ID      = process.env.OWNER_TG_ID   ? Number(process.env.OWNER_TG_ID) : null;
const DATA_FILE     = process.env.DATA_FILE ?? "/data/groups.json";
const BROADCAST_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

if (!BOT_TOKEN)     throw new Error("BOT_TOKEN is required");
if (!CONTRACT_ADDR) throw new Error("CONTRACT_ADDRESS is required");
if (!CHANNEL_ID)    throw new Error("CHANNEL_ID is required");

const bot = new Telegraf(BOT_TOKEN);

const ton = new TonClient({
  endpoint: "https://toncenter.com/api/v2/jsonRPC",
  apiKey: TONCENTER_KEY,
});

// ── Group registry (persisted to disk) ───────────────────────────────────────
function loadGroups() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return new Set(data.groups ?? []);
  } catch {
    return new Set();
  }
}

function saveGroups() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify({ groups: [...groupChats] }));
  } catch (e) {
    console.error("Failed to save groups:", e.message);
  }
}

const groupChats = loadGroups();
console.log(`Loaded ${groupChats.size} group(s) from disk`);

function registerGroup(chatId, type) {
  if (type === "group" || type === "supergroup") {
    groupChats.add(chatId);
    saveGroups();
  }
}

// ── Inline play button ────────────────────────────────────────────────────────
const playButton = () =>
  Markup.inlineKeyboard([
    Markup.button.url("🎰  SPIN NOW  —  1 TON", MINI_APP_URL),
  ]);

// ── Contract reads ────────────────────────────────────────────────────────────
async function getJackpot() {
  try {
    const res = await ton.runMethod(Address.parse(CONTRACT_ADDR), "jackpot", []);
    return res.stack.readBigNumber();
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

// ── Broadcast to all known groups ─────────────────────────────────────────────
async function broadcastToGroups(text) {
  const dead = [];
  for (const chatId of groupChats) {
    try {
      await bot.telegram.sendMessage(chatId, text, {
        parse_mode: "HTML",
        ...playButton(),
      });
      await new Promise(r => setTimeout(r, 500)); // avoid flood limits
    } catch (e) {
      // Bot was kicked or group deleted — remove from registry
      if (e.code === 403 || e.code === 400) dead.push(chatId);
      else console.error(`Broadcast failed for ${chatId}:`, e.message);
    }
  }
  dead.forEach(id => groupChats.delete(id));
}

// ── Scheduled broadcast messages ──────────────────────────────────────────────
const BROADCAST_MSGS = [
  (j, s) => `🎰 <b>SpinMint — Live Jackpot</b>\n\n💰 Pool: <b>${j}</b>\n🔄 Total spins: <b>${s}</b>\n\nTelegram's onchain spin game. 1 TON to play, winner takes the pot.`,
  (j, s) => `💰 <b>${j} up for grabs on SpinMint</b>\n\n🎯 2% shot at the jackpot\n🍭 Rare NFT prizes\n🔄 ${s} spins and counting\n\n1 TON per spin. No signup.`,
  (j, s) => `🚨 <b>SpinMint Jackpot Alert</b>\n\nThe pool is at <b>${j}</b> right now.\n\nSpin for 1 TON inside Telegram — no wallet setup, no bridge, just connect and play.`,
  (j, s) => `🍭 <b>SpinMint</b> — onchain slots inside Telegram\n\n💰 Jackpot: <b>${j}</b>\n🔄 <b>${s}</b> total spins\n\nWin TON, win rare NFTs, or take the whole pot. 1 TON per spin.`,
];

let broadcastIndex = 0;

async function scheduledBroadcast() {
  if (groupChats.size === 0) return;

  const jackpot    = await getJackpot();
  const totalSpins = await getTotalSpins();
  if (jackpot === null) return;

  const j = fmtTon(jackpot);
  const s = totalSpins !== null ? Number(totalSpins).toLocaleString() : "?";
  const msgFn = BROADCAST_MSGS[broadcastIndex % BROADCAST_MSGS.length];
  broadcastIndex++;

  console.log(`Broadcasting to ${groupChats.size} group(s)`);
  await broadcastToGroups(msgFn(j, s));
}

// ── Channel monitor ───────────────────────────────────────────────────────────
async function postToChannel(text) {
  try {
    await bot.telegram.sendMessage(CHANNEL_ID, text, {
      parse_mode: "HTML",
      ...playButton(),
    });
  } catch (e) {
    console.error("Channel post failed:", e.message);
  }
}

const MILESTONES = [10n, 25n, 50n, 100n, 200n, 500n].map(n => n * 1_000_000_000n);
const MILESTONE_MSGS = {
  10:  (j) => `🎰 <b>JACKPOT ALERT</b>\n\nSpinMint pool just crossed <b>${j}</b>!\n\nSpin for 1 TON — 2% shot at the full pot.`,
  25:  (j) => `🔥 <b>JACKPOT HEATING UP</b>\n\nSpinMint pool: <b>${j}</b> and climbing.`,
  50:  (j) => `💰 <b>BIG JACKPOT — ${j}</b>\n\n1 TON to spin, winner takes all.`,
  100: (j) => `🚨🚨 <b>MASSIVE JACKPOT — ${j}</b> 🚨🚨\n\nBiggest SpinMint pot yet. Spin for 1 TON.`,
};

let lastJackpot      = 0n;
let milestonesPosted = new Set();
let jackpotWonPosted = false;
let lastHourlyPost   = 0;

async function monitor() {
  const jackpot    = await getJackpot();
  const totalSpins = await getTotalSpins();
  if (jackpot === null) return;

  const now = Date.now();

  // Jackpot won
  if (lastJackpot > 5_000_000_000n && jackpot < 1_000_000_000n && !jackpotWonPosted) {
    const won = fmtTon(lastJackpot);
    await postToChannel(`🏆 <b>JACKPOT WON!</b>\n\nSomeone just claimed <b>${won}</b>!\n\nPool resets. 1 TON per spin.`);
    jackpotWonPosted = true;
    milestonesPosted.clear();
  }
  if (jackpot >= 1_000_000_000n) jackpotWonPosted = false;

  // Milestones
  for (const milestone of MILESTONES) {
    const mileTon = Number(milestone / 1_000_000_000n);
    if (jackpot >= milestone && lastJackpot < milestone && !milestonesPosted.has(mileTon)) {
      const msgFn = MILESTONE_MSGS[mileTon] ?? ((j) => `🎰 SpinMint jackpot: <b>${j}</b>`);
      await postToChannel(msgFn(fmtTon(jackpot)));
      milestonesPosted.add(mileTon);
    }
  }

  // Hourly channel heartbeat
  if (jackpot >= 2_000_000_000n && now - lastHourlyPost > 60 * 60 * 1000) {
    const s = totalSpins !== null ? Number(totalSpins).toLocaleString() : "?";
    await postToChannel(`🎰 <b>SpinMint — Live</b>\n\n💰 Pool: <b>${fmtTon(jackpot)}</b>\n🔄 Spins: <b>${s}</b>\n\n1 TON to play.`);
    lastHourlyPost = now;
  }

  lastJackpot = jackpot;
}

// ── Bot commands ──────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  registerGroup(ctx.chat.id, ctx.chat.type);
  const jackpot = await getJackpot();
  const pool    = jackpot !== null ? fmtTon(jackpot) : "growing";
  await ctx.reply(
    `🎰 <b>SpinMint</b> — Telegram's onchain spin game\n\n💰 Current jackpot: <b>${pool}</b>\n🎯 1 TON per spin  •  2% jackpot odds\n\nTap below to play 👇`,
    { parse_mode: "HTML", ...playButton() }
  );
});

bot.command("play", async (ctx) => {
  registerGroup(ctx.chat.id, ctx.chat.type);
  const jackpot = await getJackpot();
  const pool    = jackpot !== null ? fmtTon(jackpot) : "growing";
  await ctx.reply(
    `🎰 <b>SpinMint</b>\n\n💰 Jackpot: <b>${pool}</b>  •  1 TON to spin\n\nWin the full pool, TON prizes, or a rare NFT 🍭`,
    { parse_mode: "HTML", ...playButton() }
  );
});

bot.command("jackpot", async (ctx) => {
  registerGroup(ctx.chat.id, ctx.chat.type);
  const jackpot = await getJackpot();
  if (jackpot === null) { await ctx.reply("⚠️ Couldn't fetch jackpot right now."); return; }
  await ctx.reply(
    `💰 <b>SpinMint Jackpot: ${fmtTon(jackpot)}</b>\n\nSpin for 1 TON — winner takes all.`,
    { parse_mode: "HTML", ...playButton() }
  );
});

bot.command("spins", async (ctx) => {
  registerGroup(ctx.chat.id, ctx.chat.type);
  const total = await getTotalSpins();
  if (total === null) { await ctx.reply("⚠️ Couldn't fetch spin count."); return; }
  await ctx.reply(
    `🔄 <b>${Number(total).toLocaleString()} total spins</b> on SpinMint so far.`,
    { parse_mode: "HTML", ...playButton() }
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    `<b>SpinMint Bot</b>\n\n/play — post a spin invite\n/jackpot — current pool size\n/spins — total spin count\n\nAdd this bot to any group to bring SpinMint to your community.`,
    { parse_mode: "HTML" }
  );
});

// Owner-only: force a broadcast right now (for testing)
bot.command("broadcast", async (ctx) => {
  if (!OWNER_ID || ctx.from.id !== OWNER_ID) return;
  await ctx.reply(`Broadcasting to ${groupChats.size} group(s)...`);
  await scheduledBroadcast();
  await ctx.reply("Done.");
});

// Owner-only: list registered groups
bot.command("groups", async (ctx) => {
  if (!OWNER_ID || ctx.from.id !== OWNER_ID) return;
  await ctx.reply(`Registered groups: ${groupChats.size}\n${[...groupChats].join("\n")}`);
});

// ── Inline mode ───────────────────────────────────────────────────────────────
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

// ── Group join / register ─────────────────────────────────────────────────────
bot.on("my_chat_member", async (ctx) => {
  const update = ctx.update.my_chat_member;
  const isAdded = update.new_chat_member.status === "member" ||
                  update.new_chat_member.status === "administrator";
  if (!isAdded) {
    groupChats.delete(ctx.chat.id);
    saveGroups();
    return;
  }
  if (ctx.chat.type === "private") return;
  registerGroup(ctx.chat.id, ctx.chat.type);

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

  // Contract monitor every 60s
  monitor();
  setInterval(monitor, 60_000);

  // Broadcast to groups every 4 hours
  setInterval(scheduledBroadcast, BROADCAST_INTERVAL_MS);
  // First broadcast after 10 minutes (let groups register first)
  setTimeout(scheduledBroadcast, 10 * 60 * 1000);
});

process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
