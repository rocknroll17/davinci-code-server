from __future__ import annotations
from typing import TYPE_CHECKING
from .enums import EventType
from .base import BaseEmitter

if TYPE_CHECKING:
    from app.services.game_session import GameSession
    from app.schemas.game import GameState

#  ==================== Game Over Emitter ====================

class GameOverEmitter:
    """
    게임 종료 Emitter
    
    - 승자/패자에게 각각 다른 메시지 발송
    """
    
    def __init__(self, winner_index: int):
        self.winner_index = winner_index
        self._build()
    
    def _build(self):
        self.winner_data = {
            "winner": self.winner_index,
            "message": "🎉 축하합니다! 당신이 승리했습니다!"
        }
        self.loser_data = {
            "winner": self.winner_index,
            "message": "😢 아쉽습니다. 다음에 다시 도전하세요!"
        }
    
    def emit(self, session: "GameSession", winner_id: str):
        """승자/패자에게 각각 발송"""
        session.emit_to_player(winner_id, EventType.GAME_OVER.value, self.winner_data)
        session.emit_to_opponent(winner_id, EventType.GAME_OVER.value, self.loser_data)
    
    def emit_loser_only(self, session: "GameSession", winner_id: str):
        """패자에게만 발송 (AI 승리 시 사용)"""
        session.emit_to_opponent(winner_id, EventType.GAME_OVER.value, self.loser_data)
    
    def emit_winner_only(self, session: "GameSession", loser_id: str):
        """승자에게만 발송 (AI 패배 시 사용)"""
        session.emit_to_opponent(loser_id, EventType.GAME_OVER.value, self.winner_data)