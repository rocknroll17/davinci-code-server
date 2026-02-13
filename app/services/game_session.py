from typing import List, Optional
from uuid import uuid4
import asyncio
import logging
import os

from app.schemas.cards import CardInfo, PendingCardInfo
from app.schemas.game import PlayerInfo, GameState
from app.schemas.emitters.game_start import GameStartEmitter
from app.game.constants import MAX_PLAYERS

from .game_engine import GameEngine
from .player import Player, HumanPlayer, AIPlayer
from .actions import DrawHandler, PlaceHandler, GuessHandler, DecisionHandler, ActionResult
from app.core.exceptions import InvalidAction
from app.game.hand import Hand

logger = logging.getLogger(__name__)


class GameSession:
    """
    개별 게임 세션 - PvP + AI 지원
    
    두 플레이어가 참가할 수 있는 게임 세션.
    players[0] = 선공, players[1] = 후공
    Player 객체를 통해 Human/AI를 투명하게 처리
    """
    
    def __init__(self, game_id: str):
        self.game_id = game_id
        self.engine: Optional[GameEngine] = None
        self.players: List[Player] = [None] * MAX_PLAYERS 
        self.logs: List[str] = []
        self.message: str = "플레이어 대기 중..."
        self.is_started = False
        self.is_game_over = False  # 게임 종료 플래그 (연결 끊김 등)
        self._lock = asyncio.Lock()  # Race condition 방지용 락

    @property
    def is_ai_game(self) -> bool:
        """AI 대전 게임인지"""
        return any(player.is_ai for player in self.players if player is not None)
    
    @property
    def player_ids(self) -> List[Optional[str]]:
        """하위 호환성을 위한 player_id 리스트"""
        return [p.id if p else None for p in self.players]
    
    @property
    def player_count(self) -> int:
        """현재 참가한 플레이어 수"""
        return sum(1 for p in self.players if p is not None)
    
    @property
    def is_full(self) -> bool:
        """게임이 가득 찼는지"""
        return self.player_count == MAX_PLAYERS
    
    # ==================== SSE 이벤트 ====================
    
    def register_listener(self, player_id: str) -> asyncio.Queue:
        """SSE 리스너 등록"""
        # player = self.engine.get_player_by_id(player_id)
        player = self.players[0] if self.players[0].id == player_id else self.players[1]
        if player:
            return player.register_listener()
        raise ValueError(f"Player {player_id} not found")
    
    def unregister_listener(self, player_id: str):
        """세션 내 players에서 직접 찾아 SSE 리스너 해제"""
        player = self._get_player_by_id(player_id)
        if player:
            player.unregister_listener()
    
    def player_disconnected(self, player_id: str):
        """
        플레이어 연결 끊김 처리
        
        - 상대방에게 알림
        - 게임 종료 처리
        """
        from app.schemas.emitters.enums import EventType
        
        player = self._get_player_by_id(player_id)
        if not player:
            return
        
        # AI 플레이어는 disconnect 처리 불필요
        if player.is_ai:
            return

        if self.is_game_over or (self.engine and self.engine.game_over):
            return
        
        # 상대방에게 연결 끊김 알림
        disconnect_data = {
            "message": "😢 상대방이 게임을 나갔습니다.",
            "disconnected_player": player.player_index
        }
        self.emit_to_opponent(player_id, EventType.PLAYER_DISCONNECTED.value, disconnect_data)
        
        # 로그 기록
        self.log(f"플레이어 {player.player_index + 1}이(가) 게임을 나갔습니다.")
        
        # 게임 종료 표시
        self.is_game_over = True
    
    def _get_player_by_id(self, player_id: str) -> Optional[Player]:
        """세션 내 players에서 player_id로 플레이어 찾기 (engine 없어도 동작)"""
        for player in self.players:
            if player and player.id == player_id:
                return player
        return None
    
    def emit_to_all(self, event_type: str, data: dict):
        """모든 플레이어에게 이벤트 발행"""
        for player in self.players:
            if player:
                player.emit(event_type, data)

    def emit_to_update(self, player_id: str):
        """특정 플레이어에게 상태 업데이트 이벤트 발행"""
        player = self._get_player_by_id(player_id)
        if player:
            player.emit("state_update", {})
    
    def emit_to_player(self, player_id: str, event_type: str, data: dict):
        """특정 플레이어에게 이벤트 발행"""
        player = self._get_player_by_id(player_id)
        if player:
            player.emit(event_type, data)
    
    def emit_to_opponent(self, player_id: str, event_type: str, data: dict):
        """상대 플레이어에게 이벤트 발행"""
        player = self._get_player_by_id(player_id)
        if player:
            opponent = player.opponent
            if opponent:
                opponent.emit(event_type, data)
    
    # ==================== 플레이어 관리 ====================
    def add_player(self, player: Optional[Player] = None) -> str:
        """
        플레이어 추가
        
        Args:
            player: Player 객체 (None이면 HumanPlayer 생성)
        Returns: 생성된 player_id
        Raises: ValueError if already full
        """
        if self.is_full:
            raise ValueError("게임이 이미 가득 찼습니다.")
        
        # 빈 슬롯 찾기
        slot = None
        for i in range(MAX_PLAYERS):
            if self.players[i] is None:
                slot = i
                break
        
        if slot is None:
            raise ValueError("게임이 이미 가득 찼습니다.")
        
        # Player 객체 생성/설정
        if player is None:
            player = HumanPlayer(uuid4().hex[:8])
        elif not player.id:
            player.id = uuid4().hex[:8]
        
        player._player_index = slot
        self.players[slot] = player
        
        # 두 명 모두 참가하면 게임 시작
        if self.is_full:
            self._start_game()
        
        return player.id
    
    def add_ai_player(self) -> str:
        """
        AI 플레이어 추가
        
        Args:
            use_model: True면 학습된 모델 사용, False면 랜덤
        Returns: AI player_id
        """
        ai = AIPlayer(f"ai_{uuid4().hex[:4]}")
        
        return self.add_player(ai)
    
    def _start_game(self):
        """게임 시작"""
        
        # Engine 생성 (Player 리스트 전달)
        self.engine = GameEngine(self.players, self.game_id)
        self.engine.setup()
        
        self.is_started = True
        self.log("게임 시작! 플레이어 1의 차례입니다.")
        self.message = "검정 또는 흰색 카드를 뽑으세요."
        
        # 게임 시작 이벤트 발송
        GameStartEmitter().emit(self)
    
    def get_player_info(self, player_id: str) -> dict:
        """플레이어 정보 반환 (타입 숨김)"""
        player = self._get_player_by_id(player_id)
        if player is None:
            return {"id": None, "connected": False}
        return {
            "id": player.id,
            "connected": True,
            "index": player.player_index,
        }
    
    def get_player_index(self, player_id: str) -> int:
        """player_id로 플레이어 인덱스 조회 (engine 없이도 동작)"""
        for i, player in enumerate(self.players):
            if player and player.id == player_id:
                return i
        raise ValueError(f"Player {player_id} not found")

    def log(self, msg: str):
        """로그 추가"""
        # Ensure logs always store strings (some callers pass Result objects)
        self.logs.append(str(msg))
        if len(self.logs) > 20:
            self.logs.pop(0)
    
    def winner_log(self, file_path: str = "game_winners.log"):
        """게임 승자 로그 기록 (AI 대전만). human_wins,ai_wins 형식."""
        if not self.is_ai_game or self.engine is None or not self.engine.game_over:
            return
        
        winner = self.engine.winner
        if winner is None:
            return
        
        # 승자가 AI인지 인간인지 판별
        ai_won = winner.is_ai
        
        if not os.path.exists(file_path):
            with open(file_path, "w") as f:
                f.write("0,0")
        
        with open(file_path, "r") as f:
            line = f.readline().strip()
        
        try:
            human, ai = line.split(",")
            human, ai = int(human), int(ai)
        except (ValueError, AttributeError):
            human, ai = 0, 0
        
        if ai_won:
            ai += 1
        else:
            human += 1
        
        with open(file_path, "w") as f:
            f.write(f"{human},{ai}")
    
    # ==================== 액션 (ActionHandler 위임) ====================

    async def draw(self, player_id: str, color: int) -> dict:
        """카드 뽑기 - ActionHandler 위임"""
        handler = DrawHandler(self, player_id, color)
        result = await handler.execute()
        if not result.success:
            raise InvalidAction(result.error)
        return result.data
    
    async def place(self, player_id: str, color: int, number: int, position: int) -> dict:
        """카드 배치 - ActionHandler 위임"""
        handler = PlaceHandler(self, player_id, color, number, position)
        result = await handler.execute()
        if not result.success:
            raise InvalidAction(result.error)
        return result.data
    
    async def guess(self, player_id: str, position: int, value: int) -> dict:
        """상대 카드 추측 - ActionHandler 위임"""
        handler = GuessHandler(self, player_id, position, value)
        result = await handler.execute()
        if not result.success:
            raise InvalidAction(result.error)
        return result.data
    
    async def decision(self, player_id: str, continue_guessing: bool) -> dict:
        """계속 추측 여부 결정 - ActionHandler 위임"""
        handler = DecisionHandler(self, player_id, continue_guessing)
        result = await handler.execute()
        if not result.success:
            raise InvalidAction(result.error)
        return result.data

    
    def _build_state(self, player_id: str, for_actor: bool = False) -> GameState:
        """
        게임 상태 빌드 (특정 플레이어 시점)
        
        Args:
            player_id: 플레이어 ID
            for_actor: True면 행동자 응답용 (self.message 사용), False면 일반 조회용
        """
        
        if self.engine is None:
            # 게임이 아직 시작되지 않음 - 기본값 반환
            player_index = self.get_player_index(player_id)
            me_info = {"id": player_id, "connected": True, "index": player_index}
            opponent_info = {"id": None, "connected": False, "index": 1 - player_index}
            
            return GameState(
                game_id=self.game_id,
                phase="waiting",
                current_player=None,
                is_my_turn=False,
                game_over=False,
                winner=None,
                me=PlayerInfo(**me_info),
                opponent=PlayerInfo(**opponent_info),
                my_hand=[],
                opponent_hand=[],
                deck_black=0,
                deck_white=0,
                pending_card=None,
                message=self.message,
                logs=list(self.logs)
            )
        
        # 내 손패와 상대 손패
        player = self.engine.get_player_by_id(player_id)
        my_hand_raw = player.hand
        opponent_hand_raw = player.opponent_hand
        my_last_drawn = my_hand_raw.last_drawn_card
        opponent_last_drawn = opponent_hand_raw.last_drawn_card

        # 내 손패 - 모든 값 공개
        my_hand = [
            CardInfo(
                position=i,
                color=int(c.color),
                value=int(c.value),
                revealed=bool(c.is_revealed),
                is_last_drawn=(c is my_last_drawn) and (self.engine.current_player.id == player_id or c.is_revealed)
            )
            for i, c in enumerate(my_hand_raw) if c is not None
        ]
        
        # 상대 손패 - 공개된 것만 값 보임
        # is_last_drawn: 상대가 마지막으로 배치한 카드를 표시 (guess phase에서 상대 턴이 아니어도 표시)
        opponent_hand = [
            CardInfo(
                position=i,
                color=int(c.color),
                value=int(c.value),
                revealed=bool(c.is_revealed),
                is_last_drawn=(c is opponent_last_drawn)
            )
            for i, c in enumerate(opponent_hand_raw) if c is not None
        ]
        
        # 대기 중인 카드 (내 차례일 때만)
        pending = None
        if self.engine.pending_card and self.engine.current_player.id == player_id:
            pending = PendingCardInfo(
                color=self.engine.pending_card.color.value,
                value=self.engine.pending_card.value,
                valid_positions=self.engine.pending_card.valid_positions
            )
        
        # 플레이어 정보 (AI 여부는 숨김)
        me_info = self.get_player_info(player_id)
        opponent_info = self.get_player_info(self.engine.get_opponent_by_id(player_id).id)
        
        # 플레이어별 메시지 결정
        is_my_turn = (self.engine.current_player.id == player_id)
        if self.engine.game_over:
            # 게임 종료
            if self.engine.winner and self.engine.winner.id == player_id:
                player_message = "🎉 축하합니다! 당신이 승리했습니다!"
            else:
                player_message = "😢 아쉽습니다. 상대방이 승리했습니다."
        elif for_actor:
            # 행동자 응답 - self.message 그대로 사용 (턴이 넘어갔어도 행동 결과 메시지 표시)
            player_message = self.message
        elif is_my_turn:
            # 내 턴 - 행동자 메시지 사용
            player_message = self.message
        else:
            # 상대방 턴 - 대기 메시지
            player_message = "⏳ 상대방의 차례입니다. 기다려주세요."
        
        return GameState(
            game_id=self.game_id,
            phase=self.engine.phase.name.lower(),
            current_player=self.engine.current_player.id,
            is_my_turn=is_my_turn,
            game_over=self.engine.game_over,
            winner=self.engine.winner.player_index if self.engine.winner else None,
            me=PlayerInfo(**me_info),
            opponent=PlayerInfo(**opponent_info),
            my_hand=my_hand,
            opponent_hand=opponent_hand,
            deck_black=self.engine.deck.black_count,
            deck_white=self.engine.deck.white_count,
            pending_card=pending,
            message=player_message,
            logs=list(self.logs)
        )