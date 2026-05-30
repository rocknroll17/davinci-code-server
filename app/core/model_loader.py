"""
AI Model Loader - 싱글톤으로 모델 관리
"""

import os
import torch
from typing import Optional

from app.game.model import DaVinciCodePolicy
from app.core.config import settings


class ModelLoader:
    """AI 모델 로더 (싱글톤)"""
    
    _instance: Optional["ModelLoader"] = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        self.policy: Optional[DaVinciCodePolicy] = None
        self.device: Optional[torch.device] = None
        self._initialized = True
    
    def load(self, checkpoint_path: str = None):
        """모델 로드."""
        path = checkpoint_path or settings.CHECKPOINT_PATH
        
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.policy = DaVinciCodePolicy().to(self.device)
        self.policy.eval()
        
        if os.path.exists(path):
            checkpoint = torch.load(path, map_location=self.device, weights_only=False)
            # Filter shape-mismatched keys (e.g., belief_head after architecture update)
            saved_state = checkpoint["policy_state_dict"]
            model_state = self.policy.state_dict()
            compatible = {k: v for k, v in saved_state.items()
                          if k in model_state and v.shape == model_state[k].shape}
            shape_mismatch = [k for k, v in saved_state.items()
                              if k in model_state and v.shape != model_state[k].shape]
            if shape_mismatch:
                print(f"Shape mismatch — re-initialized: {shape_mismatch}")
            self.policy.load_state_dict(compatible, strict=False)
            timesteps = checkpoint.get("timesteps", 0)
            print(f"✓ 모델 로드 완료: {path} ({timesteps:,} timesteps)")
        else:
            raise FileNotFoundError(f"체크포인트 파일을 찾을 수 없습니다: {path}")
    
    def get_action(self, obs_dict, action_mask_dict, deterministic: bool = True):
        """AI 액션 결정. 모델의 get_action을 호출하여 (action, log_probs, value) 반환."""
        with torch.no_grad():
            action, log_probs, value = self.policy.get_action(
                obs_dict, action_mask_dict, deterministic=deterministic
            )
        return action, log_probs, value

    def get_action_with_reasoning(self, obs_dict, action_mask_dict, deterministic: bool = True):
        """
        AI 액션 결정 + 마지막 Transformer 레이어 기반 추론 시각화 데이터 추출.

        토큰 레이아웃 (42개, CLS 포함):
          [0]      CLS
          [1-13]   AI 자신의 카드   (화면의 opponent-hand)
          [14-26]  상대 (인간) 카드 (화면의 player-hand)
          [27-39]  constraint 토큰  (화면에 표시 안 함)
          [40]     phase 토큰
          [41]     deck 토큰

        attention_scores 반환 레이아웃 (41개, CLS 제외):
          [0-12]   AI 자신의 카드   (opponent-hand)
          [13-25]  상대 (인간) 카드 (player-hand)
          [26-38]  constraint 토큰  (화면에 표시 안 함)
          [39]     phase 토큰
          [40]     deck 토큰

        정규화는 화면에 보이는 카드 26개([0-25]) 기준으로만 수행한다 — 보이지 않는
        constraint/phase/deck 토큰을 분모에 섞으면 표시되는 attention %가 왜곡되기 때문.
        """
        import torch.nn.functional as F
        from app.game.constants import MAX_HAND_SIZE

        captured = {}
        last_layer = self.policy.encoder.transformer.layers[-1]

        def _hook(module, inp, out):
            captured['src'] = inp[0].detach().clone()   # (batch, 42, token_dim)
            captured['out'] = out.detach().clone()       # (batch, 42, token_dim)

        # Also hook encoder to capture opponent_per_pos for belief distribution
        captured_enc = {}
        def _enc_hook(module, inp, out):
            # out: (features, constraint_per_pos, opponent_per_pos)
            captured_enc['opponent_per_pos'] = out[2].detach().clone()  # (1, 13, 64)

        hook = last_layer.register_forward_hook(_hook)
        enc_hook = self.policy.encoder.register_forward_hook(_enc_hook)
        try:
            with torch.no_grad():
                action, log_probs, value = self.policy.get_action(
                    obs_dict, action_mask_dict, deterministic=deterministic
                )
        finally:
            hook.remove()
            enc_hook.remove()

        # 41 = 42 tokens(CLS + my13 + opp13 + constraint13 + phase + deck) minus CLS
        scores = [0.0] * 41
        if 'out' in captured and 'src' in captured:
            position = int(action[0, 1].item())
            # CLS offset: opp tokens start at index 14 (1 CLS + 13 my cards)
            opp_token_idx = 1 + MAX_HAND_SIZE + position   # 1 + 13 + pos = 14+pos

            target_out = captured['out'][0, opp_token_idx]   # (token_dim,)
            src_tokens  = captured['src'][0]                  # (42, token_dim)

            # 코사인 유사도: target 출력 vs 모든 입력 토큰 (CLS 제외 → 1:41)
            non_cls_src = src_tokens[1:]                          # (41, token_dim)
            target_norm = F.normalize(target_out.unsqueeze(0), dim=-1)   # (1, D)
            src_norm    = F.normalize(non_cls_src, dim=-1)               # (41, D)
            raw_scores  = (target_norm @ src_norm.T).squeeze(0)          # (41,)

            # 화면에 보이는 카드 토큰 26개(my13 + opp13)만 정규화 기준으로 사용
            card_tokens = 2 * MAX_HAND_SIZE   # 26

            # target 자신(opp_token_idx-1 in non-CLS space) 점수는 카드 영역 최솟값으로 눌러 제거
            self_idx_no_cls = opp_token_idx - 1
            raw_scores[self_idx_no_cls] = raw_scores[:card_tokens].min()

            # [0, 1] 정규화 — 분모를 보이는 카드 26개로 한정 (안 보이는 토큰 제외)
            card_scores = raw_scores[:card_tokens]
            s_min, s_max = card_scores.min(), card_scores.max()
            if (s_max - s_min).item() > 1e-6:
                raw_scores = (raw_scores - s_min) / (s_max - s_min)
            else:
                raw_scores = torch.zeros_like(raw_scores)

            scores = raw_scores.cpu().numpy().tolist()

        reasoning = {
            'position': int(action[0, 1].item()),
            'value':    int(action[0, 2].item()),
            'attention_scores': scores,
            'belief_probs': None,
        }

        # Compute belief distribution: per human-card position, probability over 13 values
        if 'opponent_per_pos' in captured_enc:
            with torch.no_grad():
                opp = captured_enc['opponent_per_pos']                   # (1, 13, 64)
                # Reconstruct features via encoder to match new belief_head signature
                features_cap = self.policy.encoder(obs_dict)[0]          # (1, hidden_dim)
                global_exp = features_cap.unsqueeze(1).expand(-1, opp.size(1), -1)
                combined = torch.cat([global_exp, opp], dim=-1)          # (1, 13, hidden_dim+64)
                belief_logits = self.policy.belief_head(combined)        # (1, 13, 13)
                belief_probs = F.softmax(belief_logits, dim=-1)          # (1, 13, 13)
                probs = belief_probs[0].clone()                          # (13, 13)

                # Mask out impossible values using known card info from obs_dict
                # my_hand / opponent_hand: (1, 13, 2) → [color, value]
                # value >= 0 means revealed; -1 = hidden; -2 = empty slot
                my_hand_t    = obs_dict['my_hand']
                opp_hand_t   = obs_dict['opponent_hand']
                my_hand_np   = (my_hand_t[0].cpu().numpy()
                                if hasattr(my_hand_t, 'cpu') else my_hand_t[0])
                opp_hand_np  = (opp_hand_t[0].cpu().numpy()
                                if hasattr(opp_hand_t, 'cpu') else opp_hand_t[0])

                # Collect AI's own (color, value) pairs (skip empty/hidden)
                my_known = [(int(c[0]), int(c[1]))
                            for c in my_hand_np if int(c[1]) >= 0]
                # Collect opponent's already-revealed (color, value) pairs
                opp_revealed = [(int(c[0]), int(c[1]))
                                for c in opp_hand_np if int(c[1]) >= 0]

                for pos in range(13):
                    pos_color = int(opp_hand_np[pos][0])
                    pos_value = int(opp_hand_np[pos][1])

                    if pos_value == -2:          # empty slot
                        probs[pos] = 0.0
                        continue
                    if pos_value >= 0:           # already revealed → deterministic
                        probs[pos] = 0.0
                        probs[pos, pos_value] = 1.0
                        continue

                    # Hidden card: zero out values impossible for this color
                    impossible = {v for (c, v) in my_known    if c == pos_color} | \
                                 {v for (c, v) in opp_revealed if c == pos_color}
                    for v in impossible:
                        if 0 <= v <= 12:
                            probs[pos, v] = 0.0

                    # Re-normalize
                    row_sum = probs[pos].sum()
                    if row_sum > 1e-8:
                        probs[pos] = probs[pos] / row_sum

                reasoning['belief_probs'] = probs.cpu().numpy().tolist()  # (13, 13)

        return action, reasoning


# 전역 싱글톤
model_loader = ModelLoader()
