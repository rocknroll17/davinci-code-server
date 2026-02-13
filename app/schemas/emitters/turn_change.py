from __future__ import annotations
from typing import TYPE_CHECKING
from .enums import EventType
from .base import BaseEmitter

if TYPE_CHECKING:
    from app.services.game_session import GameSession
    from app.schemas.game import GameState

# ==================== Turn Change Emitter ====================
class TurnChangeEmitter(BaseEmitter):
    """
    턴 변경 Emitter
    
    - 상대에게만 발송 (새 턴이 된 플레이어)
    """
    
    def __init__(self, deck_empty: bool):
        super().__init__()
        self.deck_empty = deck_empty
        self._build()
    
    def _build(self):
        if self.deck_empty:
            message = "🎯 당신의 차례입니다! 상대방 카드를 추측하세요."
        else:
            message = "🎯 당신의 차례입니다! 카드를 뽑으세요."
        
        # Actor에게는 보내지 않음
        self.actor_data = None
        
        # 새 턴 플레이어에게 전송
        self.opponent_data = {
            "your_turn": True,
            "message": message
        }
        
        self.message = message
    
    def emit(self, session: "GameSession", actor_id: str):
        """턴 변경은 상대(새 턴 플레이어)에게만 발송"""
        if self.opponent_data:
            session.emit_to_opponent(actor_id, EventType.TURN_CHANGE.value, self.opponent_data)