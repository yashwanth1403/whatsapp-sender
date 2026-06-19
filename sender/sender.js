/**
 * sender.js — Baileys WhatsApp sender
 * Best practices from whatsapp_bot_techDr project.
 *
 * Usage:
 *   node sender.js setup   → scan QR once, saves session
 *   node sender.js send    → reads JSON from stdin: { phone, msg1, msg2 }
 */

const {
  default: makeWASocket,
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const path = require("path");

const AUTH_DIR = path.join(__dirname, "auth_info");
const logger = pino({ level: "silent" });

const [, , mode] = process.argv;

// ── Connection state guards (mirrors baileys.manager.ts) ─────────────────────
let socket = null;
let isInitialising = false;
let isManualClose = false;
let reconnectAttempts = 0;

// ── Core connect function ─────────────────────────────────────────────────────
async function initSocket(onOpen) {
  if (isInitialising) return;
  isInitialising = true;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`  [WA] Baileys v${version.join(".")} (latest: ${isLatest})`);

    socket = makeWASocket({
      version,
      auth: state,
      logger,
      browser: Browsers.macOS("Desktop"),   // ← looks like real macOS client
      syncFullHistory: false,                // ← don't load history (reduces ban risk)
      printQRInTerminal: false,
    });

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;

      if (qr) {
        console.log("\n📱 Scan QR in WhatsApp → Linked Devices:\n");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "open") {
        reconnectAttempts = 0;
        console.log("  ✅ WhatsApp connected");
        await onOpen(socket);
      }

      if (connection === "close") {
        socket = null;

        // Manual close — don't reconnect
        if (isManualClose) {
          isManualClose = false;
          return;
        }

        // Logged out — must re-scan QR
        if (statusCode === DisconnectReason.loggedOut) {
          console.error("❌ Logged out — delete auth_info/ and run setup again.");
          process.exit(1);
        }

        // Exponential backoff reconnect (same as existing project)
        reconnectAttempts += 1;
        const delayMs = Math.min(3000 * reconnectAttempts, 30_000);
        console.log(`  ⚠️  Disconnected (code ${statusCode}) — retry in ${delayMs}ms`);
        setTimeout(() => {
          isInitialising = false;
          initSocket(onOpen);
        }, delayMs);
      }
    });
  } finally {
    isInitialising = false;
  }
}

// ── Graceful close ────────────────────────────────────────────────────────────
async function closeSocket() {
  if (!socket) return;
  isManualClose = true;
  try { socket.end(undefined); } catch {}
  socket = null;
}

// ── Setup: scan QR and save session ──────────────────────────────────────────
async function setup() {
  console.log("🔧 Setting up WhatsApp session...");
  await initSocket(async () => {
    console.log("✅ Session saved. You can now send messages.\n");
    await closeSocket();
    process.exit(0);
  });
}

// ── Send: read JSON from stdin, send two messages ────────────────────────────
function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
  });
}

async function send() {
  const raw = await readStdin();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("❌ Invalid JSON from stdin");
    process.exit(1);
  }

  const { phone, msg1, msg2 } = parsed;
  if (!phone || !msg1 || !msg2) {
    console.error("❌ stdin JSON must have: phone, msg1, msg2");
    process.exit(1);
  }

  const jid = `91${phone}@s.whatsapp.net`;

  await initSocket(async (sock) => {
    try {
      // Verify the number is on WhatsApp
      console.log(`  🔍 Verifying +91${phone} on WhatsApp...`);
      const [result] = await sock.onWhatsApp(jid);
      if (!result?.exists) {
        console.error(`  ❌ +91${phone} is not on WhatsApp`);
        await closeSocket();
        process.exit(1);
      }
      console.log(`  ✅ Number verified`);

      // Send message 1
      const m1 = await sock.sendMessage(jid, { text: msg1 });
      console.log(`  ✅ Message 1 sent — ID: ${m1.key.id}`);

      // Natural 3s gap between messages
      await new Promise((r) => setTimeout(r, 3000));

      // Send message 2 (with link)
      const m2 = await sock.sendMessage(jid, { text: msg2 });
      console.log(`  ✅ Message 2 sent — ID: ${m2.key.id}`);

      // Allow time for delivery receipt before closing
      await new Promise((r) => setTimeout(r, 4000));
      await closeSocket();
      process.exit(0);
    } catch (err) {
      console.error("  ❌ Send error:", err.message);
      await closeSocket();
      process.exit(1);
    }
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────
if (mode === "setup") {
  setup().catch((e) => { console.error(e); process.exit(1); });
} else if (mode === "send") {
  send().catch((e) => { console.error(e); process.exit(1); });
} else {
  console.log("Usage:");
  console.log("  node sender.js setup  — scan QR once");
  console.log("  node sender.js send   — send (reads JSON from stdin)");
  process.exit(0);
}
