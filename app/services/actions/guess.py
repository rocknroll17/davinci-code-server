"""
Guess Action Handler

상대 카드 추측 액션 처리.
Human과 AI 모두 동일한 로직 사용.
게임 오버 및 턴 변경 후처리 포함.
"""

from __future__ import annotations
import asyncio
from typing import TYPE_CHECKING, Any, Dict, Optional

from .base import ActionHandler, ActionResult
from app.schemas.emitters.guess import GuessEmitter, RevealedCard
from app.schemas.emitters.turn_change import TurnChangeEmitter
from app.schemas.emitters.game_over import GameOverEmitter

if TYPE_CHECKING:
    from app.services.game_session import GameSession
    from app.schemas.results.guess import GuessResult


class GuessHandler(ActionHandler):
    """
    Guess 액션 핸들러
    
    Args:
        session: 게임 세션
        player_id: 플레이어 ID
        position: 추측할 카드 위치
        value: 추측한 값
    """
    
    def __init__(
        self, 
        session: "GameSession", 
        player_id: str, 
        position: int, 
        value: int
    ):
        super().__init__(session, player_id)
        self._result: GuessResult | None = None
        self.position = position
        self.value = value
        self._revealed_card: Optional[RevealedCard] = None

    async def execute(self) -> "ActionResult":
        """AI 추측 전 추론 시각화 SSE 발송 후 실행"""
        if self.is_ai:
            reasoning = getattr(self.player, '_last_reasoning', None)
            if reasoning is not None:
                opponent = self.player.opponent
                if opponent and not opponent.is_ai:
                    # 클라이언트 확인 이벤트 초기화 후 추론 데이터 발송
                    ack_event = getattr(self.player, '_reasoning_ack', None)
                    if ack_event is not None:
                        ack_event.clear()
                    opponent.emit('ai_reasoning', reasoning)
                    self.player._last_reasoning = None
                    # 클라이언트가 확인 버튼을 누를 때까지 대기 (최대 60s 타임아웃)
                    if ack_event is not None:
                        try:
                            await asyncio.wait_for(ack_event.wait(), timeout=60.0)
                        except asyncio.TimeoutError:
                            pass  # 타임아웃이면 그냥 진행
                else:
                    self.player._last_reasoning = None
        return await super().execute()
    
    def execute_action(self) -> "GuessResult":
        """추측 실행"""
        result = self.engine.guess(self.player_id, self.position, self.value)
        
        value_str = "조커" if self.value == 12 else str(self.value)
        
        # 메시지 설정
        if result.is_correct:
            if self.engine.game_over:
                self._message = "🎉 정답! 게임 종료! 당신이 승리했습니다!"
                if self.is_ai:
                    self._message = f"🚨 상대방이 위치 {self.position}을(를) {value_str}로 맞췄습니다!"
            else:
                self._message = "✅ 정답! 계속 추측하시겠습니까?"
                if self.is_ai:
                    self._message = f"🚨 상대방이 위치 {self.position}을(를) {value_str}로 맞췄습니다!"
        else:
            if self.engine.game_over:
                # 틀려서 카드가 공개되어 모든 카드가 공개됨 → 게임 종료
                self._message = "❌ 틀렸습니다! 카드가 모두 공개되어 게임이 종료됩니다."
                if self.is_ai:
                    self._message = "🎉 상대방의 카드가 모두 공개되었습니다! 당신이 승리했습니다!"
            else:
                self._message = "❌ 틀렸습니다! 상대방 차례입니다."
                if self.is_ai:
                    self._message = f"상대방이 위치 {self.position}을(를) {value_str}로 추측했지만 틀렸습니다!"
        
        self.session.message = self._message
        
        # 틀렸을 때 공개된 카드 정보
        if not result.is_correct and result.card is not None:
            drawn_card = result.card
            revealed_position = self.player.hand.get_position(drawn_card)
            self._revealed_card = RevealedCard(
                position=revealed_position,
                color=drawn_card.color.value,
                value=drawn_card.value,
                revealed=drawn_card.is_revealed
            )
        
        return result
    
    def emit(self) -> None:
        """SSE 발송"""
        state = self._build_state()
        emitter = GuessEmitter(self._result, state, self._message, self._revealed_card)
        
        if self.is_ai:
            emitter.emit_to_opponent_only(self.session, self.player_id)
        else:
            emitter.emit(self.session, self.player_id)
    
    def log(self) -> None:
        """로그 기록"""
        result = self._result
        value_str = "조커" if self.value == 12 else str(self.value)
        player_idx = self.player.player_index + 1
        
        if result.is_correct:
            self.session.log(f"플레이어 {player_idx}이(가) 위치 {self.position}을(를) {value_str}로 맞췄습니다!")
            if self.engine.game_over:
                self.session.log(f"🎉 플레이어 {player_idx}의 승리!")
        else:
            self.session.log(f"플레이어 {player_idx}이(가) 위치 {self.position}을(를) {value_str}로 추측했지만 틀렸습니다.")
            if self.engine.game_over:
                winner_idx = self.engine.winner.player_index + 1
                self.session.log(f"🎉 플레이어 {winner_idx}의 승리!")
    
    async def post_process(self) -> None:
        """게임 오버 또는 턴 변경 처리"""
        result = self._result
        
        if self.engine.game_over:
            # 승자 로그 기록 (AI 대전만)
            self.session.winner_log()
            
            # 게임 오버 (정답으로 상대 전멸, 또는 틀려서 내 카드 전부 공개)
            winner_index = self.engine.winner.player_index
            winner_id = self.engine.winner.id
            
            async def send_game_over():
                await asyncio.sleep(2.0)
                if self.is_ai:
                    if winner_id == self.player_id:
                        # AI가 이김 → 패배 메시지를 인간에게
                        GameOverEmitter(winner_index).emit_loser_only(self.session, self.player_id)
                    else:
                        # AI가 짐 → 승리 메시지를 인간에게
                        GameOverEmitter(winner_index).emit_winner_only(self.session, self.player_id)
                else:
                    GameOverEmitter(winner_index).emit(self.session, winner_id)
            
            asyncio.create_task(send_game_over())
        
        elif not result.is_correct:
            # 턴 변경 (2초 딜레이)
            deck_empty = self.engine.deck.is_empty()
            
            async def send_turn_change():
                await asyncio.sleep(2.0)
                TurnChangeEmitter(deck_empty).emit(self.session, self.player_id)
            
            asyncio.create_task(send_turn_change())
