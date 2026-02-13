from typing import Optional, List
from pydantic import BaseModel, Field
from .cards import CardInfo, PendingCardInfo


# ==================== 게임 관리 응답 ====================

class NewGameResponse(BaseModel):
    """새 게임 생성 응답"""
    game_id: str
    player_id: str  # 첫 번째 플레이어 ID


class JoinGameResponse(BaseModel):
    """게임 참가 응답"""
    game_id: str
    player_id: str  # 두 번째 플레이어 ID


# ==================== 액션 응답 (SSE 통합용) ====================

class SimpleActionResponse(BaseModel):
    """간소화된 액션 응답 - 상태는 SSE로 전송"""
    success: bool = True


class DrawActionResponse(SimpleActionResponse):
    """뽑기 결과 - 카드 정보만 포함 (auto-place 판단용)"""
    card: Optional[PendingCardInfo] = None


class PlaceActionResponse(SimpleActionResponse):
    """배치 결과"""
    placed_position: Optional[int] = None


class WaitingGamesResponse(BaseModel):
    games: List[str]


# ==================== 에러 응답 ====================

class ErrorResponse(BaseModel):
    """에러 응답"""
    error: str
    detail: Optional[str] = None
