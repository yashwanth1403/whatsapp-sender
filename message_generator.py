"""
message_generator.py
Generates a personalized WhatsApp cold outreach message using OpenAI
based on GBP lead data and the deployed website URL.
"""
import os
from openai import OpenAI


def generate_messages(business: dict, deploy_url: str) -> tuple[str, str]:
    """
    Returns two short WhatsApp messages as a tuple (msg1, msg2).
    msg1 — intro/hook, no link
    msg2 — contains the website link + CTA
    """
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

    name    = business.get("name", "")
    city    = business.get("address", "").split(",")[-3].strip() if business.get("address") else ""
    rating  = business.get("rating", "")
    reviews = business.get("review_count", "")

    prompt = f"""You are writing a WhatsApp cold outreach to a business owner in India.

Business details:
- Name: {name}
- City: {city}
- Google Rating: {rating} stars from {reviews} reviews
- Demo website URL: {deploy_url}

Write exactly TWO short messages separated by the delimiter ---

Message 1 (intro/hook):
- Max 2 lines
- Greet them by business name
- Mention you found them on Google and noticed they don't have a website
- No link in this message
- 1 emoji max

Message 2 (link message):
- Max 2 lines
- Say you built a free demo website for them
- Include the URL: {deploy_url}
- End with a simple yes/no question
- 1 emoji max

Tone: friendly, conversational, not salesy.
Return ONLY the two messages separated by ---, nothing else."""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=200,
        temperature=0.7,
    )

    raw = response.choices[0].message.content.strip()
    parts = [p.strip() for p in raw.split("---") if p.strip()]

    msg1 = parts[0] if len(parts) > 0 else f"Hi {name}, I found your business on Google and noticed you don't have a website yet."
    msg2 = parts[1] if len(parts) > 1 else f"I built a free demo for you: {deploy_url} — interested?"

    return msg1, msg2
