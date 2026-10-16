# Verity AI (MVP)

Chrome extension + FastAPI backend that turns an offer page into an evidence-linked decision brief
(cost snapshot, important terms, unknowns, next steps). Built from `docs/Verity_AI_PRD_TRD_DESIGN.pdf`.

## Run it

**Backend** (Python 3.11+)
```
cd backend
pip install -r requirements.txt
uvicorn app.main:app --port 8000        # mock LLM by default, fully offline
pytest                                   # 20 tests
```
To use a real model: copy `.env.example` to `backend/.env`, set `VERITY_LLM_PROVIDER=anthropic` and
`VERITY_ANTHROPIC_API_KEY`. If the provider fails, the API returns `status: "partial"` with rule-based findings.

**Extension**
```
cd extension
npm install
npm run build        # typecheck + build to extension/dist
npm test             # 39 tests (price parsing, extraction fixtures, report text, compare)
npm run typecheck
```
Chrome → `chrome://extensions` → Developer mode → Load unpacked → pick `extension/dist`.
Open a pricing/product page, click the Verity icon, accept the disclosure, click **Check this offer**.

## What's implemented (vs. the PRD)
| Area | Status |
|---|---|
| FR-01..07 (P0): user-triggered check, extraction, cost breakdown, terms, evidence, cautious language, error states | Done |
| FR-09 save/delete (local, delete-one + clear-all), FR-10 copy report | Done |
| FR-08 Compare offers (P1): two saved reports side by side, per-row, no overall score, currencies never converted | Done |
| FR-11 alerts (P2) | Not built (out of MVP per PRD) |
| Deterministic Decimal cost engine, currency kept separate, unknown stays unknown | Done |
| Evidence validator (drops uncited claims and "scam/fraud/safe" verdict wording) | Done |
| Consent screen, privacy/limitations screen, privacy-aware logs, URL scheme checks, size + rate limits | Done |

## Extraction layer (extension/src/extraction)
On click, `content.js` (a standalone classic script, injected with `activeTab` + `scripting`) reads visible price/terms
text and returns, besides the evidence sent for analysis, a local `StructuredOffer` (`verity.extraction/1`):
prices with currency, cadence (one-time / monthly / annual / other) and role (introductory / renewal / regular),
trial, billing interval, renewal, shipping, setup/mandatory fees, taxes, cancellation, refund, auto-renewal and
minimum commitment. Every claim carries a short exact quote, source (`json_ld`, `meta_tags`, `visible_text`) and a
selector. Unstated fields stay `unknown`; several different prices are all kept and flagged `ambiguous_prices`.
`confidence` rates extraction quality only, never the merchant. The structured offer is not stored or sent anywhere.

Extraction limits: heuristics are English-centric for terms (prices handle many number formats); bare `$`/`¥` keep
currency unknown; text in iframes, canvases, images or behind clicks isn't read; dynamic pages get one 0.9 s retry;
Chrome blocks `chrome://`, the Web Store and file URLs. Demo reports (popup → "See an example report") are labelled
built-in samples.

## Known gaps / next steps
- Extraction is heuristic (price/terms keyword blocks); it needs the evaluation corpus from the PRD validation plan before any accuracy claims.
- `host_permissions` is `localhost:8000` only; change it and `VITE_API_BASE` when you deploy the API.
- Rate limiting is in-memory (single process). Use a shared store behind multiple workers.
- No E2E browser test yet. Icons are simple generated placeholders (`public/icons`).
- Compare works with your last 3 checks (kept in memory via `chrome.storage.session`, erased when the browser closes) or saved reports. It compares two offers only.
