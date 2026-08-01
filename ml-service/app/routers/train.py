from fastapi import APIRouter, HTTPException
import numpy as np

from app.models import TrainRequest, TrainResponse
from app.ml.engine import model_registry

router = APIRouter(prefix="/train", tags=["training"])


@router.post("", response_model=TrainResponse)
async def train_model(request: TrainRequest):
    if not request.features or len(request.features) < 10:
        raise HTTPException(status_code=400, detail="Need at least 10 feature vectors for training")

    X = np.array([[f.login_hour, f.day_of_week, f.failed_attempts_in_window,
                    f.country_change, f.device_change, f.browser_change,
                    f.ip_change, f.geo_distance_km, f.account_login_frequency,
                    f.historical_success_rate] for f in request.features])

    model_registry.train(X)

    return TrainResponse(
        status="success",
        samples_trained=X.shape[0],
        feature_count=X.shape[1],
        model_id=model_registry.current_model_id,
    )
