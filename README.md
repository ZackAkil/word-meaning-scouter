# Word Meaning Scouter

Pre-reading vocabulary extractor for EPUB books, powered by Vertex AI Gemini and secured for public Cloud Run hosting with the Scalable Demo Toolkit.

**Live App:** [https://word-meaning-scouter.com](https://word-meaning-scouter.com)

## Features

- **Client-Side EPUB Parsing:** Reads `.epub` files directly in the browser (`epub.js` + `JSZip`). Uploaded files are never saved or stored on the server.
- **Spoiler-Free Vocabulary Extraction:** Extracts the top 4, 8, 16, or 32 trickiest words from any chapter or page range with phonetic pronunciation, part of speech, lexical definitions, and example usage.
- **Crux Paragraph:** Optional toggle that weaves all extracted vocabulary words into a short, self-contained passage with interactive word highlights.
- **Printable Flashcards:** Generates single-sided (foldable) and double-sided (duplex) printable vocabulary sheets.
- **Production Hardened:**
  - Dual-tier rate limiting (`slowapi` + Google Cloud Memorystore for Valkey/Redis) using cookieless SHA-256 IP fingerprinting.
  - Score-based Google Cloud reCAPTCHA Enterprise verification.
  - Prompt-injection isolation (`<book_excerpt>`), structured JSON output schemas, and streaming payload byte caps.
  - Non-blocking background BigQuery usage telemetry.

## Project Structure

```text
word-meaning-scouter/
├── server/
│   ├── main.py                  # FastAPI entrypoint & POST /api/extract-vocabulary
│   ├── gemini_service.py        # Vertex AI Gemini extraction & structured output schema
│   ├── toolkit.py               # Rate limiting, reCAPTCHA, CSP, and static file mounting
│   ├── fingerprint.py           # Cookieless SHA-256 client IP fingerprinting
│   ├── recaptcha_validator.py   # reCAPTCHA Enterprise token validator
│   ├── simple_tracker.py        # Non-blocking BigQuery event logger
│   └── config_utils.py          # GCP Project ID & model configuration
├── client/
│   ├── index.html               # Main UI view
│   ├── app.js                   # Frontend application controller
│   ├── api_client.js            # reCAPTCHA token & protected fetch helper
│   ├── js/                      # Modular EPUB reader, text extractor, and vocabulary UI
│   └── css/                     # Utilitarian component stylesheets
└── scripts/
    ├── dev.sh                   # Local development server (DEV_MODE=true)
    ├── check_gcp.sh             # Pre-flight check for GCP APIs, Valkey, reCAPTCHA & BigQuery
    ├── deploy.sh                # Cloud Run production deployment script
    └── map_domain.sh            # Custom domain mapping script
```

## Local Development

Run locally in `DEV_MODE` (auto-creates `.venv`, installs dependencies, uses in-memory rate limiting, and skips reCAPTCHA):

```bash
./scripts/dev.sh
```

Then open `http://localhost:8080`.

## Production Deployment (Cloud Run)

1. **Verify GCP Readiness:**
   ```bash
   ./scripts/check_gcp.sh
   ```
2. **Deploy to Cloud Run:**
   ```bash
   ./scripts/deploy.sh
   ```
3. **Map Custom Domain (if needed):**
   ```bash
   ./scripts/map_domain.sh
   ```

## Data Privacy & Cookies

- **No Tracking Cookies Banner Required:** This application sets no advertising, analytics, or cross-site tracking cookies.
- **Anonymous Telemetry (`server/simple_tracker.py`):** BigQuery usage events record only `{ timestamp, demo_name, event_type, metadata: "{}" }`—no IP addresses, fingerprints, user identifiers, or book contents are stored.
- **Transient Rate Limiting (`server/fingerprint.py`):** Abuse prevention uses a one-way SHA-256 hash of the client IP stored transiently in Memorystore (Valkey) with a 60-second TTL (`strictly necessary` security exemption under GDPR / UK PECR / ePrivacy).
- **EPUB Processing:** `.epub` files are parsed locally in browser memory. Only the selected chapter excerpt is sent transiently to Vertex AI Gemini for vocabulary extraction and is immediately discarded.
- **Bot Protection:** Protected by Google Cloud reCAPTCHA Enterprise (`_GRECAPTCHA` security cookie); the visible reCAPTCHA badge links directly to Google's Privacy Policy and Terms of Service.

