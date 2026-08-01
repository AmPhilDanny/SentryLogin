from fastapi import APIRouter, HTTPException
import numpy as np

from app.models import ScoreRequest, ScoreResponse
from app.ml.engine import model_registry

router = APIRouter(prefix="/score", tags=["scoring"])


@router.post("", response_model=ScoreResponse)
async def score_logins(request: ScoreRequest):
    if not request.features:
        raise HTTPException(status_code=400, detail="No features provided")

    if model_registry.current_model is None:
        raise HTTPException(status_code=400, detail="No model trained yet. POST /train first.")

    X = np.array([[f.login_hour, f.day_of_week, f.failed_attempts_in_window,
                    f.country_change, f.device_change, f.browser_change,
                    f.ip_change, f.geo_distance_km, f.account_login_frequency,
                    f.historical_success_rate] for f in request.features])

    predictions = model_registry.current_model.predict(X).tolist()
    scores = model_registry.current_model.score_samples(X).tolist() if hasattr(model_registry.current_model, 'score_samples') else [0.0] * len(predictions)

    return ScoreResponse(scores=scores, predictions=predictions)
