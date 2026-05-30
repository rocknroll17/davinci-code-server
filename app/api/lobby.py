"""
Game API Routes - Lobby (게임 생성/참가)
"""

from fastapi import APIRouter, Query

from app.schemas.request import JoinGameRequest
from app.services.game_service import game_service
from app.core.exceptions import handle_game_error
from app.schemas.response import JoinGameResponse, NewGameResponse, WaitingGamesResponse

router = APIRouter(prefix="/lobby", tags=["lobby"])

# ==================== Game Management ====================

@router.post("/new", response_model=NewGameResponse)
def create_game():
    """
    새 PvP 게임 생성
    
    첫 번째 플레이어가 호출. game_id와 player_id 반환.
    상대방이 참가할 때까지 대기.
    """
    try:
        game_id, player_id = game_service.create_game()
        return NewGameResponse(game_id=game_id, player_id=player_id)
    except Exception as e:
        handle_game_error(e)


@router.post("/new/vs-ai", response_model=NewGameResponse)
def create_ai_game(use_model: bool = Query(True, description="학습된 모델 사용 여부 (False면 랜덤 AI)")):
    """
    AI 대전 게임 생성
    
    사람(선공) vs AI(후공) 게임 즉시 시작.
    AI는 상대방과 구분되지 않음 (같은 인터페이스).
    """
    try:
        game_id, player_id = game_service.create_ai_game(use_model=use_model)
        return NewGameResponse(game_id=game_id, player_id=player_id)
    except Exception as e:
        handle_game_error(e)



@router.post("/join", response_model=JoinGameResponse)
def join_game(req: JoinGameRequest):
    """
    게임 참가
    
    두 번째 플레이어가 호출. player_id 반환.
    """
    try:
        player_id = game_service.join_game(req.game_id)
        return JoinGameResponse(game_id=req.game_id, player_id=player_id)
    except Exception as e:
        handle_game_error(e)


@router.get("/waiting", response_model=WaitingGamesResponse)
def list_waiting_games():
    """대기 중인 게임 목록"""
    return WaitingGamesResponse(games=game_service.get_waiting_games())


