# Da Vinci Code Game Server

[![CI](https://github.com/rocknroll17/davinci-code-server/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/rocknroll17/davinci-code-server/actions/workflows/ci.yml)
[![CodeQL](https://github.com/rocknroll17/davinci-code-server/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/rocknroll17/davinci-code-server/actions/workflows/codeql.yml)
[![Release](https://github.com/rocknroll17/davinci-code-server/actions/workflows/release.yml/badge.svg)](https://github.com/rocknroll17/davinci-code-server/actions/workflows/release.yml)
[![GHCR](https://img.shields.io/badge/ghcr.io-davinci--code--server-2ea44f?logo=docker&logoColor=white)](https://github.com/rocknroll17/davinci-code-server/pkgs/container/davinci-code-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An online game server for the Da Vinci Code board game.  
Built with **FastAPI** + **SSE (Server-Sent Events)** for real-time game event streaming.  
Supports AI opponents powered by a trained RL model.

### Try it

- **[Play vs the AI in your browser →](https://rocknroll17.github.io/davinci-code-server/)**
  The trained policy net runs 100% client-side (ONNX + onnxruntime-web) — no backend.
  Source in [`docs/`](docs/); re-export the model with [`scripts/export_onnx.py`](scripts/export_onnx.py).

## Features

- PvP online matches (2 players)
- AI matches (trained model or random agent)
- Real-time game events via SSE
- Web frontend included

## Project Structure

```
server/
├── run.py                  # Server entry point
├── requirements.txt        # Server dependencies
├── checkpoints/
│   └── model.pt            # AI model checkpoint
├── app/
│   ├── main.py             # FastAPI app setup (routers, middleware, lifespan)
│   ├── core/
│   │   ├── config.py       # Settings (pydantic-settings)
│   │   ├── model_loader.py # AI model loader
│   │   └── exceptions.py   # Exception definitions
│   ├── api/
│   │   ├── lobby.py        # Lobby API (create/join games)
│   │   ├── game.py         # Game action API (draw/place/guess/decision)
│   │   └── sse.py          # SSE event stream
│   ├── services/
│   │   ├── game_service.py # Service facade
│   │   ├── game_manager.py # Game session manager (singleton)
│   │   ├── game_session.py # Individual game session
│   │   ├── game_engine.py  # Game logic engine
│   │   ├── game_state.py   # Game state management
│   │   └── player.py       # Player (Human/AI)
│   ├── schemas/
│   │   ├── request.py      # Request models
│   │   ├── response.py     # Response models
│   │   ├── game.py         # Game schemas
│   │   ├── cards.py        # Card schemas
│   │   ├── observation.py  # Observation schemas
│   │   ├── emitters/       # SSE event schemas
│   │   └── results/        # Action result schemas
│   └── game/
│       ├── constants.py    # Game constants
│       ├── deck.py         # Deck management
│       ├── hand.py         # Hand management
│       ├── model.py        # AI model definition
│       └── cards/          # Card classes (Card, BlackCard, WhiteCard)
└── static/
    ├── index.html          # Web frontend
    ├── game.js             # Game client JS
    └── style.css           # Styles
```

## Setup

### 1. Create and activate virtual environment
```bash
python3.10 -m venv venv
source venv/bin/activate
```

### 2. Install dependencies
```bash
pip install -r requirements.txt
```

### 3. Place model checkpoint
Place the trained model file at `checkpoints/best_model.pt`.

### 4. Run server
```bash
python run.py
```

The server starts at `http://0.0.0.0:6000`.

### Environment Variables (optional)
Override settings via `.env` file:
```env
HOST=0.0.0.0
PORT=6000
CHECKPOINT_PATH=checkpoints/best_model.pt
```

## API Endpoints

### Lobby (`/api/lobby`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/lobby/new` | Create a new PvP game |
| `POST` | `/api/lobby/new/vs-ai` | Create an AI game (`?use_model=true`) |
| `POST` | `/api/lobby/join` | Join an existing game |
| `GET` | `/api/lobby/waiting` | List waiting games |

### Game Actions (`/api/game`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/game/draw` | Draw a card (choose color) |
| `POST` | `/api/game/place` | Place drawn card in hand |
| `POST` | `/api/game/guess` | Guess opponent's card |
| `POST` | `/api/game/decision` | Continue or stop after correct guess |
| `POST` | `/api/game/state` | Get game state |

### SSE Events (`/api/game`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/game/events` | Real-time event stream (`?game_id=&player_id=`) |

**Event types**: `game_start`, `draw`, `place`, `guess`, `decision`, `turn_change`, `game_over`

### Static Files

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Web frontend |
| `GET` | `/static/*` | Static files (JS, CSS) |

## Architecture

```
Client (Browser)
  ├── REST API → Router → GameService → GameManager → GameSession → GameEngine
  └── SSE ←── SSE Router ←── GameSession (listener queue)
```

- **Router**: Request validation and routing
- **Service**: Business logic facade
- **Manager**: Multi-session management (1h TTL, 5min cleanup cycle)
- **Session**: Individual game + players + SSE listener management
- **Engine**: Pure game logic (deck, hand, phases)
- **Game**: Domain models (cards, constants, AI model)

## Docker

A prebuilt image is published to GitHub Container Registry on every release, with
**the model baked in** — so deploy is just pull-and-run, no mount, no separate download.

### Where the model lives

The model is **not** in git. It is versioned independently as a **GHCR OCI artifact**
(the source of truth), since it changes on its own cadence (retraining):

```
ghcr.io/rocknroll17/davinci-model:<version>   (+ :latest)
```

The release build (`.github/workflows/release.yml`) pulls this artifact with
[ORAS](https://oras.land/) and bakes `model.pt` into the server image. Publish a new
model with [`scripts/publish_model.sh`](scripts/publish_model.sh):

```bash
echo "$GHCR_TOKEN" | oras login ghcr.io -u <user> --password-stdin   # needs write:packages
scripts/publish_model.sh checkpoints/model.pt 0.3.0                  # pushes :0.3.0 and :latest
```

Pin which model version a build bakes with the repo variable `MODEL_TAG` (default `latest`).

### Pull and run

```bash
docker pull ghcr.io/rocknroll17/davinci-code-server:latest

# Host port is configurable; the container always listens on 6000.
PORT="${PORT:-6000}"          # pick any free host port, e.g. PORT=8080
docker run -d --gpus all \
    --name davinci-server \
    --restart unless-stopped \
    -p "${PORT}:6000" \
    ghcr.io/rocknroll17/davinci-code-server:latest
```

Then open `http://localhost:${PORT}`. The container port stays 6000; only the host
side of `-p` changes — so it never collides with other services. `--gpus all` runs
inference on the GPU (requires the
[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html));
drop the flag to fall back to CPU.

### Build locally

The Dockerfile bakes `checkpoints/model.pt`, so pull the model artifact first:

```bash
oras pull ghcr.io/rocknroll17/davinci-model:latest -o checkpoints
docker build -t davinci-server .
docker run -d --gpus all -p "${PORT:-6000}:6000" davinci-server
```

## License

MIT License
