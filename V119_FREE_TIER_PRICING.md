# Card Vault v1.1.9

Goal: keep pricing usable without requiring paid Gemini billing.

Flow:
1. Check the on-device 12-hour price cache.
2. If no cached result exists, try Gemini with Google Search grounding.
3. If Google returns 429 Too Many Requests, retry once without Google Search grounding.
4. Clearly label that result "AI estimate • limited data".
5. Never pretend the fallback is an eBay sold-price average.

The fallback is less accurate than live marketplace comps. Once eBay developer access is approved, exact eBay marketplace data should become the primary pricing source.
