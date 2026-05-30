"""
Da Vinci Code Game Server
"""

import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.core.model_loader import model_loader
from app.api import game, lobby, sse
from app.services.game_manager import game_manager

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 경로 설정
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "static")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 라이프사이클"""
    model_loader.load()
    # 게임 세션 정리 태스크 시작
    await game_manager.start_cleanup_task()
    logger.info("Da Vinci Code server started")
    yield
    logger.info("Da Vinci Code server shutting down")


app = FastAPI(
    title=settings.APP_NAME,
    description="Da Vinci Code - Human vs AI",
    version="2.0.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

app.add_middleware(NoCacheMiddleware)

# API 라우터
app.include_router(game.router, prefix="/api")
app.include_router(lobby.router, prefix="/api")
app.include_router(sse.router, prefix="/api")


# 정적 파일
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
async def root():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/ai", include_in_schema=False)
async def ai_game():
    return FileResponse(os.path.join(STATIC_DIR, "ai_game.html"))