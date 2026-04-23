# DINGERS — Deploy Instructions
Full stack: React PWA (Vercel) + Node backend (Railway) + Pushover alerts

---

## STEP 1 — Get Pushover ($5 one-time)
1. Go to https://pushover.net and create an account
2. Download the Pushover app on your iPhone
3. Note your **User Key** from the dashboard
4. Go to https://pushover.net/apps/build → create app called "Dingers"
5. Note your **API Token**

---

## STEP 2 — Get your API keys
You need two keys:
- **Anthropic API key** → https://console.anthropic.com → API Keys → Create key
- **Pushover token + user key** (from Step 1)

---

## STEP 3 — Push code to GitHub
1. Go to https://github.com → New repository → name it `dingers` → Create
2. On your computer, open Terminal and run:

```bash
cd ~/Downloads          # or wherever you saved the dingers folder
git init
git add .
git commit -m "initial"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/dingers.git
git push -u origin main
```

---

## STEP 4 — Deploy backend to Railway (free)
1. Go to https://railway.app → sign up with GitHub
2. New Project → Deploy from GitHub repo → select `dingers`
3. When prompted for root directory, type: `backend`
4. Railway will auto-detect Node.js
5. Go to your service → Variables tab → add these:

```
PUSHOVER_TOKEN=your_pushover_api_token
PUSHOVER_USER=your_pushover_user_key
PORT=3001
```

6. Go to Settings → Networking → Generate Domain
7. Copy the domain URL (looks like: `dingers-backend.up.railway.app`)

---

## STEP 5 — Deploy frontend to Vercel (free)
1. Go to https://vercel.com → sign up with GitHub
2. New Project → Import `dingers` repo
3. Set **Root Directory** to `frontend`
4. Add Environment Variable:

```
VITE_API_URL=https://your-railway-domain.up.railway.app
VITE_ANTHROPIC_API_KEY=your_anthropic_api_key
```

5. Hit Deploy
6. Vercel gives you a URL like `dingers.vercel.app`

---

## STEP 6 — Add to iPhone home screen (makes it feel like an app)
1. Open Safari on your iPhone (must be Safari, not Chrome)
2. Go to your Vercel URL
3. Tap the Share button (box with arrow) at the bottom
4. Scroll down → tap "Add to Home Screen"
5. Name it "Dingers" → tap Add
6. It now lives on your home screen like a real app

---

## STEP 7 — Test it
- Open the app → you should see today's games loading
- Hit Refresh → plays, weather, park factors populate
- Tap any player name → deep dive opens with real MLB stats
- Next time someone hits a HR during a game → Pushover sends a push notification to your iPhone within 60 seconds

---

## Troubleshooting

**"Failed to fetch" errors** → Your Railway backend URL in Vercel env vars has a typo, or Railway hasn't started yet (check Railway logs)

**No push notifications** → Double-check PUSHOVER_TOKEN and PUSHOVER_USER in Railway variables. Make sure Pushover app is installed and notifications are allowed in iPhone Settings.

**"No plays" section** → Anthropic API key is missing or incorrect in Vercel env vars

**Players not loading in deep dive** → MLB Stats API occasionally rate-limits. Wait 30 seconds and try again.

---

## Cost Summary
| Service | Cost |
|---------|------|
| Pushover | $5 one-time |
| Railway | Free (500 hrs/month) |
| Vercel | Free |
| Anthropic API | ~$1-3/month at normal usage |
| MLB Stats API | Free, no key needed |
| **Total** | **~$5 + ~$2/month** |
