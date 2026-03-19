# SignBridge 🤟

A WhatsApp-style messaging app with real-time AI sign language detection and native language caption translation during video calls.

---

## 🚀 Deploy in 2 minutes

### Option A — Vercel (recommended, free)

1. Install Vercel CLI:
   ```bash
   npm install -g vercel
   ```
2. Inside this folder:
   ```bash
   npm install
   vercel
   ```
3. Follow the prompts → your app is live at `https://signbridge.vercel.app` (or similar)

---

### Option B — Netlify (free, drag & drop)

1. Build the app:
   ```bash
   npm install
   npm run build
   ```
2. Go to **https://app.netlify.com/drop**
3. Drag and drop the `build/` folder → instantly live!

---

### Option C — GitHub Pages (free)

1. Push this folder to a GitHub repo
2. Add to `package.json`:
   ```json
   "homepage": "https://YOUR_USERNAME.github.io/signbridge"
   ```
3. Install gh-pages:
   ```bash
   npm install --save-dev gh-pages
   ```
4. Add to `package.json` scripts:
   ```json
   "predeploy": "npm run build",
   "deploy": "gh-pages -d build"
   ```
5. Run:
   ```bash
   npm run deploy
   ```

---

## 🖥️ Run locally

```bash
npm install
npm start
```

Opens at **http://localhost:3000**

---

## ✨ Features

- 💬 WhatsApp-style chat list with online/away/offline status
- 📹 Full-screen video call UI
- 🧏 Auto sign language detection — bounding box tracks hand on video
- ✦ AI translates detected signs to native language captions (Tamil, Hindi, Malayalam, English, Arabic)
- 🌐 Captions appear directly overlaid on the video feed
- 🎙️ Mic & camera controls
