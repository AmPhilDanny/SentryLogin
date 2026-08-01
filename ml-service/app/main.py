from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from app.ml.engine import model_registry
from app.routers import score, train

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    if model_registry.load():
        print(f"[ml-service] loaded persisted model {model_registry.current_model_id}")
    else:
        print("[ml-service] no persisted model found; POST /train first")
    yield


app = FastAPI(
    title="SentryLogin ML Service",
    description="Anomaly detection and risk scoring for login analysis",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(score.router)
app.include_router(train.router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "ml-service",
        "trained": model_registry.is_trained(),
        "model_id": model_registry.current_model_id,
    }
