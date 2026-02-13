"""
GameEngine - 순수 게임 로직 (PvP)

플레이어가 Hand를 소유하고, Engine은 Player 리스트를 받아서 사용.
"""

from typing import Optional, List, Tuple, TYPE_CHECKING
from typing_extensions import override
from app.core.exceptions import InvalidAction
from app.game.deck import Deck
from app.game.cards.card import Card
from app.game.constants import Color, Phase, MAX_PLAYERS

if TYPE_CHECKING:
    from app.services.player import Player, AIPlayer
    from app.schemas.results.draw import DrawResult
    from app.schemas.results.place import PlaceResult
    from app.schemas.results.guess import GuessResult


class PendingCard(Card):
    """배치 대기 중인 카드"""

    def __init__(self, card: "Card", valid_positions: List[int]) -> None:
        super().__init__(color=card.color, value=card.value)
        self.valid_positions: List[int] = valid_positions


class GameEngine:
    """
    순수 게임 로직 엔진 (PvP).
    
    players: Player 리스트 (2명)
    current_player: 0 또는 1 (플레이어 인덱스)
    플레이어의 손패는 player.hand로 접근
    """

    def __init__(self, players: List["Player"], game_id: Optional[str] = None, seed: Optional[int] = None) -> None:
        """
        게임 엔진 초기화.
        
        Args:
            players: Player 리스트 (2명, 각자 hand를 가짐)
            game_id: 게임 ID
            seed: 랜덤 시드
        """
        if len(players) != 2:
            raise ValueError("플레이어는 정확히 2명이어야 합니다")
        
        self.id: Optional[str] = game_id
        self.players: List["Player"] = players
        self.player_map: dict[str, "Player"] = {p.id: p for p in players}
        self.play_order: List["Player"] = players.copy()
        self.deck: Deck = Deck(seed)
        self.phase: Phase = Phase.DRAW
        self.current_player: "Player" = players[0]
        self.pending_card: Optional[PendingCard] = None
        self.game_over: bool = False
        self.winner: Optional["Player"] = None
        self.is_started: bool = False

    # ==================== Hand 접근 프로퍼티 ====================

    # `players` is a stored attribute set in __init__; do not shadow with a property.

    @property
    def opponent_player(self) -> "Player":
        """상대 플레이어 객체"""
        return self.play_order[(self.player_index + 1) % MAX_PLAYERS]
    
    @property
    def next_player(self) -> "Player":
        """다음 플레이어 객체"""
        return self.play_order[(self.player_index + 1) % MAX_PLAYERS]
    
    @property
    def player_index(self) -> int:
        """현재 플레이어 인덱스"""
        return self.play_order.index(self.current_player)
    
    def get_player_by_id(self, player_id: str) -> "Player":
        """player_id로 플레이어 접근"""
        return self.player_map[player_id]
    
    def get_player_by_index(self, player_index: int) -> "Player":
        """플레이어 인덱스로 플레이어 접근"""
        return self.players[player_index]
    
    def get_opponent_by_id(self, player_id: str) -> "Player":
        """player_id로 상대 플레이어 접근"""
        player = self.get_player_by_id(player_id)
        return player.opponent
    
    def get_opponent_by_index(self, player_index: int) -> "Player":
        """플레이어 인덱스로 상대 플레이어 접근"""
        player = self.get_player_by_index(player_index)
        return player.opponent

    # ==================== 초기화 ====================

    def setup(self) -> Tuple[List[Card], List[Card]]:
        """
        게임 초기 설정. 양쪽 4장씩 배분.
        
        Args:
            first_player: 선공 플레이어 (0 또는 1)
        
        Returns: (player0_cards, player1_cards)
        """
        
        # Player간 opponent 연결
        if self.players[0] and self.players[1]:
            self.players[0]._opponent = self.players[1]
            self.players[1]._opponent = self.players[0]

        player0_cards = self.deck.initial_draw(4)
        player1_cards = self.deck.initial_draw(4)

        self.players[0].add_initial_cards(player0_cards)
        self.players[1].add_initial_cards(player1_cards)
        
        # Constraint matrix 초기화 (AI 플레이어만)
        # 각 AI 플레이어의 constraint matrix를 -1로 리셋 후, 상대의 초기 핸드 사이즈(4)만큼 unknown(0)으로 설정
        initial_hand_size = 4
        for player in self.players:
            # 순환 import 방지: hasattr로 체크
            if hasattr(player, '_constraint_matrix'):
                player.reset_constraint_matrix()
                player.init_constraint_for_initial_hand(initial_hand_size)

        self.current_player = self.play_order[0]
        self.is_started = True
        self.phase = Phase.DRAW

        return player0_cards, player1_cards

    # ==================== DRAW 페이즈 ====================

    def draw(self, player_id: str, color: int) -> "DrawResult":
        """
        카드를 덱에서 뽑음. 배치는 place()에서 별도로.
        
        Args:
            color: 0=검정, 1=흰색
        
        Returns:
            DrawResult
        
        Raises:
            ValueError: 해당 색상 카드 없음
            RuntimeError: DRAW 페이즈가 아님
        """
        self._validate_turn(player_id)
        player = self.get_player_by_id(player_id)

        if self.phase != Phase.DRAW:
            raise RuntimeError(f"Invalid phase: {self.phase.name}, expected DRAW")

        deck_color = Color.BLACK if color == 0 else Color.WHITE

        if not self.deck.has_color(deck_color):
            raise ValueError(f"No {deck_color.name} cards remaining")

        card = self.deck.draw(deck_color)

        valid_positions = self.current_player.hand._find_valid_positions(card)

        self.pending_card = PendingCard(card=card, valid_positions=valid_positions)
        player.pending_card = self.pending_card
        from app.schemas.results.draw import DrawResult
        draw_result = DrawResult(player=player, pending_card=self.pending_card)
        
        return draw_result

    # ==================== PLACE 페이즈 ====================

    def place(self, player_id: str, color: int, number: int, position: int) -> "PlaceResult":
        """
        뽑은 카드를 핸드에 배치.
        
        Args:
            position: 배치할 위치 인덱스
        
        Returns:
            실제 배치된 위치와 카드 색상 (위치, 색상)
        
        Raises:
            RuntimeError: pending_card 없음
            ValueError: 유효하지 않은 위치
        """
        self._validate_turn(player_id)
        player = self.get_player_by_id(player_id)
        pending_card = self.pending_card

        if self.pending_card is None:
            raise RuntimeError("No pending card to place")
        
        if pending_card.color.value != color or pending_card.value != number:
            raise InvalidAction(
                f"카드 정보 불일치: 서버={pending_card.color.value}/{pending_card.value}, "
                f"클라이언트={color}/{number}. draw부터 다시 시도하세요."
            )

        if position not in self.pending_card.valid_positions:
            raise ValueError(f"Invalid position: {position}. Valid: {self.pending_card.valid_positions}")

        card = self.pending_card

        player.place(position)
        
        # 상대방의 constraint matrix 업데이트 (AI만)
        opponent = self.get_opponent_by_id(player_id)
        if hasattr(opponent, '_constraint_matrix'):
            opponent.update_constraint_for_new_card(position)

        self.pending_card = None
        self.phase = Phase.GUESS

        from app.schemas.results.place import PlaceResult
        place_result = PlaceResult(player=player, placed_card=card, position=position)

        return place_result

    # ==================== GUESS 페이즈 ====================

    def guess(self, player_id: str, target_position: int, guessed_value: int) -> "GuessResult":
        """
        상대 카드 추측.
        
        Args:
            target_position: 상대 핸드에서 추측할 카드 위치
            guessed_value: 추측한 값 (0-11, 12=joker)
        
        Returns:
            True if correct, False if wrong
        
        Raises:
            RuntimeError: GUESS 페이즈 아님
            ValueError: 잘못된 위치 또는 이미 공개된 카드
        """
        self._validate_turn(player_id)
        player = self.get_player_by_id(player_id)

        if self.phase != Phase.GUESS:
            raise RuntimeError(f"Invalid phase: {self.phase.name}, expected GUESS")

        target_hand = self.opponent_player.hand

        if target_position < 0 or target_position >= len(target_hand):
            raise ValueError(f"Invalid target position: {target_position}")

        target_card = target_hand[target_position]

        if target_card.is_revealed:
            raise ValueError("Cannot guess already revealed card")

        # 정답 확인
        correct = target_card.value == guessed_value
        from app.schemas.results.guess import GuessResult
        if correct:
            target_card.reveal()
            # 맞춘 위치를 constraint matrix에 기록 (AI만)
            if hasattr(player, '_constraint_matrix'):
                player.record_revealed(target_position)
            guess_result = GuessResult(player=player, card=target_card, position=target_position, guessed_value=str(guessed_value), is_correct=True)
            self.phase = Phase.DECISION

            # 상대 전멸 체크
            if target_hand.all_revealed():
                self._end_game(self.current_player)
        else:
            # 틀린 추측을 constraint matrix에 기록 (AI만)
            if hasattr(player, '_constraint_matrix'):
                player.record_failed_guess(target_position, guessed_value)
            
            # 틀리면 카드 공개 (last_drawn_card 없으면 랜덤 숨겨진 카드 - 학습과 동일)
            revealed_index = self._reveal_drawn_card()
            revealed_card = self.current_player.hand[revealed_index]
            
            # 상대방의 constraint matrix에도 내 공개된 카드 위치 기록 (AI만)
            opponent = self.get_opponent_by_id(player.id)
            if hasattr(opponent, '_constraint_matrix'):
                opponent.record_revealed(revealed_index)
            
            guess_result = GuessResult(player=player, card=revealed_card, position=target_position, guessed_value=str(guessed_value), is_correct=False, revealed_position=revealed_index)

            # 내 카드가 모두 공개되었으면 게임 종료 (패배)
            if self.current_player.hand.all_revealed():
                self._end_game(self.opponent_player)
            else:
                self._end_turn()

        return guess_result

    def _reveal_drawn_card(self) -> int:
        """현재 플레이어의 마지막 뽑은 카드 공개, 공개된 위치 반환"""
        hand = self.current_player.hand
        
        # last_drawn_card가 있고 아직 공개 안됐으면 공개
        if hand.last_drawn_card and not hand.last_drawn_card.is_revealed:
            hand.last_drawn_card.reveal()
            return hand.index(hand.last_drawn_card)
        
        # 덱이 비어서 카드를 못 뽑은 경우 → 랜덤 숨겨진 카드 공개 (학습과 동일)
        return self._reveal_random_hidden_card()
    
    def _reveal_random_hidden_card(self) -> int:
        """현재 플레이어의 랜덤 숨겨진 카드 공개"""
        import random
        hand = self.current_player.hand
        hidden_indices = [i for i, c in enumerate(hand) if not c.is_revealed]
        if not hidden_indices:
            raise RuntimeError("No hidden cards to reveal")
        idx = random.choice(hidden_indices)
        hand[idx].reveal()
        return idx

    # ==================== DECISION 페이즈 ====================

    def decision(self, player_id: str, continue_guessing: bool) -> None:
        """
        추측 계속 여부 결정.
        
        Args:
            continue_guessing: True면 계속 추측, False면 턴 종료
        """
        if self.phase != Phase.DECISION:
            raise RuntimeError(f"Invalid phase: {self.phase.name}, expected DECISION")

        if continue_guessing:
            self.phase = Phase.GUESS
        else:
            self._end_turn()

    def _end_turn(self):
        """턴 종료, 상대에게 넘김"""
        # 현재 플레이어의 카드가 모두 공개되었으면 게임 종료 (패배)
        # if self.current_player.hand.all_revealed():
        #     self._end_game(self.opponent_player)
        #     return

        self.current_player.hand.end_turn()
        self.current_player = self.opponent_player
        
        # 덱이 비어있으면 draw 단계를 건너뛰고 바로 guess로
        if self.deck.is_empty():
            self.phase = Phase.GUESS
        else:
            self.phase = Phase.DRAW

    def _end_game(self, winner: "Player"):
        """게임 종료"""
        self.game_over = True
        self.winner = winner

    def _validate_turn(self, player_id: str) -> bool:
        """
        플레이어 차례 검증
        
        Returns: player_index (0 or 1)
        Raises: InvalidAction if not player's turn
        """
        if not self.is_started:
            raise InvalidAction("게임이 아직 시작되지 않았습니다. 상대방을 기다리세요.")
        
        if self.current_player.id != player_id:
            raise InvalidAction("당신의 차례가 아닙니다.")
        
        return True