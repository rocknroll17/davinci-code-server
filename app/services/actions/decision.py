"""
Decision Action Handler

계속 추측 여부 결정 액션 처리.
Human과 AI 모두 동일한 로직 사용.
턴 변경 후처리 포함.
"""

from __future__ import annotations
import asyncio
from typing import TYPE_CHECKING, Any, Dict

from app.schemas.results.decision import DecisionResult

from .base import ActionHandler
from app.schemas.emitters.decision import DecisionEmitter
from app.schemas.emitters.turn_change import TurnChangeEmitter

if TYPE_CHECKING:
    from app.services.game_session import GameSession


class DecisionHandler(ActionHandler):
    """
    Decision 액션 핸들러
    
    Args:
        session: 게임 세션
        player_id: 플레이어 ID
        continue_guessing: 계속 추측할지 여부
    """
    
    def __init__(
        self, 
        session: "GameSession", 
        player_id: str, 
        continue_guessing: bool
    ):
        super().__init__(session, player_id)
        self.result: DecisionResult | None = None
        self.continue_guessing = continue_guessing
    
    def execute_action(self) -> bool:
        """결정 실행"""
        self.engine.decision(self.player_id, self.continue_guessing)
        
        player_idx = self.player.player_index + 1
        
        # 메시지 설정
        if self.continue_guessing:
            self._message = "🎯 계속 추측하세요!"
            if self.is_ai:
                self._message = "⏳ 상대방이 계속 추측합니다."
        else:
            self._message = "턴을 종료했습니다."
            if self.is_ai:
                self._message = "상대방이 턴을 종료했습니다."
        
        self.session.message = self._message
        return self.continue_guessing
    
    def emit(self) -> None:
        """SSE 발송"""
        state = self._build_state()
        emitter = DecisionEmitter(self.continue_guessing, state, self._message)
        
        if self.is_ai:
            emitter.emit_to_opponent_only(self.session, self.player_id)
        else:
            emitter.emit(self.session, self.player_id)
    
    def log(self) -> None:
        """로그 기록"""
        player_idx = self.player.player_index + 1
        
        if self.continue_guessing:
            self.session.log(f"플레이어 {player_idx}이(가) 계속 추측합니다.")
        else:
            self.session.log(f"플레이어 {player_idx}이(가) 턴을 종료했습니다.")
    
    async def post_process(self) -> None:
        """턴 종료 시 턴 변경 처리"""
        if not self.continue_guessing:
            deck_empty = self.engine.deck.is_empty()
            
            async def send_turn_change():
                await asyncio.sleep(2.0)
                TurnChangeEmitter(deck_empty).emit(self.session, self.player_id)
            
            asyncio.create_task(send_turn_change())
