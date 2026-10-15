import inspect
import json
import logging
import os
from functools import wraps
from pathlib import Path

import redis
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from server.config_utils import PROJECT_ID
from server.fingerprint import generate_fingerprint
from server.recaptcha_validator import RecaptchaValidator
from server.simple_tracker import DEMO_NAME, simpletrack

load_dotenv(override=False)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

RECAPTCHA_SITE_KEY = os.getenv("RECAPTCHA_SITE_KEY")
RECAPTCHA_SCORE_THRESHOLD = float(os.getenv("RECAPTCHA_SCORE_THRESHOLD", "0.5"))
REDIS_URL = os.getenv("REDIS_URL")
GLOBAL_RATE_LIMIT = os.getenv("GLOBAL_RATE_LIMIT", "1000 per 5 minutes")
PER_USER_RATE_LIMIT = os.getenv("PER_USER_RATE_LIMIT", "10 per minute")
DEV_MODE = os.getenv("DEV_MODE", "false").lower() == "true"
ALLOW_SIMPLE_MODE = os.getenv("ALLOW_SIMPLE_MODE", "false").lower() == "true"
MAX_BODY_BYTES = int(os.getenv("MAX_BODY_BYTES", "131072"))

DEFAULT_CLIENT_DIR = Path(__file__).resolve().parent.parent / "client"

recaptcha_validator = RecaptchaValidator(
    project_id=PROJECT_ID,
    recaptcha_key=RECAPTCHA_SITE_KEY or "",
    score_threshold=RECAPTCHA_SCORE_THRESHOLD,
)


def get_fingerprint_key(request: Request) -> str:
    return f"{DEMO_NAME}:{generate_fingerprint(request)}"


def get_global_key(request: Request) -> str:
    return f"{DEMO_NAME}:global"


if DEV_MODE:
    logger.info("DEV_MODE enabled: Rate limiting using local memory storage")
    limiter = Limiter(key_func=get_fingerprint_key)
elif not REDIS_URL:
    logger.warning("REDIS_URL not set: Using memory storage (single-instance only)")
    limiter = Limiter(key_func=get_fingerprint_key)
else:
    limiter = Limiter(key_func=get_fingerprint_key, storage_uri=REDIS_URL)


def verify_recaptcha(recaptcha_token: str | None, action: str = "SUBMIT") -> None:
    """Validates a reCAPTCHA token. Fails closed in production unless DEV_MODE or ALLOW_SIMPLE_MODE is set."""
    if DEV_MODE:
        logger.info("DEV_MODE enabled: Skipping ReCAPTCHA validation")
        return

    if not RECAPTCHA_SITE_KEY:
        if ALLOW_SIMPLE_MODE:
            logger.warning("ALLOW_SIMPLE_MODE enabled: Skipping ReCAPTCHA validation")
            return
        logger.error("RECAPTCHA_SITE_KEY is not configured in production mode")
        raise HTTPException(status_code=503, detail="Security verification is not configured")

    if not recaptcha_token:
        raise HTTPException(status_code=400, detail="Missing ReCAPTCHA token")

    validation_result = recaptcha_validator.validate_token(
        token=recaptcha_token, recaptcha_action=action
    )

    if not validation_result["valid"]:
        raise HTTPException(status_code=403, detail="ReCAPTCHA validation failed")

    if not validation_result["passes_threshold"]:
        raise HTTPException(status_code=403, detail="ReCAPTCHA score too low")


async def _verify_redis_connection() -> None:
    """Verify Valkey / Redis connectivity on startup when running in production."""
    if REDIS_URL and not DEV_MODE:
        try:
            host_display = REDIS_URL.split("@")[-1] if "@" in REDIS_URL else REDIS_URL
            logger.info(f"Testing Valkey/Redis connection to: {host_display}")
            r = redis.from_url(REDIS_URL)
            r.ping()
            logger.info("Valkey/Redis connection successful")
        except Exception as e:
            logger.error(f"Valkey/Redis connection failed: {e}")
            logger.error("Ensure Cloud Run is configured with Direct VPC Egress (--network/--subnet).")


async def _get_status() -> dict:
    """Returns current security posture (simple vs production)."""
    missing = []
    if not RECAPTCHA_SITE_KEY:
        missing.append("recaptcha")
    if not REDIS_URL:
        missing.append("redis")

    return {
        "mode": "simple" if missing else "production",
        "missing": missing if DEV_MODE else [],
        "recaptcha_site_key": RECAPTCHA_SITE_KEY or "",
    }


async def _security_headers_middleware(request: Request, call_next) -> Response:
    if request.method in ("POST", "PUT", "PATCH"):
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > MAX_BODY_BYTES:
                    return JSONResponse(
                        status_code=413,
                        content={"detail": "Request payload too large"},
                    )
            except ValueError:
                return JSONResponse(
                    status_code=400,
                    content={"detail": "Invalid Content-Length header"},
                )

        chunks = bytearray()
        async for chunk in request.stream():
            chunks.extend(chunk)
            if len(chunks) > MAX_BODY_BYTES:
                return JSONResponse(
                    status_code=413,
                    content={"detail": "Request payload too large"},
                )
        request._body = bytes(chunks)

    response: Response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://www.google.com https://www.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline' blob: https://cdn.jsdelivr.net; "
        "img-src 'self' data: blob:; "
        "font-src 'self' data: blob:; "
        "frame-src 'self' blob: https://www.google.com; "
        "connect-src 'self' blob: https://www.google.com; "
        "frame-ancestors 'self';",
    )
    if DEV_MODE:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response


class SafeStaticFiles(StaticFiles):
    """StaticFiles subclass that blocks dotfiles (.env, .DS_Store, .git) and source maps."""

    def lookup_path(self, path: str) -> tuple[str, os.stat_result | None]:
        parts = Path(path).parts
        if any(part.startswith(".") for part in parts) or path.endswith(".map"):
            return "", None
        return super().lookup_path(path)


def mount_client(app: FastAPI, directory: str | Path = DEFAULT_CLIENT_DIR) -> None:
    """Safely mounts the static client directory with dotfile and symlink protection."""
    resolved_dir = Path(directory).resolve()
    app.mount(
        "/",
        SafeStaticFiles(directory=str(resolved_dir), html=True, follow_symlink=False),
        name="client",
    )


def init_toolkit(app: FastAPI) -> FastAPI:
    """Attaches rate limiting, security headers, Redis check, and /api/status route to a FastAPI app."""
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.middleware("http")(_security_headers_middleware)
    app.add_event_handler("startup", _verify_redis_connection)
    app.add_api_route("/api/status", _get_status, methods=["GET"])
    return app


def create_app(**kwargs) -> FastAPI:
    """Creates a FastAPI instance pre-configured with Scalable Demo Toolkit middleware and routes."""
    if not DEV_MODE:
        kwargs.setdefault("docs_url", None)
        kwargs.setdefault("redoc_url", None)
        kwargs.setdefault("openapi_url", None)
    app = FastAPI(**kwargs)
    return init_toolkit(app)


def protect(event_name: str | None = None, action: str = "SUBMIT"):
    """
    Decorator for FastAPI endpoints that enforces:
    1. Global and per-user rate limits via SlowAPI
    2. Request payload size and JSON object structure validation
    3. Non-blocking reCAPTCHA Enterprise token verification (via threadpool)
    4. Bounded background BigQuery telemetry (when event_name is provided)
    """
    def decorator(func):
        inner = simpletrack(event_name)(func) if event_name else func

        @wraps(func)
        async def wrapper(*args, **kwargs):
            request = kwargs.get("request")
            if request is None:
                for arg in args:
                    if isinstance(arg, Request):
                        request = arg
                        break

            if request is not None:
                raw_body = await request.body()
                if len(raw_body) > MAX_BODY_BYTES:
                    raise HTTPException(status_code=413, detail="Request payload too large")

                data = {}
                if raw_body:
                    try:
                        data = json.loads(raw_body)
                    except ValueError:
                        raise HTTPException(status_code=400, detail="Invalid JSON payload")
                    if not isinstance(data, dict):
                        raise HTTPException(status_code=400, detail="JSON payload must be an object")

                token = data.get("recaptcha_token") or request.headers.get("X-Recaptcha-Token")
                await run_in_threadpool(verify_recaptcha, token, action)

            if inspect.iscoroutinefunction(inner):
                return await inner(*args, **kwargs)
            return inner(*args, **kwargs)

        user_limited = limiter.limit(PER_USER_RATE_LIMIT, key_func=get_fingerprint_key)(wrapper)
        global_limited = limiter.limit(GLOBAL_RATE_LIMIT, key_func=get_global_key)(user_limited)
        return global_limited

    return decorator
