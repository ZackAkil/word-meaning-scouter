import logging
from fastapi import HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from server.config_utils import MAX_TEXT_LENGTH
from server.gemini_service import extract_vocabulary
from server.toolkit import create_app, mount_client, protect

logger = logging.getLogger(__name__)

app = create_app(title="Word Meaning Scouter")


class ExtractVocabularyRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_TEXT_LENGTH)
    target_count: int = Field(default=16, ge=1, le=64)
    include_crux: bool = Field(default=False)


@app.post("/api/extract-vocabulary")
@protect("extract_vocabulary")
async def api_extract_vocabulary(request: Request, body: ExtractVocabularyRequest):
    cleaned_text = body.text.strip()
    if not cleaned_text:
        raise HTTPException(status_code=400, detail="Chapter text is required")

    try:
        result = await run_in_threadpool(
            extract_vocabulary,
            text=cleaned_text,
            target_count=body.target_count,
            include_crux=body.include_crux,
        )
        words = result["words"]
        return {
            "words": words,
            "count": len(words),
            "crux_paragraph": result.get("crux_paragraph", ""),
        }
    except Exception as e:
        logger.exception("Vocabulary extraction failed")
        raise HTTPException(
            status_code=500,
            detail="Failed to extract vocabulary. Please try again.",
        ) from e


mount_client(app)
