"""
agent.py — WhatsApp Outreach Agent (Agent 3)

Usage:
  python agent.py --lead path/to/lead.json --url https://yoursite.netlify.app
  python agent.py --lead path/to/lead.json --url https://yoursite.netlify.app --dry-run

Steps:
  1. Load GBP lead JSON
  2. Generate personalized cold message via OpenAI
  3. Send via WhatsApp using Baileys (Node.js)

First-time setup (scan QR once):
  cd sender && npm install && node sender.js setup
"""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except ImportError:
    pass

from message_generator import generate_messages

SENDER_DIR = ROOT / "sender"


def _digits(phone: str) -> str:
    return re.sub(r"\D", "", phone)


def send_whatsapp(phone_10: str, msg1: str, msg2: str) -> bool:
    """Send two messages via Baileys Node.js sender."""
    auth_dir = SENDER_DIR / "auth_info"
    if not auth_dir.exists() or not any(auth_dir.iterdir()):
        print("\n⚠️  No WhatsApp session found.")
        print("   Run this once to scan QR and save session:")
        print(f"   cd {SENDER_DIR} && node sender.js setup\n")
        return False

    payload = json.dumps({"phone": phone_10, "msg1": msg1, "msg2": msg2})
    print(f"  📤 Sending 2 messages to +91{phone_10} ...")
    result = subprocess.run(
        ["node", "sender.js", "send"],
        input=payload,
        cwd=SENDER_DIR,
        text=True,
        timeout=60,
    )
    return result.returncode == 0


def run(lead_path: Path, deploy_url: str, dry_run: bool, phone_override: str = None) -> None:
    lead = json.loads(lead_path.read_text(encoding="utf-8"))
    business = lead["business"]
    name = business.get("name", "Business")

    if phone_override:
        phone_10 = _digits(phone_override)[-10:]
    else:
        raw_phone = business.get("phone", "")
        phone_10 = _digits(raw_phone)[-10:]

    if not phone_10:
        print(f"❌ No phone number found in lead for {name}")
        return

    print(f"\n=== Agent 3: WhatsApp Outreach — {name} ===")
    print(f"  📱 Phone : +91{phone_10}")
    print(f"  🌐 URL   : {deploy_url}")

    # Generate two messages
    print("  🤖 Generating messages via OpenAI...")
    msg1, msg2 = generate_messages(business, deploy_url)
    print("\n── Message 1 (intro) ────────────────────────────")
    print(msg1)
    print("── Message 2 (link) ─────────────────────────────")
    print(msg2)
    print("─────────────────────────────────────────────────\n")

    if dry_run:
        print("  ℹ️  Dry run — messages NOT sent.")
        return

    success = send_whatsapp(phone_10, msg1, msg2)
    if success:
        print(f"  ✅ Both messages sent to {name} (+91{phone_10})")
    else:
        print(f"  ❌ Failed to send to {name}")


def main():
    parser = argparse.ArgumentParser(description="Agent 3 — WhatsApp cold outreach")
    parser.add_argument("--lead",    required=True, help="Path to GBP lead JSON")
    parser.add_argument("--url",     required=True, help="Deployed website URL")
    parser.add_argument("--phone",   default=None,  help="Override recipient phone (10 digits, no +91)")
    parser.add_argument("--dry-run", action="store_true", help="Generate message but don't send")
    args = parser.parse_args()

    lead_path = Path(args.lead).expanduser().resolve()
    if not lead_path.exists():
        sys.exit(f"Lead file not found: {lead_path}")

    run(lead_path, args.url, dry_run=args.dry_run, phone_override=args.phone)


if __name__ == "__main__":
    main()
