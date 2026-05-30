"""Export DaVinciCodePolicy to ONNX for the in-browser demo (docs/model.onnx).

The graph is a PURE tensor function — no sampling, no phase gating, no action
masks (those are cheap and done in JS, see docs/app.js). This keeps the ONNX
graph a clean, deterministic function of the raw observation.

  Inputs : phase(1,3), my_hand(1,13,2), opponent_hand(1,13,2),
           constraint_matrix(1,13,13), remaining_deck(1,2),
           selected_position(1,) int64
  Outputs: color_logits(1,2), position_logits(1,13), value_logits(1,13),
           decision_logits(1,2), belief_logits(1,13,13), value(1,1)

The autoregressive value head is conditioned on `selected_position` (a graph
input). The browser runs the graph twice per GUESS: once (pos=0) to read
position_logits → argmax → pos*, then again with pos=pos* to read value_logits.
color/decision/belief/value don't depend on selected_position.

Usage (from repo root, with deps installed):
    python scripts/export_onnx.py [CHECKPOINT] [OUTPUT]
    # defaults: checkpoints/model.pt -> docs/model.onnx

Verify after export: run a few observations through PyTorch and onnxruntime and
check argmax agreement (logit drift up to ~5e-3 is ordinary float32 noise).
"""
import os
import sys

import numpy as np
import torch
import torch.nn as nn

# Make the package importable from the repo root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.game.model import DaVinciCodePolicy
from app.game.constants import MAX_HAND_SIZE, NUM_VALUES

CKPT = sys.argv[1] if len(sys.argv) > 1 else "checkpoints/model.pt"
OUT = sys.argv[2] if len(sys.argv) > 2 else "docs/model.onnx"
OPSET = 17


def load_policy(ckpt_path: str) -> DaVinciCodePolicy:
    policy = DaVinciCodePolicy().eval()
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    saved = ckpt["policy_state_dict"]
    model_state = policy.state_dict()
    compatible = {k: v for k, v in saved.items()
                  if k in model_state and v.shape == model_state[k].shape}
    missing = policy.load_state_dict(compatible, strict=False)
    print("loaded; missing/unexpected:", missing)
    return policy


class ExportWrapper(nn.Module):
    """obs tensors + selected_position -> raw logits + belief + value.

    Mirrors DaVinciCodePolicy.forward / get_action math, minus masking/gating/sampling.
    """
    def __init__(self, policy: DaVinciCodePolicy):
        super().__init__()
        self.p = policy

    def forward(self, phase, my_hand, opponent_hand, constraint_matrix,
                remaining_deck, selected_position):
        p = self.p
        obs = {
            "phase": phase,
            "my_hand": my_hand,
            "opponent_hand": opponent_hand,
            "constraint_matrix": constraint_matrix,
            "remaining_deck": remaining_deck,
        }
        features, _constraint_per_pos, opponent_per_pos = p.encoder(obs)
        enriched_opp, belief_logits = p._enrich_opp_with_belief(features, opponent_per_pos)

        ah = p.action_heads
        color_logits = ah.color_head(features)
        decision_logits = ah.decision_head(features)

        feat_exp = features.unsqueeze(1).expand(-1, MAX_HAND_SIZE, -1)
        position_logits = ah.position_head(torch.cat([feat_exp, enriched_opp], dim=-1)).squeeze(-1)

        pos_embed = ah.position_embedding(selected_position)
        batch_idx = torch.arange(features.size(0), device=features.device)
        pos_opp = enriched_opp[batch_idx, selected_position]
        value_logits = ah.value_head(torch.cat([features, pos_embed, pos_opp], dim=-1))

        value = p.value_head(features)
        return color_logits, position_logits, value_logits, decision_logits, belief_logits, value


def make_dummy():
    phase = torch.tensor([[0., 1., 0.]], dtype=torch.float32)
    my_hand = torch.tensor([[[0, 1], [0, 3], [0, 5], [1, 2], [1, 6]] + [[-1, -2]] * 8],
                           dtype=torch.float32)
    opp_hand = torch.tensor([[[0, 2], [0, -1], [1, 4], [1, -1]] + [[-1, -2]] * 9],
                            dtype=torch.float32)
    cm = np.full((MAX_HAND_SIZE, NUM_VALUES), -1.0, dtype=np.float32)
    cm[0] = 0; cm[0, 2] = 1
    cm[1] = 0; cm[1, [4, 6, 7, 8, 9, 10, 11]] = 1
    cm[2] = 0; cm[2, 4] = 1
    cm[3] = 0; cm[3, [5, 7, 8, 9, 10, 11]] = 1
    constraint = torch.from_numpy(cm).unsqueeze(0)
    deck = torch.tensor([[6., 4.]], dtype=torch.float32)
    sel = torch.tensor([1], dtype=torch.int64)
    return phase, my_hand, opp_hand, constraint, deck, sel


def main():
    policy = load_policy(CKPT)
    wrapper = ExportWrapper(policy).eval()
    args = make_dummy()
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)

    torch.onnx.export(
        wrapper, args, OUT,
        input_names=["phase", "my_hand", "opponent_hand", "constraint_matrix",
                     "remaining_deck", "selected_position"],
        output_names=["color_logits", "position_logits", "value_logits",
                      "decision_logits", "belief_logits", "value"],
        opset_version=OPSET, dynamo=False, do_constant_folding=True,
    )
    import onnx
    onnx.checker.check_model(onnx.load(OUT))
    print(f"exported {OUT} (opset {OPSET}); size = {os.path.getsize(OUT)} bytes")


if __name__ == "__main__":
    main()
