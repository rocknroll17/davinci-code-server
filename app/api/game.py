"""
Game API Routes - PvP 구조 + SSE + AI 지원
"""

import asyncio
from fastapi import APIRouter, Query, BackgroundTasks

from app.schemas.request import (
    JoinGameRequest, GetStateRequest,
    DrawRequest, PlaceRequest, GuessRequest, DecisionRequest
)
from app.schemas.response import (
    SimpleActionResponse, DrawActionResponse, PlaceActionResponse
)
from app.schemas.game import GameState
from app.services.game_service import game_service
from app.core.exceptions import handle_game_error

router = APIRouter(prefix="/game", tags=["game"])

# ==================== 플레이어 액션 ====================

@router.post("/draw", response_model=DrawActionResponse)
async def draw_card(req: DrawRequest, background_tasks: BackgroundTasks):
    """카드 뽑기 - SSE로 상태 전송, API는 기본 정보만 반환"""
    try:
        result = await game_service.draw(req.game_id, req.player_id, req.color)
        # result: {"success": True, "card": {...}}
        from app.schemas.cards import PendingCardInfo
        card = PendingCardInfo(**result["card"]) if result.get("card") else None
        return DrawActionResponse(success=True, card=card)
    except Exception as e:
        handle_game_error(e)

@router.post("/place", response_model=PlaceActionResponse)
async def place_card(req: PlaceRequest, background_tasks: BackgroundTasks):
    """카드 배치 - SSE로 상태 전송, API는 기본 정보만 반환"""
    try:
        result = await game_service.place(req.game_id, req.player_id, req.color, req.number, req.position)
        # result: {"success": True, "placed_position": int}
        return PlaceActionResponse(success=True, placed_position=result.get("placed_position"))
    except Exception as e:
        handle_game_error(e)


@router.post("/guess", response_model=SimpleActionResponse)
async def guess_card(req: GuessRequest, background_tasks: BackgroundTasks):
    """상대 카드 추측 - SSE로 상태 전송, API는 성공 여부만 반환"""
    try:
        result = await game_service.guess(req.game_id, req.player_id, req.position, req.value)
        # AI 턴 실행 (백그라운드) - 틀린 경우에만
        # Note: 정답 여부는 SSE에서 처리되므로 여기서는 항상 AI 체크
        background_tasks.add_task(_maybe_run_ai, req.game_id, sleep_time=2.0)
        
        return SimpleActionResponse(success=True)
    except Exception as e:
        handle_game_error(e)


@router.post("/decision", response_model=SimpleActionResponse)
async def make_decision(req: DecisionRequest, background_tasks: BackgroundTasks):
    """계속 추측 여부 결정 - SSE로 상태 전송, API는 성공 여부만 반환"""
    try:
        result = await game_service.decision(req.game_id, req.player_id, req.continue_guessing)
        # result: {"success": True}
        if not req.continue_guessing:
            background_tasks.add_task(_maybe_run_ai, req.game_id)
        return SimpleActionResponse(success=True)
    except Exception as e:
        handle_game_error(e)


async def _maybe_run_ai(game_id: str, sleep_time: float = 0.0):
    """백그라운드에서 AI 턴 실행"""
    try:
        await asyncio.sleep(sleep_time)
        await game_service.maybe_execute_ai_turn(game_id)
    except Exception as e:
        # 에러 로깅
        import logging
        logging.getLogger(__name__).error(f"AI turn error: {e}")


@router.post("/state", response_model=GameState)
def get_state(req: GetStateRequest):
    """
    게임 상태 조회
    
    플레이어 시점으로 상태 반환.
    """
    try:
        return game_service.get_state(req.game_id, req.player_id)
    except Exception as e:
        handle_game_error(e)