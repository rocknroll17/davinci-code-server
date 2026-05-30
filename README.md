# Da Vinci Code — Game Server

[![CI](https://github.com/rocknroll17/davinci-code-server/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/rocknroll17/davinci-code-server/actions/workflows/ci.yml)
[![CodeQL](https://github.com/rocknroll17/davinci-code-server/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/rocknroll17/davinci-code-server/actions/workflows/codeql.yml)
[![Release](https://github.com/rocknroll17/davinci-code-server/actions/workflows/release.yml/badge.svg)](https://github.com/rocknroll17/davinci-code-server/actions/workflows/release.yml)
[![GHCR](https://img.shields.io/badge/ghcr.io-davinci--code--server-2ea44f?logo=docker&logoColor=white)](https://github.com/rocknroll17/davinci-code-server/pkgs/container/davinci-code-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Play **Da Vinci Code** against a trained AI. A **FastAPI + SSE** server for real-time
human-vs-AI (and PvP) matches, plus a **zero-backend browser demo** where the policy
net runs entirely client-side via ONNX.

### Try it

- **[Play in your browser →](https://rocknroll17.github.io/davinci-code-server/)** — the
  trained policy runs **100% client-side** (ONNX + onnxruntime-web). No install, no backend.
- **Self-host the full server** — one `docker run` (see [Run the server](#run-the-server)).
  Real-time PvP + AI matches over SSE.

> The model is trained in a separate repo:
> [**davinci-code-agent**](https://github.com/rocknroll17/davinci-code-agent) (PPO self-play).

<details>
<summary><b>Table of contents</b></summary>

- [How it fits together](#how-it-fits-together)
- [Run the server](#run-the-server)
- [The model](#the-model)
- [AI reasoning visualization](#ai-reasoning-visualization)
- [API](#api)
- [Configuration](#configuration)
- [Project structure](#project-structure)
- [License](#license)

</details>

## How it fits together

```
                          ┌─────────────────────────────────────────────┐
Browser ── REST  ───────► │ FastAPI  ─► GameService ─► GameManager       │
        ◄── SSE  ───────  │   router      (facade)      └─► GameSession   │
        (event stream)    │                                  └─► GameEngine (rules)
                          │                          model_loader ─► policy net
                          └─────────────────────────────────────────────┘

Static demo (docs/, GitHub Pages):  Browser ─► model.onnx (onnxruntime-web)   [no server]
```

- **Full server** (`/`): REST actions + an SSE stream push game events in real time;
  the AI plays via the loaded PyTorch policy. Supports PvP and vs-AI.
- **Browser demo** (`docs/`): the game rules are ported to JS and the policy runs as
  ONNX in the browser — same gameplay, no backend. Deployed to GitHub Pages.

## Run the server

### Docker (recommended)

The published image **bakes the model in** — just pull and run (no mount, no download):

```bash
docker pull ghcr.io/rocknroll17/davinci-code-server:latest

# The container always listens on 6000; choose any free host port.
PORT="${PORT:-6000}"
docker run -d --gpus all \
    --name davinci-server \
    --restart unless-stopped \
    -p "${PORT}:6000" \
    ghcr.io/rocknroll17/davinci-code-server:latest
```

Open `http://localhost:${PORT}`. `--gpus all` runs inference on the GPU (needs the
[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html));
drop it to fall back to CPU.

### Local development

Requires Python 3.10.

```bash
python3.10 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Fetch the model (it is not in git — see "The model" below)
oras pull ghcr.io/rocknroll17/davinci-model:latest -o checkpoints

python run.py        # serves http://0.0.0.0:6000
```

## The model

The model is **not stored in git**. It is versioned independently as a **GHCR OCI
artifact** — the source of truth — because it changes on its own cadence (retraining):

```
ghcr.io/rocknroll17/davinci-model:<version>   (+ :latest)
```

The release build ([`release.yml`](.github/workflows/release.yml)) pulls it with
[ORAS](https://oras.land/) and bakes it into the server image, so the deployable image is
self-contained. Publish a new model with [`scripts/publish_model.sh`](scripts/publish_model.sh):

```bash
echo "$GHCR_TOKEN" | oras login ghcr.io -u <user> --password-stdin   # needs write:packages
scripts/publish_model.sh checkpoints/model.pt 0.3.0                  # pushes :0.3.0 and :latest
```

Pin which model a build bakes via the repo variable `MODEL_TAG` (default `latest`).

## AI reasoning visualization

An "AI Lab" page (`/ai`) visualizes what the model attends to and its belief over the
opponent's hidden cards. It's **off by default** (production = clean game operation) and
gated behind a flag:

```bash
ENABLE_REASONING=true python run.py     # serves the /ai Lab + reasoning SSE
```

With the flag off, the AI just plays — no reasoning extraction, no `/ai` route.

## API

Interactive docs at `/docs` (FastAPI). Key endpoints:

### Lobby — `/api/lobby`
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/new` | Create a PvP game |
| `POST` | `/new/vs-ai?use_model=true` | Create a vs-AI game (`false` = random agent) |
| `POST` | `/join` | Join an existing game |
| `GET`  | `/waiting` | List waiting games |

### Game — `/api/game`
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/draw` | Draw a card (choose color) |
| `POST` | `/place` | Place the drawn card |
| `POST` | `/guess` | Guess an opponent card |
| `POST` | `/decision` | Continue or stop after a correct guess |
| `POST` | `/state` | Get game state |
| `POST` | `/reasoning_ack` | Ack the AI-reasoning overlay (Lab only) |
| `GET`  | `/events` | **SSE** event stream (`?game_id=&player_id=`) |

**SSE events:** `game_start`, `my_action`, `opponent_action`, `turn_change`, `deck_update`,
`game_over` (+ `ai_reasoning` when the Lab is enabled).

### Pages
| Path | Description |
|------|-------------|
| `GET /` | Web game client |
| `GET /ai` | AI Lab (only when `ENABLE_REASONING=true`) |
| `GET /static/*` | Static assets |

## Configuration

Override via environment or a `.env` file (`app/core/config.py`):

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `0.0.0.0` | Bind host |
| `PORT` | `6000` | Bind port |
| `CHECKPOINT_PATH` | `checkpoints/model.pt` | Model checkpoint path |
| `ENABLE_REASONING` | `false` | Enable the `/ai` Lab + reasoning SSE |

## Project structure

```
run.py                 Server entry point (uvicorn)
app/
  main.py              FastAPI app (routers, middleware, lifespan)
  core/                config.py · model_loader.py · exceptions.py
  api/                 lobby.py · game.py · sse.py
  services/            game_service · game_manager · game_session · game_engine · player
  schemas/             request/response · emitters/ (SSE) · results/ · observation
  game/                model.py (policy net) · deck · hand · constants · cards/
static/                index.html · game.js · style.css · ai_game.{html,css,js}
docs/                  Static in-browser ONNX demo (index.html · engine.js · model.onnx) → Pages
scripts/               export_onnx.py · publish_model.sh · ci_smoke.py
```

## License

[MIT](LICENSE)
