"""
Observation - 게임 관찰 데이터 구조
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING, Dict, Optional
import torch
import numpy as np
import logging

from app.game.constants import Phase, Color, MAX_HAND_SIZE, NUM_VALUES

logger = logging.getLogger(__name__)


def _print_constraint_matrix(matrix: np.ndarray, player_id: str) -> None:
    """
    제약행렬을 예쁘게 출력
    
    Args:
        matrix: 제약행렬 (MAX_HAND_SIZE, NUM_VALUES)
        player_id: 플레이어 ID
    """
    logger.info(f"\n{'='*60}")
    logger.info(f"Constraint Matrix for Player: {player_id}")
    logger.info(f"{'='*60}")
    logger.info(f"Legend: -1=empty, 0=unknown, 1=failed/revealed")
    logger.info(f"{'-'*60}")
    
    # 헤더 (값 0-12, 12=조커)
    header = "Pos |" + "".join(f"{i:3d}" for i in range(NUM_VALUES))
    logger.info(header)
    logger.info(f"{'-'*60}")
    
    # 각 위치별로 출력
    for pos in range(MAX_HAND_SIZE):
        row = matrix[pos]
        # 모두 -1이면 빈 슬롯이므로 생략
        if np.all(row == -1):
            continue
        
        # 행 출력
        row_str = f" {pos:2d} |" + "".join(f"{int(val):3d}" for val in row)
        logger.info(row_str)
        
        # 추가 정보: 이 위치에서 제외된 값들
        failed_values = [i for i, v in enumerate(row) if v == 1]
        if len(failed_values) == NUM_VALUES:
            logger.info(f"     └─> Revealed")
        elif failed_values:
            failed_str = ", ".join(str(v) if v < 12 else "J" for v in failed_values)
            logger.info(f"     └─> Failed: [{failed_str}]")
    
    logger.info(f"{'='*60}\n")

if TYPE_CHECKING:
    from app.services.game_engine import GameEngine


@dataclass
class Observation:
    """
    게임 관찰 데이터 클래스
    
    Attributes:
        phase: 현재 페이즈 one-hot vector (3,)
        my_hand: 내 핸드 (MAX_HAND_SIZE, 2) - [color, value]
        opponent_hand: 상대방 핸드 (MAX_HAND_SIZE, 2) - 숨겨진 값
        constraint_matrix: 제약 행렬 (MAX_HAND_SIZE, NUM_VALUES)
        remaining_deck: 남은 덱 [black_count, white_count]
    """
    phase: torch.Tensor  # (1, 3)
    my_hand: torch.Tensor  # (1, MAX_HAND_SIZE, 2)
    opponent_hand: torch.Tensor  # (1, MAX_HAND_SIZE, 2)
    constraint_matrix: torch.Tensor  # (1, MAX_HAND_SIZE, NUM_VALUES)
    remaining_deck: torch.Tensor  # (1, 2)
    
    def to_dict(self) -> Dict[str, torch.Tensor]:
        """텐서 딕셔너리로 변환"""
        return {
            "phase": self.phase,
            "my_hand": self.my_hand,
            "opponent_hand": self.opponent_hand,
            "constraint_matrix": self.constraint_matrix,
            "remaining_deck": self.remaining_deck,
        }
    
    @classmethod
    def from_engine(
        cls,
        engine: "GameEngine",
        player_id: str,
        device: torch.device = torch.device("cpu")
    ) -> "Observation":
        """
        GameEngine으로부터 Observation 생성
        
        Args:
            engine: GameEngine 인스턴스
            player_id: 플레이어 ID (string)
            device: 텐서 디바이스
        
        Returns:
            Observation 인스턴스
        """
        # Phase one-hot (3,)
        phase_onehot = np.zeros(3, dtype=np.float32)
        phase_onehot[engine.phase.value] = 1
        
        player = engine.get_player_by_id(player_id)
        # Hands (MAX_HAND_SIZE, 2)
        my_hand = player.hand.to_observation(hidden=False)
        opp_hand = player.opponent.hand.to_observation(hidden=True)
        
        # Constraint matrix (MAX_HAND_SIZE, NUM_VALUES) - AIPlayer만 constraint matrix 사용
        
        if hasattr(player, '_constraint_matrix'):
            constraint_matrix = player.constraint_matrix.astype(np.float32)
            # 디버깅: 제약행렬 예쁘게 출력
            # _print_constraint_matrix(constraint_matrix, player_id)
        else:
            # HumanPlayer는 빈 constraint matrix (모두 0으로 초기화)
            constraint_matrix = np.zeros((MAX_HAND_SIZE, NUM_VALUES), dtype=np.float32)
        
        # Remaining deck (2,)
        remaining_deck = np.array(engine.deck.get_remaining(), dtype=np.float32)
        
        # 텐서 변환 및 배치 차원 추가
        return cls(
            phase=torch.from_numpy(phase_onehot).unsqueeze(0).to(device),
            my_hand=torch.from_numpy(my_hand.astype(np.float32)).unsqueeze(0).to(device),
            opponent_hand=torch.from_numpy(opp_hand.astype(np.float32)).unsqueeze(0).to(device),
            constraint_matrix=torch.from_numpy(constraint_matrix).unsqueeze(0).to(device),
            remaining_deck=torch.from_numpy(remaining_deck).unsqueeze(0).to(device),
        )
    
    @classmethod
    def from_numpy(
        cls,
        phase: np.ndarray,
        my_hand: np.ndarray,
        opponent_hand: np.ndarray,
        constraint_matrix: np.ndarray,
        remaining_deck: np.ndarray,
        device: torch.device = torch.device("cpu")
    ) -> "Observation":
        """
        Numpy 배열로부터 Observation 생성
        
        Args:
            phase: Phase one-hot (3,)
            my_hand: 내 핸드 (MAX_HAND_SIZE, 2)
            opponent_hand: 상대방 핸드 (MAX_HAND_SIZE, 2)
            constraint_matrix: 제약 행렬 (MAX_HAND_SIZE, NUM_VALUES)
            remaining_deck: 남은 덱 (2,)
            device: 텐서 디바이스
        
        Returns:
            Observation 인스턴스
        """
        return cls(
            phase=torch.from_numpy(phase).unsqueeze(0).to(device),
            my_hand=torch.from_numpy(my_hand.astype(np.float32)).unsqueeze(0).to(device),
            opponent_hand=torch.from_numpy(opponent_hand.astype(np.float32)).unsqueeze(0).to(device),
            constraint_matrix=torch.from_numpy(constraint_matrix).unsqueeze(0).to(device),
            remaining_deck=torch.from_numpy(remaining_deck).unsqueeze(0).to(device),
        )


@dataclass
class ActionMask:
    """
    액션 마스크 데이터 클래스
    
    Attributes:
        color: 색상 선택 마스크 (2,) - [BLACK, WHITE]
        position: 위치 선택 마스크 (MAX_HAND_SIZE,)
        value: 값 추측 마스크 (MAX_HAND_SIZE, NUM_VALUES) - per-position
        decision: 결정 마스크 (2,) - [STOP, CONTINUE]
    """
    color: torch.Tensor  # (1, 2)
    position: torch.Tensor  # (1, MAX_HAND_SIZE)
    value: torch.Tensor  # (1, MAX_HAND_SIZE, NUM_VALUES)
    decision: torch.Tensor  # (1, 2)
    
    def to_dict(self) -> Dict[str, torch.Tensor]:
        """텐서 딕셔너리로 변환"""
        return {
            "color": self.color,
            "position": self.position,
            "value": self.value,
            "decision": self.decision,
        }
    
    @classmethod
    def from_engine(
        cls,
        engine,
        player_id: int,
        device: torch.device = torch.device("cpu")
    ) -> "ActionMask":
        """
        GameEngine으로부터 ActionMask 생성
        
        Args:
            engine: GameEngine 인스턴스
            player_id: 플레이어 ID (0=human, 1=ai)
            device: 텐서 디바이스
        
        Returns:
            ActionMask 인스턴스
        """
        player = engine.get_player_by_id(player_id)
        opponent_hand = player.opponent.hand
        my_hand = player.hand
        
        # Color mask (for DRAW phase)
        color_mask = np.array([
            engine.deck.black_count > 0,
            engine.deck.white_count > 0
        ], dtype=bool)
        
        # Position mask (for GUESS phase)
        position_mask = np.zeros(MAX_HAND_SIZE, dtype=bool)
        for i in range(len(opponent_hand)):
            card = opponent_hand[i]
            if card is not None and not card.is_revealed:
                position_mask[i] = True
        
        # Per-position value mask (MAX_HAND_SIZE x NUM_VALUES)
        # 각 값(0-12)은 BLACK 1장, WHITE 1장씩 존재
        # 타겟 위치가 BLACK이면, 이미 확인된 BLACK 값은 불가능
        # 타겟 위치가 WHITE이면, 이미 확인된 WHITE 값은 불가능
        black_confirmed = np.zeros(NUM_VALUES, dtype=bool)
        white_confirmed = np.zeros(NUM_VALUES, dtype=bool)
        
        # 내 핸드의 카드들 (모두 확인됨)
        for card in my_hand:
            if card is not None:
                if card.color == Color.BLACK:
                    black_confirmed[card.value] = True
                else:
                    white_confirmed[card.value] = True
        
        # 상대 핸드에서 이미 공개된 카드들
        for card in opponent_hand:
            if card is not None and card.is_revealed:
                if card.color == Color.BLACK:
                    black_confirmed[card.value] = True
                else:
                    white_confirmed[card.value] = True
        
        # 포지션별 value mask 생성
        value_mask = np.ones((MAX_HAND_SIZE, NUM_VALUES), dtype=bool)
        for i in range(len(opponent_hand)):
            card = opponent_hand[i]
            if card is not None and not card.is_revealed:
                if card.color == Color.BLACK:
                    value_mask[i] = ~black_confirmed
                else:
                    value_mask[i] = ~white_confirmed
                # Safety: 최소 하나의 값은 유효하도록 보장
                if not value_mask[i].any():
                    value_mask[i] = np.ones(NUM_VALUES, dtype=bool)
        
        # Decision mask
        decision_mask = np.array([True, True], dtype=bool)
        
        return cls(
            color=torch.from_numpy(color_mask).unsqueeze(0).to(device),
            position=torch.from_numpy(position_mask).unsqueeze(0).to(device),
            value=torch.from_numpy(value_mask).unsqueeze(0).to(device),
            decision=torch.from_numpy(decision_mask).unsqueeze(0).to(device),
        )
