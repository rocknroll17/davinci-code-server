from abc import ABC, abstractmethod
from typing import Tuple, List, Optional, TYPE_CHECKING
from enum import Enum, auto
import asyncio
import random
import numpy as np

from app.schemas.observation import Observation, ActionMask
from app.core.config import settings
from app.core.model_loader import model_loader
from app.services.game_engine import PendingCard
from app.game.cards.card import Card
from app.game.hand import Hand
from app.game.constants import MAX_HAND_SIZE, NUM_VALUES

# 순환 import 방지
if TYPE_CHECKING:
    from app.services.game_engine import GameEngine
    


class PlayerType(Enum):
    """플레이어 타입"""
    HUMAN = auto()
    AI = auto()


class Player(ABC):
    """
    플레이어 추상 클래스
    
    Player가 소유하는 것:
    - id: 플레이어 식별자
    - player_index: 게임 내 인덱스 (0 or 1)
    - hand: 자신의 손패
    - opponent: 상대 플레이어
    - event_queue: SSE 이벤트 큐
    """

    def __init__(self, player_id: str = ""):
        self.id: str = player_id
        self._player_index: Optional[int] = None
        self._hand: Hand = Hand()
        self.pending_card: Optional[PendingCard] = None
        self._opponent: Optional["Player"] = None
        self._event_queue: Optional[asyncio.Queue] = None  # SSE 이벤트 큐
    
    # ==================== 기본 속성 ====================
    
    @property
    def player_index(self) -> Optional[int]:
        """게임 내 인덱스 (0 or 1)"""
        return self._player_index
    
    @player_index.setter
    def player_index(self, value: int):
        self._player_index = value

    # ==================== Hand 접근 프로퍼티 ====================

    # My hand
    @property
    def hand(self) -> Optional["Hand"]:
        """플레이어의 손패"""
        return self._hand
    
    @hand.setter
    def hand(self, value: "Hand"):
        self._hand = value
    
    # Opponent player's hand (masked view)
    @property
    def opponent_hand(self) -> "Hand":
        """상대의 손패 (편의 프로퍼티)"""
        return self._opponent.hand.to_opponent_view()
    
    # ==================== Opponent 접근 프로퍼티 ====================
    @property
    def opponent(self) -> Optional["Player"]:
        """상대 플레이어 객체"""
        return self._opponent


    @opponent.setter
    def opponent(self, value: "Player"):
        self._opponent = value
    
    # ==================== SSE 이벤트 ====================
    
    @property
    def event_queue(self) -> Optional[asyncio.Queue]:
        """SSE 이벤트 큐"""
        return self._event_queue
    
    def register_listener(self) -> asyncio.Queue:
        """SSE 리스너 등록, Queue 반환"""
        self._event_queue = asyncio.Queue()
        return self._event_queue
    
    def unregister_listener(self):
        """SSE 리스너 해제"""
        self._event_queue = None
    
    def emit(self, event_type: str, data: dict):
        """이벤트를 내 queue에 넣기 (Session이 호출)"""
        if self._event_queue is not None:
            try:
                self._event_queue.put_nowait({"type": event_type, "data": data})
            except asyncio.QueueFull:
                pass
    
    # ==================== 타입 관련 ====================
    
    @property
    @abstractmethod
    def player_type(self) -> PlayerType:
        """플레이어 타입 반환"""
        pass
    
    @property
    def is_human(self) -> bool:
        return self.player_type == PlayerType.HUMAN
    
    @property
    def is_ai(self) -> bool:
        return self.player_type == PlayerType.AI
    
    # Note: draw, place, guess, decision 메서드는 각 서브클래스에서 직접 구현
    # Human: HTTP 요청 받은 값 저장/반환
    # AI: 모델 기반 결정 (draw_action, guess_action 등 사용)

    # Method
    def add_initial_cards(self, cards: List["Card"]):
        """초기 카드 추가 (동기)

        GameEngine.setup()에서 동기 호출되므로 비동기 코루틴이 아닌 일반 메서드로 유지합니다.
        """
        if self._hand is not None:
            self._hand.add_initial_cards(cards)

class HumanPlayer(Player):
    """
    인간 플레이어
    
    HTTP 요청을 통해 입력을 받고 저장.
    GameService가 set_*로 값을 설정하면, 메서드가 그 값을 반환.
    """
    
    def __init__(self, player_id: str = ""):
        super().__init__(player_id)
    
    @property
    def player_type(self) -> PlayerType:
        return PlayerType.HUMAN
    
    def draw(self, pending_card: PendingCard) -> None:
        """드로우한 카드 저장"""
        self.pending_card = pending_card
    
    def place(self, position: int) -> bool:
        """카드 배치"""
        self.hand.add_pending_card(self.pending_card, position)
        self.pending_card = None
        return True
    
    def guess(self, position: int, value: int) -> Tuple[int, int]:
        """추측 정보 반환"""
        return position, value
    
    def decision(self, continue_guessing: bool) -> bool:
        """결정 정보 반환"""
        return continue_guessing


class AIPlayer(Player):
    """
    AI 플레이어 - 모델 기반 결정
    
    학습된 모델을 사용해 자동으로 결정.
    Human과 동일한 인터페이스로 사람이 AI인지 모름.
    """
    
    def __init__(self, player_id: str = "ai"):
        super().__init__(player_id)
        self.device = model_loader.device
        self._constraint_matrix: np.ndarray = np.full((MAX_HAND_SIZE, NUM_VALUES), -1, dtype=np.int8)
        self._last_reasoning = None  # 마지막 추측 추론 데이터 (시각화용)
        self._reasoning_ack: asyncio.Event = asyncio.Event()  # 클라이언트 확인 버튼 신호
    
    @property
    def player_type(self) -> PlayerType:
        return PlayerType.AI
    
    def draw_action(self, engine: "GameEngine") -> int:
        """모델 기반 draw 결정"""

        action = self.get_action(engine)
        color = int(action[0, 0].item())
        
        # 유효성 검증
        if color == 0 and engine.deck.black_count > 0:
            return 0
        elif color == 1 and engine.deck.white_count > 0:
            return 1
        else:
            return 0 if engine.deck.black_count > 0 else 1
    
    def place_action(self, valid_positions: List[int]) -> int:
        """카드 배치 위치 결정 (학습처럼 valid_positions 중 랜덤 선택)"""
        if len(valid_positions) == 1:
            return valid_positions[0]
        # 학습 코드의 _get_insert_position과 동일하게 valid_positions 중 랜덤 선택
        return random.choice(valid_positions)
    
    def guess_action(self, engine: "GameEngine") -> Tuple[int, int]:
        """추측할 (위치, 값) 결정. ENABLE_REASONING이면 시각화 데이터도 수집."""
        obs = Observation.from_engine(engine, self.id, self.device)
        mask = ActionMask.from_engine(engine, self.id, self.device)

        if settings.ENABLE_REASONING:
            try:
                action, reasoning = model_loader.get_action_with_reasoning(obs.to_dict(), mask.to_dict())
                self._last_reasoning = reasoning
                # AI 자신의 패를 추론 페이로드에 포함 (실제 값 포함 — AI는 자기 패를 앎)
                self._last_reasoning['ai_hand'] = [
                    {
                        'position': i,
                        'color': int(card.color),
                        'value': int(card.value),
                        'is_revealed': card.is_revealed
                    }
                    for i, card in enumerate(self._hand)
                ]
            except Exception:
                action, _, _ = model_loader.get_action(obs.to_dict(), mask.to_dict())
                self._last_reasoning = None
        else:
            # 운영 모드: 추론 데이터 없이 바로 행동.
            # GuessHandler는 _last_reasoning이 None이면 ai_reasoning 발송/확인 대기를 건너뜀.
            action, _, _ = model_loader.get_action(obs.to_dict(), mask.to_dict())
            self._last_reasoning = None

        position = int(action[0, 1].item())
        value = int(action[0, 2].item())

        # 유효성 검증 (self.opponent_hand 사용)
        opp_hand = self.opponent_hand
        if opp_hand and position < len(opp_hand) and not opp_hand[position].is_revealed:
            return position, value

        # Fallback: 첫 번째 숨겨진 카드
        if opp_hand:
            for i, card in enumerate(opp_hand):
                if not card.is_revealed:
                    if self._last_reasoning:
                        self._last_reasoning['position'] = i
                    return i, value

        return 0, 0
    
    def decision_action(self, engine: "GameEngine") -> bool:
        """계속 추측할지 결정 (모델 기반)"""
        action = self.get_action(engine)
        decision = int(action[0, 3].item())
        # decision이 1이면 계속 추측, 0이면 멈춤
        return decision == 1
    
    def get_action(self, engine: "GameEngine") -> Tuple[Observation, ActionMask]:
        """현재 상태에서 모델 기반 행동 결정"""
        obs = Observation.from_engine(engine, self.id, self.device)
        mask = ActionMask.from_engine(engine, self.id, self.device)

        action, _, _ = model_loader.get_action(obs.to_dict(), mask.to_dict())
        return action
    
    def draw(self, pending_card: PendingCard) -> None:
        """드로우한 카드 저장"""
        self.pending_card = pending_card
    
    def place(self, position: int) -> bool:
        """카드 배치"""
        self.hand.add_pending_card(self.pending_card, position)
        self.pending_card = None
        return True

    def guess(self, position: int, value: int) -> Tuple[int, int]:
        """추측 정보 반환"""
        return position, value
    
    def decision(self, continue_guessing: bool) -> bool:
        """결정 정보 반환"""
        return continue_guessing
    
    # ==================== Constraint Matrix 관리 ====================
    
    def reset_constraint_matrix(self):
        """constraint matrix 초기화 (모두 -1: 상대 핸드에 없는 위치)"""
        self._constraint_matrix.fill(-1)
    
    def init_constraint_for_initial_hand(self, initial_hand_size: int):
        """
        게임 시작 시 상대의 초기 핸드 사이즈만큼 unknown(0)으로 설정
        
        Args:
            initial_hand_size: 초기 핸드 사이즈 (보통 4)
        """
        self._constraint_matrix[:initial_hand_size, :] = 0
    
    def record_failed_guess(self, position: int, value: int, color: int = 0):
        """
        틀린 추측 기록 (13-col, slot color known from opp_hand)
        
        Args:
            position: 추측한 위치
            value: 틀린 값 (0-12)
            color: 카드 색상 (미사용, opp_hand에서 이미 전달됨)
        """
        if 0 <= position < MAX_HAND_SIZE and 0 <= value < NUM_VALUES:
            col = value
            self._constraint_matrix[position, col] = 1
    
    def record_revealed(self, position: int):
        """
        카드가 공개되었을 때 해당 위치 전체를 마킹
        
        Args:
            position: 공개된 카드 위치
        """
        if 0 <= position < MAX_HAND_SIZE:
            self._constraint_matrix[position, :] = 1
    
    def update_constraint_for_new_card(self, position: int):
        """
        상대가 새 카드를 배치했을 때 constraint matrix 업데이트
        해당 위치에 새 행을 삽입하고 기존 행들을 shift
        
        Args:
            position: 새 카드가 삽입된 위치
        """
        nrows, ncols = self._constraint_matrix.shape
        position = max(0, min(position, nrows))
        
        # 새 위치에 0으로 채워진 행 삽입
        self._constraint_matrix = np.insert(
            self._constraint_matrix,
            position,
            values=np.zeros(ncols, dtype=self._constraint_matrix.dtype),
            axis=0
        )
        
        # 원래 크기로 truncate
        if self._constraint_matrix.shape[0] > nrows:
            self._constraint_matrix = self._constraint_matrix[:nrows, :]

    @property
    def constraint_matrix(self) -> np.ndarray:
        """current constraint matrix 반환 (NUM_VALUES cols)"""
        return self._constraint_matrix.copy()