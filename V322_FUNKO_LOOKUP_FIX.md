# Card Vault v3.2.2 — Funko Lookup Fix

Fixes barcodes and Funko name searches returning zero results.

The old lookup integration was using the wrong API route/response shape.

v3.2.2 uses UPCitemdb Explorer:
- GET /prod/trial/lookup?upc=...
- GET /prod/trial/search?s=...
- free, no signup
- 100 combined requests/day
- 24-hour server cache
- 0 Gemini calls

No Firebase rules changes.
