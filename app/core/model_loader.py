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
            self.policy.load_state_dict(checkpoint["policy_state_dict"])
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


# 전역 싱글톤
model_loader = ModelLoader()
