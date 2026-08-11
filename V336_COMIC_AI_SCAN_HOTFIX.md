# Card Vault v3.3.6 — Comic AI Scan Hotfix

- fixes false `Too many AI scans from this connection` lockout
- real forwarded client IP handling on Render
- 120/hr generic AI limiter
- separate 90/hr comic cover limiter
- 24h identical-cover result cache
- Gemini model fallback on 429 / 503
- metadata fallback if visual ranking cannot run
- clearer quota vs Card Vault limiter messages
- barcode/manual Metron remain usable
- no Firebase rule changes
- no new environment variables
