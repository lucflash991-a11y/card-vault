# Card Vault v1.7.1 — AI Endurance

Replace in GitHub:
- public/index.html
- public/app.js
- server/server.js
- render.yaml (optional; the server has the same defaults even without it)

Why this update exists:
The prior app used a Gemini 3 Flash preview model. Google's current documentation says preview models can have more restrictive limits. v1.7.1 uses stable Gemini 3.1 Flash-Lite first because it is designed for high-frequency lightweight multimodal workloads, then routes to Gemini 2.5 Flash if the first model is quota/capacity limited.

No billing is required by Card Vault. Actual free-tier limits are still controlled by Google and can vary by project/model.
