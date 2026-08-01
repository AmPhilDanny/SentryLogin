from pydantic import BaseModel


class FeatureVector(BaseModel):
    """Single login's computed features for anomaly detection."""

    login_hour: float = 0.0
    day_of_week: float = 0.0
    failed_attempts_in_window: float = 0.0
    country_change: float = 0.0
    device_change: float = 0.0
    browser_change: float = 0.0
    ip_change: float = 0.0
    geo_distance_km: float = 0.0
    account_login_frequency: float = 0.0
    historical_success_rate: float = 1.0


class ScoreRequest(BaseModel):
    features: list[FeatureVector]


class ScoreResponse(BaseModel):
    scores: list[float]
    predictions: list[int]


class TrainRequest(BaseModel):
    features: list[FeatureVector]


class TrainResponse(BaseModel):
    status: str
    samples_trained: int
    feature_count: int
    model_id: str
