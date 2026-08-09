# Card Vault v0.3 — Deploy Build

This version is prepared for a free Render deployment and uses the Gemini API for real front/back card image recognition.

## Why this build
- Render can host the Node/Express app on its free web-service tier for hobby testing.
- Gemini 3 Flash currently has a free API tier.
- Your Gemini API key stays server-side and is never shipped to Safari.
- Card Vault remains installable from Safari using Add to Home Screen.

## What you need
1. A free GitHub account.
2. A free Render account.
3. A Google account and a Gemini API key from Google AI Studio.

## Deploy flow
### 1. Put this project in GitHub
Create a new GitHub repository called `card-vault`.
Upload the contents of this project so `package.json`, `render.yaml`, `public/`, and `server/` are at the repository root.

### 2. Get a Gemini API key
Open Google AI Studio and create a Gemini API key.
Do not put the key into `public/app.js`, HTML, or GitHub.

### 3. Deploy on Render
In Render:
- New → Blueprint, then connect the GitHub repository.
- Render reads `render.yaml`.
- When prompted for `GEMINI_API_KEY`, paste your Gemini key.
- Deploy.

After deployment Render gives you an HTTPS URL such as:
`https://card-vault-xxxx.onrender.com`

### 4. Install on iPhone
In Safari:
- Open the Render URL.
- Share.
- Add to Home Screen.
- Open Card Vault from the icon.

## Free-tier notes
Free hosting can sleep when idle, so the first load after inactivity may be slower.
Gemini free-tier usage has quotas and availability limits.
This build is intended for you and a few friends while testing.

## Important privacy note
Google's pricing/docs indicate free-tier content may be used to improve Google's products.
Do not upload anything sensitive. Sports-card photos are the intended input here.
