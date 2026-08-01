import os
import uuid
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest

MODEL_PATH_ENV = "MODEL_PATH"
DEFAULT_MODEL_PATH = "models/sentrylogin.joblib"


class ModelRegistry:
    """Holds the current trained IsolationForest model, persisted to disk."""

    def __init__(self):
        self.current_model: IsolationForest | None = None
        self.current_model_id: str = ""

    def model_path(self) -> Path:
        return Path(os.environ.get(MODEL_PATH_ENV, DEFAULT_MODEL_PATH))

    def train(self, X: np.ndarray) -> None:
        model = IsolationForest(
            n_estimators=100,
            random_state=42,
            contamination="auto",
            n_jobs=-1,
        )
        model.fit(X)
        self.current_model = model
        self.current_model_id = str(uuid.uuid4())[:8]
        self.save()

    def is_trained(self) -> bool:
        return self.current_model is not None

    def save(self) -> None:
        if self.current_model is None:
            return
        path = self.model_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(
            {"model": self.current_model, "model_id": self.current_model_id},
            path,
        )

    def load(self) -> bool:
        """Load a persisted model from disk. Returns True when a model was found."""
        path = self.model_path()
        if not path.exists():
            return False
        payload = joblib.load(path)
        self.current_model = payload["model"]
        self.current_model_id = payload.get("model_id", "unknown")
        return True


model_registry = ModelRegistry()
