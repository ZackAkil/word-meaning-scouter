import logging
import os
import google.auth
from dotenv import load_dotenv

load_dotenv(override=False)

logger = logging.getLogger(__name__)

DEFAULT_PROJECT_ID = "your-gcp-project-id"


def get_project_id() -> str:
    """Resolve Google Cloud Project ID from environment variables or ADC."""
    env_project_id = (
        os.getenv("PROJECT_ID")
        or os.getenv("GOOGLE_CLOUD_PROJECT")
        or os.getenv("GCP_PROJECT")
    )
    if env_project_id and env_project_id != "your-project-id":
        return env_project_id

    try:
        _, auth_project_id = google.auth.default()
        if auth_project_id:
            logger.info(f"Fetched PROJECT_ID from Google Auth: {auth_project_id}")
            return auth_project_id
    except Exception as e:
        logger.warning(f"Could not determine PROJECT_ID from Google Auth: {e}")

    return DEFAULT_PROJECT_ID


PROJECT_ID = get_project_id()
GEMINI_LOCATION = os.getenv("GCP_LOCATION", "global")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
MAX_TEXT_LENGTH = 60000
