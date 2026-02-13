from __future__ import annotations
from typing import TYPE_CHECKING

from .enums import ActionType

from .base import BaseEmitter

if TYPE_CHECKING:
    from app.schemas.results.draw import DrawResult
    from app.schemas.game import GameState

# ==================== Draw Emitter ====================

class DrawEmitter(BaseEmitter):
    """
    Draw 결과 Emitter
    
    - actor: 뽑은 카드 정보 + state
    - opponent: 없음 (뽑기는 상대에게 알릴 필요 없음)
    """
    action = ActionType.DRAW
    
    def __init__(self, result: "DrawResult", state: "GameState", message: str):
        super().__init__()
        self.result = result
        self.state = state
        self.message = message
        self._build()
    
    def _build(self):
        pending = self.result.pending_card
        
        # Actor 데이터 (state가 있을 때만)
        if self.state is not None:
            self.actor_data = {
                "action": self.action.value,
                "card": {
                    "color": pending.color.value,
                    "value": pending.value,
                    "valid_positions": pending.valid_positions
                },
                "message": self.message,
                "state": self.state.model_dump()
            }
        else:
            self.actor_data = None
        
        # Draw는 상대에게 알리지 않음
        self.opponent_data = None