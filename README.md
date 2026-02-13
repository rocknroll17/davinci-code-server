# Da Vinci Code Game Server

An online game server for the Da Vinci Code board game.  
Built with **FastAPI** + **SSE (Server-Sent Events)** for real-time game event streaming.  
Supports AI opponents powered by a trained RL model.

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

## License

MIT License
