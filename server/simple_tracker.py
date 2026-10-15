import datetime
import inspect
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from functools import wraps
from google.cloud import bigquery
from server.config_utils import PROJECT_ID

logger = logging.getLogger(__name__)

DATASET_ID = os.environ.get("BQ_DATASET", "simple_demo_tracking")
TABLE_ID = os.environ.get("BQ_TABLE", "demo_usage")
DEMO_NAME = os.environ.get("DEMO_NAME", "word-meaning-scouter")
DEV_MODE = os.environ.get("DEV_MODE", "false").lower() == "true"


class SimpleTracker:
    """
    Fire-and-forget BigQuery event logger running in a bounded background thread pool
    so telemetry never adds latency, fails user requests, or exhausts container threads.
    """

    def __init__(self, demo_name: str = DEMO_NAME, max_workers: int = 4):
        self.demo_name = demo_name
        self.client = None
        self.table_ref = f"{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}"
        self.executor = ThreadPoolExecutor(max_workers=max_workers)

    def _get_client(self):
        if self.client is None:
            try:
                self.client = bigquery.Client(project=PROJECT_ID)
            except Exception as e:
                logger.warning(f"Could not initialize BigQuery client: {e}")
        return self.client

    def _log_event(self, event_type: str, metadata: dict | None = None):
        if DEV_MODE:
            return

        client = self._get_client()
        if not client:
            return

        rows = [
            {
                "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "demo_name": self.demo_name,
                "event_type": event_type,
                "metadata": json.dumps(metadata) if metadata else "{}",
            }
        ]

        try:
            errors = client.insert_rows_json(self.table_ref, rows)
            if errors:
                logger.warning(f"BigQuery Insert Errors: {errors}")
        except Exception as e:
            logger.warning(f"BigQuery Error: {e}")

    def __call__(self, event_type: str, metadata: dict | None = None):
        def decorator(func):
            if inspect.iscoroutinefunction(func):
                @wraps(func)
                async def wrapper(*args, **kwargs):
                    self.executor.submit(self._log_event, event_type, metadata)
                    return await func(*args, **kwargs)

                return wrapper

            @wraps(func)
            def wrapper(*args, **kwargs):
                self.executor.submit(self._log_event, event_type, metadata)
                return func(*args, **kwargs)

            return wrapper

        return decorator


simpletrack = SimpleTracker()
