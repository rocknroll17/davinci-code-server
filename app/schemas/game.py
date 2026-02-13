"""
Game Schemas - PvP 게임 상태 모델
"""

from typing import Optional, List
from pydantic import BaseModel, Field
from .cards import CardInfo, PendingCardInfo


# ==================== Player Info ====================

class PlayerInfo(BaseModel):
    """플레이어 정보 (AI 여부는 숨김)"""
    id: Optional[str] = None
    connected: bool = False
    index: Optional[int] = None


# ==================== Game State ====================

class GameState(BaseModel):
    """
    게임 상태 응답 - 특정 플레이어 시점
    
    my_hand: 요청자의 손패 (모든 값 공개)
    opponent_hand: 상대의 손패 (공개된 것만 값 보임)
    """
    game_id: str
    phase: str  # waiting, draw, place, guess, decision, game_over
    current_player: Optional[str] = None  # 0 or 1, 현재 차례 플레이어
    is_my_turn: bool = False  # 요청자 차례인지
    game_over: bool
    winner: Optional[int] = None  # 0 or 1
    
    # 플레이어 정보
    me: Optional[PlayerInfo] = None
    opponent: Optional[PlayerInfo] = None
    
    my_hand: List[CardInfo]  # 요청자 손패
    opponent_hand: List[CardInfo]  # 상대 손패
    
    deck_black: int
    deck_white: int
    
    pending_card: Optional[PendingCardInfo] = None  # 내 차례일 때만 보임
    
    message: str = ""
    logs: List[str] = Field(default_factory=list)





