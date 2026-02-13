"""
SSE Emitter 클래스들

Result 객체를 받아서 자동으로 actor/opponent용 emit 데이터를 빌드하고,
emit() 호출 시 양쪽에 적절한 데이터를 전송.

사용 예시:
    result = engine.draw(player_id, color)
    state = session._build_state(player_id)
    DrawEmitter(result, state, message).emit(session, player_id)
"""

from __future__ import annotations
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Optional, Dict, Any

from .enums import ActionType, EventType

if TYPE_CHECKING:
    from app.services.game_session import GameSession




# ==================== Base Emitter ====================

class BaseEmitter(ABC):
    """
    Emitter 기본 클래스
    
    Result를 받아 actor/opponent용 데이터를 자동 빌드하고,
    emit() 호출로 양쪽에 전송.
    """
    action: ActionType
    
    def __init__(self):
        self.actor_data: Dict[str, Any] = {}
        self.opponent_data: Optional[Dict[str, Any]] = None
    
    @abstractmethod
    def _build(self):
        """actor_data와 opponent_data 빌드 (서브클래스 구현)"""
        pass
    
    def emit(self, session: "GameSession", actor_id: str):
        """
        SSE 이벤트 발송
        
        Args:
            session: GameSession 인스턴스
            actor_id: 행동한 플레이어 ID
        """
        # 본인에게 my_action
        if self.actor_data:
            session.emit_to_player(actor_id, EventType.MY_ACTION.value, self.actor_data)
        
        # 상대에게 opponent_action (데이터가 있을 때만)
        if self.opponent_data:
            session.emit_to_opponent(actor_id, EventType.OPPONENT_ACTION.value, self.opponent_data)
    
    def emit_to_opponent_only(self, session: "GameSession", actor_id: str):
        """
        상대방에게만 이벤트 발송 (AI 턴에서 사용)
        
        Args:
            session: GameSession 인스턴스
            actor_id: 행동한 플레이어 ID (AI)
        """
        if self.opponent_data:
            session.emit_to_opponent(actor_id, EventType.OPPONENT_ACTION.value, self.opponent_data)

