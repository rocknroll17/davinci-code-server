"""
Game Service - PvP 게임 실행 로직 + AI 지원
"""

from typing import Optional, List, Tuple
import asyncio
import logging

from app.schemas.game import GameState
from app.services.game_manager import game_manager, GameSession
from app.services.actions import DrawHandler, PlaceHandler, GuessHandler, DecisionHandler
from app.services.player import Player, AIPlayer

from app.game.constants import Phase

logger = logging.getLogger(__name__)


class GameService:
    """
    게임 서비스 - PvP 게임 실행 담당 + AI 자동 실행
    
    두 플레이어가 player_id로 인증하여 행동.
    상대가 AI인 경우 자동으로 AI 턴 실행.
    """
    
    def __init__(self):
        self.manager = game_manager
    
    # ==================== 게임 관리 ====================
    
    def create_game(self) -> Tuple[str, str]:
        """
        새 PvP 게임 생성 (첫 번째 플레이어가 생성)
        
        Returns: (game_id, player_id)
        """
        return self.manager.create_game()
    
    def create_ai_game(self, use_model: bool = True) -> Tuple[str, str]:
        """
        AI 대전 게임 생성
        
        Args:
            use_model: True면 학습된 모델, False면 랜덤 AI
        Returns: (game_id, player_id)
        """
        return self.manager.create_ai_game(use_model)
    
    def join_game(self, game_id: str) -> str:
        """
        게임에 참가 (두 번째 플레이어)
        
        Args:
            game_id: 참가할 게임 ID
        Returns: player_id
        """
        return self.manager.join_game(game_id)
    
    def get_state(self, game_id: str, player_id: str) -> GameState:
        """
        게임 상태 조회 (플레이어 시점)
        
        Args:
            game_id: 게임 ID
            player_id: 요청자 플레이어 ID
        """
        session = self.manager.get_game(game_id)
        return session._build_state(player_id)
    
    def get_waiting_games(self) -> List[str]:
        """대기 중인 게임 목록"""
        return self.manager.list_waiting_games()
    
    def delete_game(self, game_id: str) -> None:
        """게임 삭제"""
        self.manager.remove_game(game_id)

    def get_session(self, game_id: str) -> GameSession:
        """게임 세션 조회"""
        return self.manager.get_game(game_id)
    
    # ==================== 플레이어 액션 ====================
    
    async def draw(self, game_id: str, player_id: str, color: int) -> dict:
        """
        카드 뽑기
        
        Args:
            game_id: 게임 ID
            player_id: 플레이어 ID
            color: 카드 색상 (0=검정, 1=흰색)
        """
        session = self.manager.get_game(game_id)
        return await session.draw(player_id, color)
    
    async def place(self, game_id: str, player_id: str, color: int, number: int, position: int) -> dict:
        """
        카드 배치
        
        Args:
            game_id: 게임 ID
            player_id: 플레이어 ID
            color: 클라이언트가 받은 카드 색상 (0=black, 1=white)
            number: 클라이언트가 받은 카드 번호 (0-11, 12=joker)
            position: 배치할 위치
        """
        session = self.manager.get_game(game_id)
        return await session.place(player_id, color, number, position)
    
    async def guess(self, game_id: str, player_id: str, position: int, value: int) -> dict:
        """
        상대 카드 추측
        
        Args:
            game_id: 게임 ID
            player_id: 플레이어 ID
            position: 추측할 카드 위치
            value: 추측한 값
        """
        session = self.manager.get_game(game_id)
        return await session.guess(player_id, position, value)
    
    async def decision(self, game_id: str, player_id: str, continue_guessing: bool) -> dict:
        """
        계속 추측 여부 결정
        
        Args:
            game_id: 게임 ID
            player_id: 플레이어 ID
            continue_guessing: 계속 추측할지 여부
        """
        session = self.manager.get_game(game_id)
        return await session.decision(player_id, continue_guessing)
    
    # ==================== AI 자동 실행 ====================
    
    async def execute_ai_turn(self, game_id: str) -> bool:
        """
        AI 턴 자동 실행
        
        현재 플레이어가 AI인 경우 전체 턴 실행.
        게임 종료시까지 AI 턴이면 계속 실행.
        
        Returns: 게임 종료 여부
        """
        session = self.manager.get_game(game_id)
        
        if not session.is_started or session.engine.game_over:
            return session.engine.game_over if session.engine else False
        
        engine = session.engine
        current_player = engine.current_player
        
        # AI가 아니면 종료
        if current_player is None or not current_player.is_ai:
            return False
        
        # AI 턴 루프 (연속 추측 포함)
        while not engine.game_over and current_player.is_ai:
            await asyncio.sleep(2)
            await self._execute_single_ai_action(session, current_player)
            
            # 턴이 바뀌었는지 확인
            new_player = engine.current_player
            if new_player != current_player:
                if new_player and new_player.is_ai:
                    # 새 AI 플레이어 계속 진행
                    current_player = new_player
                else:
                    # Human 차례로 전환
                    break
            
            # 약간의 딜레이 (자연스러움)
            await asyncio.sleep(0.3)
        
        return engine.game_over
    
    async def _execute_single_ai_action(self, session: GameSession, ai_player: AIPlayer) -> None:
        """
        단일 AI 액션 실행
        
        ActionHandler를 사용하여 Human과 동일한 로직으로 처리.
        AI 여부는 Handler 내부에서 자동 감지.
        """
        engine = session.engine
        
        if engine.phase == Phase.DRAW:
            # 카드 뽑기
            color = ai_player.draw_action(engine)
            draw_result = await DrawHandler(session, ai_player.id, color).execute()
            
            # 자동 배치
            pending = engine.pending_card
            position = ai_player.place_action(pending.valid_positions)
            await PlaceHandler(session, ai_player.id, color, pending.value, position).execute()
        
        elif engine.phase == Phase.GUESS:
            # 추측
            position, value = ai_player.guess_action(engine)
            await GuessHandler(session, ai_player.id, position, value).execute()
        
        elif engine.phase == Phase.DECISION:
            # 계속 추측 여부
            continue_guessing = ai_player.decision_action(engine)
            await DecisionHandler(session, ai_player.id, continue_guessing).execute()
    
    async def maybe_execute_ai_turn(self, game_id: str) -> bool:
        """
        현재 플레이어가 AI이면 AI 턴 실행
        
        Human 행동 후 호출하여 상대 AI 자동 실행.
        Returns: 게임 종료 여부
        """
        session = self.manager.get_game(game_id)
        if session.is_ai_game is False:
            return False
        
        if not session.is_started or session.engine.game_over:
            return session.engine.game_over if session.engine else False
        
        current_player = session.engine.current_player
        
        if current_player and current_player.is_ai:
            return await self.execute_ai_turn(game_id)
        
        return False


# 전역 서비스
game_service = GameService()
