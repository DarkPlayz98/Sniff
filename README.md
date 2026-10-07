# sniff 👃

**Sniff it before you trust it.**

Sniff is a free scam checker. Paste any suspicious text, WhatsApp forward, email, link or phone number, and in seconds you get a verdict (**SCAM**, **SUSPICIOUS** or **LOOKS SAFE**), the red flags that gave it away, and what to do next. With one tap you can warn your family on WhatsApp.

It's built for the scams people actually get today: fake KYC and bank alerts, UPI fraud, courier "customs fee" messages, digital-arrest calls, task-based job offers, crypto and investment schemes, "Hi mum, new number" impersonation, and look-alike websites like `1robllox.com` or `paypa1.com`.

---

## Features

| Tab | What it does |
|---|---|
| **Sniff** | Paste and check. You get a 0–100 risk score, the scam type, red flags with the matching words highlighted, next steps (including India's cybercrime helpline, 1930) and a "Warn my family" share to WhatsApp. |
| **Spot It** | A daily "Scam or Legit?" game with 5 messages. You get a score and a streak, and can challenge a friend. |
| **Family** | Family Shield: invite up to 6 people (parents, grandparents) over WhatsApp. |
| **Pro** | Plans and an early-access waitlist, priced in ₹ or $. |

**Free tier:** 15 checks a day.

---

## How detection works

Every check runs through two layers:

1. **On-device rules.** These are instant and private. They score patterns for urgency and threats, requests for money, UPI or gift cards, OTP and credential theft, "too good to be true" offers, brand impersonation, risky links (shorteners, risky TLDs, raw IPs) and moves to Telegram or remote-access apps.
   - **Look-alike domains:** the rules compare against more than 40 official brand domains. They undo character swaps (`0→o`, `1→l`, `rn→m`, …) and allow a small spelling distance.
2. **AI layer (optional).** The message is sent to a Cloudflare Worker, which calls Groq. The AI's red flags are merged with the rules' flags.
   - **Safety floor:** if the rules score 65 or more, the result stays **SCAM** even when the AI disagrees.
   - **Fallback:** if the AI can't be reached, Sniff quietly uses the rules alone.

No API key ever ships in the front end.

---

## Project structure

```
index.html   # the whole app (UI, rules engine, game, share cards)
hark.css     # base styles
hark.js      # base helpers
README.md
```

There's no build step and no framework. It's a static site.

---

## Run locally

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open http://localhost:8080.

---

## AI backend (Cloudflare Worker + Groq)

1. Get an API key from the Groq console (console.groq.com → API Keys).
2. In the Cloudflare dashboard: **Workers & Pages → Create → Create Worker** (Hello World template). Name it `sniff-api` and deploy.
3. Click **Edit code**, paste the Sniff proxy worker, and deploy.
4. Go to **Settings → Variables and Secrets → Add**. Choose type **Secret**, name it `GROQ_API_KEY`, set your key as the value, and deploy.
5. Make sure the worker uses a model your Groq plan supports, for example:
   ```js
   const MODEL = "openai/gpt-oss-120b";
   ```
6. Point the front end at your Worker. This is the first line of the script in `index.html`:
   ```js
   const SNIFF_API_URL = "https://sniff-api.<your-subdomain>.workers.dev/";
   ```
   Leave it as `""` to run on rules only.

**API contract.** Send `POST { "message": "..." }`. The response looks like this:

```json
{
  "verdict": "SCAM | SUSPICIOUS | LOOKS_SAFE",
  "score": 0,
  "scam_type": "Fake KYC / bank",
  "red_flags": [{ "title": "", "explanation": "", "quote": "" }],
  "what_to_do": [""],
  "summary": ""
}
```

**Protect your bill:** set a spend limit in the Groq console and a rate limit on the Worker.

---

## Deploy (Vercel)

```bash
npx vercel          # first deploy and login
npx vercel --prod   # production URL
```

You can also push to GitHub and import the repo in Vercel: choose **Framework preset: Other** and no build command. Add a custom domain under **Project → Settings → Domains**.

> Share messages currently point to `sniff.app`. Replace them with your real domain before launch.

---

## Roadmap

- [ ] WhatsApp bot: forward a message to Sniff and get a verdict back
- [ ] Screenshot (OCR) scanning
- [ ] Link reputation lookups (Safe Browsing / domain-age data)
- [ ] Accounts, saved streaks and real Family Shield alerts
- [ ] Payments (Razorpay / Stripe) for Pro and Family
- [ ] Sniff API for banks, fintechs and telecoms

---

## Business model

- **Free:** 15 checks a day, the Spot It game and family warnings
- **Pro:** ₹99/mo ($3.99) for unlimited checks, screenshot scanning, deep link scans and scam-call scripts
- **Family:** ₹199/mo ($6.99) for Pro for up to 6 people, near-miss alerts and a monthly report
- **B2B:** a scam-detection API for banks and telecoms

---

## Disclaimer

Sniff gives guidance, not guarantees. If you've already paid or shared an OTP, call your bank right away and report it at **1930** or **cybercrime.gov.in** (India).

## License

MIT
