"""Export DaVinciCodePolicy to ONNX for the in-browser demo (docs/model.onnx).

The graph is a PURE tensor function — no sampling, no phase gating, no action
masks (those are cheap and done in JS, see docs/app.js). This keeps the ONNX
graph a clean, deterministic function of the raw observation.

  Inputs : phase(1,3), my_hand(1,13,2), opponent_hand(1,13,2),
           opp_hand_constraint(1,13,13), my_hand_constraint(1,13,13), remaining_deck(1,2)
  Outputs: color_logits(1,2), position_logits(1,13), value_logits(1,13 positions,13 values),
           decision_logits(1,2), belief_logits(1,13,13), value(1,1)

value_logits holds the value head's output for EVERY position, so one run is
enough: JS picks the position, then reads that position's row. (The value head
is a tiny MLP; the encoder, which dominates the cost, runs once.)

Usage (from repo root, with deps installed):
    python scripts/export_onnx.py [CHECKPOINT] [OUTPUT] [--int8]
    # defaults: checkpoints/model.pt -> docs/model.onnx

The model shape (layers, widths) is read from the checkpoint's config.

--int8 stores the weights as 8-bit integers (file about 1/3 the size). Activations
are quantized to 7 bits (reduce_range): with the full 8 bits, x86 CPUs without VNNI
saturate the integer products and pick different actions than the browser's WASM.

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

from app.game.model import DaVinciCodePolicy, load_weights
from app.game.constants import MAX_HAND_SIZE, NUM_VALUES

INT8 = "--int8" in sys.argv
PATHS = [a for a in sys.argv[1:] if a != "--int8"]
CKPT = PATHS[0] if len(PATHS) > 0 else "checkpoints/model.pt"
OUT = PATHS[1] if len(PATHS) > 1 else "docs/model.onnx"
OPSET = 17


def load_policy(ckpt_path: str) -> DaVinciCodePolicy:
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    cfg = ckpt.get("config", {})
    policy = DaVinciCodePolicy(hidden_dim=cfg.get("hidden_dim") or 512, n_heads=cfg.get("n_heads") or 4,
                               n_layers=cfg.get("n_layers") or 4, ff_dim=cfg.get("ff_dim") or 512).eval()
    fresh = load_weights(policy, ckpt["policy_state_dict"])
    print("loaded; params kept (some) fresh init:", fresh)
    return policy


class ExportWrapper(nn.Module):
    """obs tensors -> raw logits (value logits for every position) + belief + value.

    Mirrors DaVinciCodePolicy.forward / get_action math, minus masking/gating/sampling.
    """
    def __init__(self, policy: DaVinciCodePolicy):
        super().__init__()
        self.p = policy

    def forward(self, phase, my_hand, opponent_hand, opp_hand_constraint,
                my_hand_constraint, remaining_deck):
        p = self.p
        obs = {
            "phase": phase,
            "my_hand": my_hand,
            "opponent_hand": opponent_hand,
            "opp_hand_constraint": opp_hand_constraint,
            "my_hand_constraint": my_hand_constraint,
            "remaining_deck": remaining_deck,
        }
        features, _constraint_per_pos, opponent_per_pos = p.encoder(obs)
        enriched_opp, belief_logits = p._enrich_opp_with_belief(features, opponent_per_pos)

        ah = p.action_heads
        color_logits = ah.color_head(features)
        decision_logits = ah.decision_head(features)

        feat_exp = features.unsqueeze(1).expand(-1, MAX_HAND_SIZE, -1)
        position_logits = ah.position_head(torch.cat([feat_exp, enriched_opp], dim=-1)).squeeze(-1)

        # Value head for all 13 positions at once: (B, 13, hidden + 32 + 64) -> (B, 13, 13)
        pos_embed = ah.position_embedding.weight.unsqueeze(0).expand(features.size(0), -1, -1)
        value_logits = ah.value_head(torch.cat([feat_exp, pos_embed, enriched_opp], dim=-1))

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
    my_cm = np.full((MAX_HAND_SIZE, NUM_VALUES), -1.0, dtype=np.float32)
    my_cm[:5] = 0; my_cm[1, 3] = 1
    my_constraint = torch.from_numpy(my_cm).unsqueeze(0)
    deck = torch.tensor([[6., 4.]], dtype=torch.float32)
    return phase, my_hand, opp_hand, constraint, my_constraint, deck


def main():
    policy = load_policy(CKPT)
    wrapper = ExportWrapper(policy).eval()
    args = make_dummy()
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)

    torch.onnx.export(
        wrapper, args, OUT,
        input_names=["phase", "my_hand", "opponent_hand", "opp_hand_constraint",
                     "my_hand_constraint", "remaining_deck"],
        output_names=["color_logits", "position_logits", "value_logits",
                      "decision_logits", "belief_logits", "value"],
        opset_version=OPSET, dynamo=False, do_constant_folding=True,
    )
    import onnx
    onnx.checker.check_model(onnx.load(OUT))
    if INT8:
        from onnxruntime.quantization import QuantType, quantize_dynamic
        quantize_dynamic(OUT, OUT, weight_type=QuantType.QInt8, reduce_range=True)
    print(f"exported {OUT} (opset {OPSET}); size = {os.path.getsize(OUT)} bytes")


if __name__ == "__main__":
    main()
