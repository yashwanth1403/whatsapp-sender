/**
 * sender.js — Baileys WhatsApp sender
 *
 * Usage:
 *   node sender.js setup              → scan QR once, saves session
 *   node sender.js send <phone> <msg> → send message using saved session
 *
 * phone: 10-digit Indian mobile number (without +91)
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const path = require("path");

const AUTH_DIR = path.join(__dirname, "auth_info");
const logger = pino({ level: "silent" }); // suppress noisy baileys logs

const [, , mode] = process.argv;

async function connect(onOpen) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ["Car Dealer Agent", "Chrome", "1.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n📱 Scan this QR code in WhatsApp → Linked Devices:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ WhatsApp connected");
      await onOpen(sock);
    }

    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.error("❌ Logged out. Delete auth_info/ and run setup again.");
        process.exit(1);
      } else {
        console.log("⚠️  Connection closed, reconnecting...");
        connect(onOpen);
      }
    }
  });

  return sock;
}

async function setup() {
  console.log("🔧 Setting up WhatsApp session...");
  await connect(async (sock) => {
    console.log("✅ Session saved to auth_info/. You can now send messages.");
    await sock.end();
    process.exit(0);
  });
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

async function send() {
  const raw = await readStdin();
  const { phone, msg1, msg2 } = JSON.parse(raw);

  if (!phone || !msg1 || !msg2) {
    console.error("❌ Invalid input — expected JSON with phone, msg1, msg2");
    process.exit(1);
  }

  const jid = `91${phone}@s.whatsapp.net`;

  await connect(async (sock) => {
    try {
      // Verify number on WhatsApp
      console.log(`  🔍 Checking +91${phone} on WhatsApp...`);
      const [result] = await sock.onWhatsApp(jid);
      if (!result?.exists) {
        console.error(`❌ +91${phone} is not registered on WhatsApp`);
        await sock.end();
        process.exit(1);
      }
      console.log(`  ✅ Number verified`);

      // Send message 1
      const m1 = await sock.sendMessage(jid, { text: msg1 });
      console.log(`✅ Message 1 sent — ID: ${m1.key.id}`);

      // Natural delay between messages (3 seconds)
      await new Promise((r) => setTimeout(r, 3000));

      // Send message 2 (with link)
      const m2 = await sock.sendMessage(jid, { text: msg2 });
      console.log(`✅ Message 2 sent — ID: ${m2.key.id}`);

      await new Promise((r) => setTimeout(r, 4000));
      await sock.end();
      process.exit(0);
    } catch (err) {
      console.error("❌ Failed to send:", err.message);
      process.exit(1);
    }
  });
}

// Entry point
if (mode === "setup") {
  setup().catch((e) => { console.error(e); process.exit(1); });
} else if (mode === "send") {
  send(phone, message).catch((e) => { console.error(e); process.exit(1); });
} else {
  console.log("Usage:");
  console.log("  node sender.js setup              — scan QR once");
  console.log("  node sender.js send <phone> <msg> — send message");
  process.exit(0);
}
