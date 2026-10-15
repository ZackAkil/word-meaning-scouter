import logging
from typing import Any, Dict, Optional
from google.cloud import recaptchaenterprise_v1
from google.cloud.recaptchaenterprise_v1 import Assessment

logger = logging.getLogger(__name__)


class RecaptchaValidator:
    def __init__(self, project_id: str, recaptcha_key: str, score_threshold: float = 0.5):
        self.project_id = project_id
        self.recaptcha_key = recaptcha_key
        self.score_threshold = score_threshold
        self._client: Optional[recaptchaenterprise_v1.RecaptchaEnterpriseServiceClient] = None

    @property
    def client(self) -> recaptchaenterprise_v1.RecaptchaEnterpriseServiceClient:
        if self._client is None:
            self._client = recaptchaenterprise_v1.RecaptchaEnterpriseServiceClient()
        return self._client

    def validate_token(self, token: str, recaptcha_action: str = "SUBMIT") -> Dict[str, Any]:
        """Validate a reCAPTCHA Enterprise token and verify its risk score against the threshold."""
        try:
            assessment = self._create_assessment(token, recaptcha_action)
            if not assessment:
                return {
                    "valid": False,
                    "score": 0.0,
                    "error": "Failed to create assessment",
                }

            if not assessment.token_properties.valid:
                logger.warning(
                    f"reCAPTCHA token invalid: {assessment.token_properties.invalid_reason}"
                )
                return {
                    "valid": False,
                    "score": 0.0,
                    "error": f"Invalid token: {assessment.token_properties.invalid_reason}",
                    "reasons": [],
                }

            if assessment.token_properties.action != recaptcha_action:
                logger.warning(
                    f"reCAPTCHA action mismatch: expected {recaptcha_action}, "
                    f"got {assessment.token_properties.action}"
                )
                return {
                    "valid": False,
                    "score": 0.0,
                    "error": "Action mismatch",
                    "reasons": [],
                }

            score = assessment.risk_analysis.score
            reasons = list(assessment.risk_analysis.reasons)
            logger.info(f"reCAPTCHA score: {score}, reasons: {reasons}")

            return {
                "valid": True,
                "score": score,
                "reasons": reasons,
                "passes_threshold": score >= self.score_threshold,
                "threshold": self.score_threshold,
            }

        except Exception as e:
            logger.error(f"Error validating reCAPTCHA token: {e}")
            return {
                "valid": False,
                "score": 0.0,
                "error": str(e),
            }

    def _create_assessment(
        self, token: str, recaptcha_action: str
    ) -> Optional[Assessment]:
        try:
            event = recaptchaenterprise_v1.Event(
                site_key=self.recaptcha_key,
                token=token,
            )
            assessment = recaptchaenterprise_v1.Assessment(event=event)
            request = recaptchaenterprise_v1.CreateAssessmentRequest(
                parent=f"projects/{self.project_id}",
                assessment=assessment,
            )

            response = self.client.create_assessment(request)
            assessment_name = self.client.parse_assessment_path(response.name).get("assessment")
            logger.info(f"Created reCAPTCHA assessment: {assessment_name}")
            return response

        except Exception as e:
            logger.error(f"Failed to create reCAPTCHA assessment: {e}")
            return None
