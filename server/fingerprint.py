import hashlib
import os
from fastapi import Request

TRUSTED_PROXY_HOPS = max(1, int(os.getenv("TRUSTED_PROXY_HOPS", "1")))


def generate_fingerprint(request: Request) -> str:
    """
    Generates a deterministic, cookieless SHA-256 fingerprint from the verified client IP.
    Reads from the rightmost trusted proxy hop in X-Forwarded-For on Cloud Run to prevent
    header spoofing, and excludes client-mutable headers to prevent rate-limit bypass.
    """
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        hops = [ip.strip() for ip in forwarded_for.split(",") if ip.strip()]
        idx = max(0, len(hops) - TRUSTED_PROXY_HOPS)
        client_host = hops[idx] if hops else "unknown"
    else:
        client_host = request.client.host if request.client else "unknown"

    return hashlib.sha256(client_host.encode("utf-8")).hexdigest()
