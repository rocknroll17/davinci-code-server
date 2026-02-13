from __future__ import annotations
from typing import TYPE_CHECKING

from .enums import EventType
from .base import BaseEmitter

if TYPE_CHECKING:
    from app.services.game_session import GameSession
    from app.schemas.game import GameState
    
# ==================== Game Start Emitter ====================

class GameStartEmitter:
    """
    게임 시작 Emitter
    
    - 모든 플레이어에게 동일한 메시지
    """
    
    def __init__(self, message: str = "게임이 시작되었습니다!"):
        self.message = message
        self._build()
    
    def _build(self):
        self.data = {
            "message": self.message,
            "current_player": 0
        }
    
    def emit(self, session: "GameSession"):
        """모든 플레이어에게 발송"""
        session.emit_to_all(EventType.GAME_START.value, self.data)