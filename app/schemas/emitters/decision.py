from __future__ import annotations
from typing import TYPE_CHECKING

from .enums import ActionType

from .base import BaseEmitter

if TYPE_CHECKING:
    from app.schemas.game import GameState

# ==================== Decision Emitter ====================

class DecisionEmitter(BaseEmitter):
    """
    Decision 결과 Emitter
    
    - actor: 결정 결과 + state
    - opponent: 결정 결과
    """
    action = ActionType.DECISION
    
    def __init__(self, continue_guessing: bool, state: "GameState", message: str):
        super().__init__()
        self.continue_guessing = continue_guessing
        self.state = state
        self.message = message
        self._build()
    
    def _build(self):
        # Actor 데이터 (state가 있을 때만)
        if self.state is not None:
            self.actor_data = {
                "action": self.action.value,
                "continue": self.continue_guessing,
                "message": self.message,
                "state": self.state.model_dump()
            }
        else:
            self.actor_data = None
        
        # Opponent 데이터
        opponent_msg = "⏳ 상대방이 계속 추측합니다." if self.continue_guessing else "상대방이 턴을 종료했습니다."
        self.opponent_data = {
            "action": self.action.value,
            "continue": self.continue_guessing,
            "message": opponent_msg
        }