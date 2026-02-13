from typing import Optional
from pydantic import BaseModel, Field

# ==================== Requests ====================

class NewGameRequest(BaseModel):
    """새 게임 생성 요청"""
    pass  # 파라미터 없음


class JoinGameRequest(BaseModel):
    """게임 참가 요청"""
    game_id: str


class PlayerRequest(BaseModel):
    """
    플레이어 요청의 베이스
    game_id + player_id 필수
    """
    game_id: str
    player_id: str


class GetStateRequest(PlayerRequest):
    """게임 상태 조회"""
    pass


class DrawRequest(PlayerRequest):
    """카드 뽑기"""
    color: int = Field(..., ge=0, le=1, description="0=black, 1=white")


class PlaceRequest(PlayerRequest):
    """카드 배치"""
    color: int = Field(..., ge=0, le=1, description="0=black, 1=white")
    number: int = Field(..., ge=0, le=12, description="Card number (0-11, 12=joker)")
    position: int = Field(..., ge=0, description="Position to place card")


class GuessRequest(PlayerRequest):
    """카드 추측"""
    position: int = Field(..., ge=0, description="Target card position")
    value: int = Field(..., ge=0, le=12, description="Guessed value 0-11, 12=joker")


class DecisionRequest(PlayerRequest):
    """계속 추측 여부"""
    continue_guessing: bool