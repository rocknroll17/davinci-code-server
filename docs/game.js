/**
 * Da Vinci Code Game - browser demo
 *
 * Single-player, fully client-side. The UI (rendering, animations, DOM bindings,
 * event-handler bodies) follows the server-served client. The layer replaced is
 * the data layer:
 *   - apiCall('/api/...') -> local engine calls returning the SAME JSON shapes
 *   - connectSSE()/EventSource -> an in-page event dispatcher firing the SAME
 *     event names with the SAME payload fields (driven by engine.js orchestration)
 */

// ============== State ==============

let gameState = null;
let gameId = null;
let playerId = null;
let isLoading = false;
let pendingCard = null;
let selectedGuessPosition = null;
let eventSource = null;
let preShuffledDeck = null;
let messageLockUntil = 0;

// ============== DOM Elements ==============

const elements = {
    startScreen:      document.getElementById('start-screen'),
    lobbyScreen:      document.getElementById('lobby-screen'),
    gameScreen:       document.getElementById('game-screen'),
    createGameBtn:    document.getElementById('create-game-btn'),
    joinGameBtn:      document.getElementById('join-game-btn'),
    gameIdInput:      document.getElementById('game-id-input'),
    waitingMessage:   document.getElementById('waiting-message'),
    waitingGameId:    document.getElementById('waiting-game-id'),
    cancelWaitBtn:    document.getElementById('cancel-wait-btn'),
    phase:            document.getElementById('phase'),
    message:          document.getElementById('message'),
    playerHand:       document.getElementById('player-hand'),
    opponentHand:     document.getElementById('opponent-hand'),
    actionArea:       document.getElementById('action-area'),
    drawAction:       document.getElementById('draw-action'),
    placeAction:      document.getElementById('place-action'),
    placeSlots:       document.getElementById('place-slots'),
    guessAction:      document.getElementById('guess-action'),
    decisionAction:   document.getElementById('decision-action'),
    waitingTurn:      document.getElementById('waiting-turn'),
    deckCards:        document.getElementById('deck-cards'),
    guessValue:       document.getElementById('guess-value'),
    guessBtn:         document.getElementById('guess-btn'),
    decisionContinue: document.getElementById('decision-continue'),
    decisionStop:     document.getElementById('decision-stop'),
    gameOverOverlay:  document.getElementById('game-over-overlay'),
    gameOverTitle:    document.getElementById('game-over-title'),
    gameOverMessage:  document.getElementById('game-over-message'),
    newGameBtn:       document.getElementById('new-game-btn')
};

// ============== Local Engine / Session (replaces the HTTP backend) ==============
//
// LocalSession mirrors app/services/game_session.py + game_service.py + the
// action handlers + emitters. It drives the SAME SSE event names/payloads through
// `localBus` (an EventTarget) so the unchanged SSE handler bodies below run as-is.

const DV = window.DVEngine;
const t = window.I18N.t;
// Fresh EventTarget per game (re-created in connectSSE) so a "새 게임" restart
// doesn't accumulate duplicate handlers — matching the original fresh-EventSource.
let localBus = new EventTarget();

function emitEvent(eventName, dataObj) {
    // mimics SSE: handlers read JSON.parse(e.data)
    localBus.dispatchEvent(new MessageEvent(eventName, { data: JSON.stringify(dataObj) }));
}

let session = null;  // current LocalSession

class LocalSession {
    constructor(useModel) {
        this.useModel = useModel;
        this.message = t('waitingPlayers');
        // human = players[0] (first), ai = players[1]
        this.human = DV.makeHumanPlayer('human');
        this.ai = DV.makeAIPlayer('ai', useModel);
        this.human.player_index = 0;
        this.ai.player_index = 1;
        this.engine = DV.makeEngine([this.human, this.ai], 'local');
        this.gameId = 'local';
        this.playerId = this.human.id;
    }

    start() {
        DV.engineSetup(this.engine);
        this.message = t('drawPrompt');
        // game_start (emit_to_all) — fired after a tick like the server
        emitEvent('game_start', { message: t('gameStarted'), current_player: 0 });
    }

    // ===== _build_state (game_session.py) for the human player =====
    buildState(forActor = false) {
        const e = this.engine;
        const player = this.human;
        const myHandRaw = player.hand;
        const oppHandRaw = DV.handToOpponentView(this.ai.hand);
        const myLast = myHandRaw.last_drawn_card;
        const oppLast = oppHandRaw.last_drawn_card;
        const myTurn = e.current_player.id === player.id;

        const my_hand = [];
        for (let i = 0; i < myHandRaw.length; i++) {
            const c = myHandRaw[i];
            my_hand.push({
                position: i,
                color: c.color,
                value: c.value,
                revealed: c.is_revealed,
                is_last_drawn: (c === myLast) && (myTurn || c.is_revealed),
            });
        }
        const opponent_hand = [];
        for (let i = 0; i < oppHandRaw.length; i++) {
            const c = oppHandRaw[i];
            opponent_hand.push({
                position: i,
                color: c.color,
                value: c.value,
                revealed: c.is_revealed,
                is_last_drawn: (c === oppLast),
            });
        }

        let pending = null;
        if (e.pending_card && e.current_player.id === player.id) {
            pending = {
                color: e.pending_card.color,
                value: e.pending_card.value,
                valid_positions: e.pending_card.valid_positions,
            };
        }

        let message;
        if (e.game_over) {
            message = (e.winner && e.winner.id === player.id)
                ? t('winMsg')
                : t('loseMsg');
        } else if (forActor) {
            message = this.message;
        } else if (myTurn) {
            message = this.message;
        } else {
            message = t('waitOpponent');
        }

        return {
            game_id: this.gameId,
            phase: DV.PhaseName[e.phase],
            current_player: e.current_player.id,
            is_my_turn: myTurn,
            game_over: e.game_over,
            winner: e.winner ? e.winner.player_index : null,
            me: { id: player.id, connected: true, index: 0 },
            opponent: { id: this.ai.id, connected: true, index: 1 },
            my_hand,
            opponent_hand,
            deck_black: DV.deckBlackCount(e.deck),
            deck_white: DV.deckWhiteCount(e.deck),
            pending_card: pending,
            message,
        };
    }

    // ===== Human action handlers (actions/*.py + emitters/*.py) =====

    humanDraw(color) {
        const e = this.engine;
        const result = DV.engineDraw(e, this.human.id, color);
        const valid = result.pending_card.valid_positions;
        this.message = (valid.length !== 1)
            ? t('choosePlace', { n: valid.length })
            : t('autoPlace');
        const state = this.buildState(true);
        // DrawEmitter: my_action only
        emitEvent('my_action', {
            action: 'draw',
            card: {
                color: result.pending_card.color,
                value: result.pending_card.value,
                valid_positions: result.pending_card.valid_positions,
            },
            message: this.message,
            state,
        });
        return { success: true, card: { color: result.pending_card.color, value: result.pending_card.value, valid_positions: result.pending_card.valid_positions } };
    }

    humanPlace(color, number, position) {
        const e = this.engine;
        const result = DV.enginePlace(e, this.human.id, color, number, position);
        this.message = t('guessPrompt');
        const state = this.buildState(true);
        // PlaceEmitter: my_action (actor)
        emitEvent('my_action', {
            action: 'place',
            position: result.position,
            message: this.message,
            state,
        });
        return { success: true, placed_position: result.position };
    }

    humanGuess(position, value) {
        const e = this.engine;
        const result = DV.engineGuess(e, this.human.id, position, value);
        if (result.is_correct) {
            this.message = e.game_over
                ? t('correctWinEnd')
                : t('correctContinue');
        } else {
            this.message = e.game_over
                ? t('wrongGameOver')
                : t('wrongOppTurn');
        }
        const state = this.buildState(true);

        // GuessEmitter actor_data
        const actorData = {
            action: 'guess',
            position: result.position,
            value: value,
            correct: result.is_correct,
            message: this.message,
            state,
        };
        if (!result.is_correct && result.revealed_position >= 0) {
            // revealed card belongs to the human (their drawn card got flipped)
            const card = this.human.hand[result.revealed_position];
            actorData.revealed_card = {
                position: result.revealed_position,
                color: card.color,
                value: card.value,
                revealed: card.is_revealed,
            };
        }
        emitEvent('my_action', actorData);

        // post_process: game over (2s) or turn change (2s)
        if (e.game_over) {
            const winnerId = e.winner.id;
            setTimeout(() => {
                if (winnerId === this.human.id) {
                    emitEvent('game_over', { winner: e.winner.player_index, message: t('winMsg') });
                } else {
                    emitEvent('game_over', { winner: e.winner.player_index, message: t('loseRetry') });
                }
            }, 2000);
        } else if (!result.is_correct) {
            // Wrong guess ends the human's turn (engine already switched to AI).
            // Server: turn_change goes to the new-turn player (AI, no UI listener),
            // and a background task runs the AI turn after ~2s; execute_ai_turn then
            // sleeps another 2s before the first AI action. We trigger the AI turn here.
            setTimeout(() => { this.maybeRunAI(0); }, 2000);
        }
        return { success: true };
    }

    humanDecision(continueGuessing) {
        const e = this.engine;
        DV.engineDecision(e, this.human.id, continueGuessing);
        this.message = continueGuessing ? t('keepGuessing') : t('turnEnded');
        const state = this.buildState(true);
        emitEvent('my_action', {
            action: 'decision',
            continue: continueGuessing,
            message: this.message,
            state,
        });
        if (!continueGuessing) {
            setTimeout(() => { this.maybeRunAI(0); }, 0);
        }
        return { success: true };
    }


    // ===== AI turn orchestration (game_service.py execute_ai_turn) =====
    async maybeRunAI(initialSleep = 0) {
        const e = this.engine;
        if (!e.is_started || e.game_over) return;
        let current = e.current_player;
        if (!DV.isAI(current)) return;
        await this.executeAITurn();
    }

    async executeAITurn() {
        const e = this.engine;
        let current = e.current_player;
        while (!e.game_over && DV.isAI(current)) {
            await sleep(2000);
            await this.executeSingleAIAction(current);
            const next = e.current_player;
            if (next !== current) {
                if (next && DV.isAI(next)) current = next;
                else break;
            }
            await sleep(300);
        }
    }

    async executeSingleAIAction(ai) {
        const e = this.engine;
        if (e.phase === DV.Phase.DRAW) {
            // draw_action: argmax color via model, validated
            const action = await DV.getAction(e, ai.id);
            let color = action.color;
            if (color === 0 && DV.deckBlackCount(e.deck) > 0) color = 0;
            else if (color === 1 && DV.deckWhiteCount(e.deck) > 0) color = 1;
            else color = DV.deckBlackCount(e.deck) > 0 ? 0 : 1;
            DV.engineDraw(e, ai.id, color);
            // place_action: single valid pos -> that; else random
            const pending = e.pending_card;
            const valid = pending.valid_positions;
            const position = valid.length === 1 ? valid[0] : valid[Math.floor(Math.random() * valid.length)];
            const placeResult = DV.enginePlace(e, ai.id, color, pending.value, position);
            // PlaceEmitter.emit_to_opponent_only -> opponent_action (place)
            const colorName = color === 0 ? t('black') : t('white');
            emitEvent('opponent_action', {
                action: 'place',
                color: placeResult.placed_card.color,
                position: placeResult.position,
                message: t('oppPlaced', { color: colorName, pos: placeResult.position }),
            });
        } else if (e.phase === DV.Phase.GUESS) {
            await this.aiGuess(ai);
        } else if (e.phase === DV.Phase.DECISION) {
            const action = await DV.getAction(e, ai.id);
            const continueGuessing = action.decision === 1;
            DV.engineDecision(e, ai.id, continueGuessing);
            const msg = continueGuessing ? t('oppContinues') : t('oppEndedTurn');
            // DecisionEmitter.emit_to_opponent_only -> opponent_action (decision)
            emitEvent('opponent_action', { action: 'decision', continue: continueGuessing, message: msg });
            if (!continueGuessing) {
                const deckEmpty = DV.deckIsEmpty(e.deck);
                setTimeout(() => {
                    emitEvent('turn_change', {
                        your_turn: true,
                        message: deckEmpty ? t('yourTurnGuess') : t('yourTurnDraw'),
                    });
                }, 2000);
            }
        }
    }

    async aiGuess(ai) {
        const e = this.engine;
        const action = await DV.getAction(e, ai.id);
        let position = action.position, value = action.value;

        // guess_action validity check + first-hidden fallback
        const oppHand = DV.handToOpponentView(this.human.hand);
        if (!(oppHand && position < oppHand.length && !oppHand[position].is_revealed)) {
            let fixed = null;
            for (let i = 0; i < oppHand.length; i++) {
                if (!oppHand[i].is_revealed) { fixed = i; break; }
            }
            if (fixed !== null) position = fixed;
            else { position = 0; value = 0; }
        }

        // Brief "thinking" pause, then guess.
        await new Promise((resolve) => setTimeout(resolve, 800));

        const result = DV.engineGuess(e, ai.id, position, value);
        const valueStr = value === 12 ? t('joker') : String(value);

        // GuessEmitter opponent_data (AI is actor -> human gets opponent_action)
        const oppData = {
            action: 'guess',
            position: result.position,
            value: value,
            correct: result.is_correct,
            message: t('oppGuessed', { pos: result.position, val: valueStr }),
        };
        if (result.is_correct && result.card) {
            oppData.revealed_position = result.position;
            oppData.revealed_value = result.card.value;
        }
        if (!result.is_correct && result.revealed_position >= 0) {
            oppData.revealed_position = result.revealed_position;
            oppData.revealed_value = result.card ? result.card.value : null;
        }
        emitEvent('opponent_action', oppData);

        // post_process
        if (e.game_over) {
            const winnerId = e.winner.id;
            setTimeout(() => {
                if (winnerId === ai.id) {
                    // AI won -> loser (human) gets defeat
                    emitEvent('game_over', { winner: e.winner.player_index, message: t('loseRetry') });
                } else {
                    // AI lost -> human gets victory
                    emitEvent('game_over', { winner: e.winner.player_index, message: t('winMsg') });
                }
            }, 2000);
        } else if (!result.is_correct) {
            const deckEmpty = DV.deckIsEmpty(e.deck);
            setTimeout(() => {
                emitEvent('turn_change', {
                    your_turn: true,
                    message: deckEmpty ? t('yourTurnGuess') : t('yourTurnDraw'),
                });
            }, 2000);
        }
    }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============== API Functions ==============
//
// apiCall now dispatches to the LocalSession instead of fetch(). It returns the
// SAME JSON shapes the FastAPI endpoints returned, so callers are unchanged.

async function apiCall(endpoint, method = 'GET', body = null) {
    if (isLoading) return null;
    isLoading = true;
    setLoadingState(true);
    try {
        return await localApi(endpoint, method, body);
    } catch (error) {
        console.error('API Error:', error);
        showMessage(`⚠️ ${error.message}`);
        throw error;
    } finally {
        isLoading = false;
        setLoadingState(false);
    }
}

async function localApi(endpoint, method, body) {
    // strip query string
    const [path, query] = endpoint.split('?');

    if (path === '/api/lobby/new/vs-ai') {
        const params = new URLSearchParams(query || '');
        const useModel = params.get('use_model') !== 'false';
        session = new LocalSession(useModel);
        const res = { game_id: session.gameId, player_id: session.playerId };
        // start after returning (server starts game on add_ai_player; game_start fires async)
        setTimeout(() => session.start(), 0);
        return res;
    }
    if (path === '/api/lobby/new') {
        // PvP create — single-player build has no PvP; no-op stub.
        return { game_id: 'pvp-disabled', player_id: 'pvp-disabled' };
    }
    if (path === '/api/lobby/join') {
        throw new Error(t('pvpUnsupported'));
    }
    if (path === '/api/game/state') {
        if (!session) throw new Error(t('noGame'));
        return session.buildState(false);
    }
    if (path === '/api/game/draw') {
        return session.humanDraw(body.color);
    }
    if (path === '/api/game/place') {
        return session.humanPlace(body.color, body.number, body.position);
    }
    if (path === '/api/game/guess') {
        const res = session.humanGuess(body.position, body.value);
        // server triggers AI bg task on every guess (2s); correct guesses keep human's turn
        return res;
    }
    if (path === '/api/game/decision') {
        return session.humanDecision(body.continue_guessing);
    }
    throw new Error(`Unknown endpoint: ${path}`);
}

function setLoadingState(loading) {
    document.querySelectorAll('button').forEach(btn => {
        if (loading) {
            btn.dataset.wasDisabled = btn.disabled;
            btn.disabled = true;
        } else {
            if (btn.dataset.wasDisabled !== 'true') btn.disabled = false;
            delete btn.dataset.wasDisabled;
        }
    });
}

// ============== SSE ==============
//
// connectSSE attaches the server client's handlers to the in-page localBus.

function connectSSE() {
    if (!gameId || !playerId) return;
    if (eventSource) eventSource.close?.();

    localBus = new EventTarget();   // fresh bus → no duplicate handlers on restart
    eventSource = localBus;

    eventSource.addEventListener('connected', (e) => {
        console.log('SSE connected:', JSON.parse(e.data));
    });

    eventSource.addEventListener('game_start', (e) => {
        const data = JSON.parse(e.data);
        showMessage('🎮 ' + data.message);
        refreshState();
    });

    eventSource.addEventListener('opponent_action', (e) => {
        const data = JSON.parse(e.data);
        console.log('Opponent action:', data);

        if (data && data.action === 'guess') {
            const position = data.position;

            showMessage(`🎭 ${data.message}`, 2000);

            if (data.correct) {
                highlightMyCard(position, 'guessed-correct');
                flipMyCard(position);
                setTimeout(() => {
                    removeMyCardHighlight(position);
                    fetchAndUpdateHands();
                }, 2000);
            } else {
                shakeMyCard(position);
                if (data.revealed_position !== undefined && data.revealed_position >= 0) {
                    setTimeout(() => { flipOpponentCard(data.revealed_position, data.revealed_value); }, 500);
                }
                setTimeout(async () => { await refreshState(false, false); }, 2000);
            }
        } else if (data && data.action === 'place') {
            showMessage(`🎭 ${data.message}`);
            refreshState(true, false);
        } else if (data && data.action === 'decision') {
            showMessage(`🎭 ${data.message}`);
        } else {
            showMessage(`🎭 ${data.message}`);
            setTimeout(() => refreshState(), 500);
        }
    });

    eventSource.addEventListener('deck_update', (e) => {
        const data = JSON.parse(e.data);
        refreshState().then(() => {
            if (!gameState) return;
            const black = gameState.deck_black || 0;
            const white = gameState.deck_white || 0;
            preShuffledDeck = preparePreShuffledDeck(black, white);
        }).catch(err => console.error('Failed refresh on deck_update:', err));
    });

    eventSource.addEventListener('turn_change', (e) => {
        const data = JSON.parse(e.data);
        const remainingLock = messageLockUntil - Date.now();
        if (remainingLock > 0) {
            setTimeout(() => { showMessage(data.message); refreshState(true, false); }, remainingLock + 100);
        } else {
            showMessage(data.message);
            refreshState(true, false);
        }
    });

    eventSource.addEventListener('game_over', (e) => {
        showGameOverWithData(JSON.parse(e.data));
    });

    eventSource.addEventListener('player_disconnected', (e) => {
        showDisconnectOverlay(JSON.parse(e.data).message);
    });

    eventSource.addEventListener('heartbeat', (e) => {
        console.log('Heartbeat');
    });

    eventSource.addEventListener('my_action', (e) => {
        const data = JSON.parse(e.data);
        if (data.state) gameState = data.state;

        if (data.action === 'draw') {
            pendingCard = data.card;
            preShuffledDeck = null;
            if (pendingCard && pendingCard.valid_positions && pendingCard.valid_positions.length === 1) {
                setTimeout(() => { place(pendingCard.valid_positions[0]); }, 50);
            } else {
                showMessage(data.message);
                updateUI();
            }
        } else if (data.action === 'place') {
            pendingCard = null;
            preShuffledDeck = null;
            showMessage(data.message);
            updateUI();
        } else if (data.action === 'guess') {
            selectedGuessPosition = null;
            const position = data.position;
            if (data.correct) {
                showMessage(t('correctShort'));
                highlightOpponentCard(position, 'guessed-correct');
                flipOpponentCard(position, data.value);
            } else {
                showMessage(t('wrongShort'));
                shakeOpponentCard(position);
                if (data.revealed_card) {
                    setTimeout(() => { flipMyCard(data.revealed_card.position); }, 500);
                }
            }
            setTimeout(() => {
                removeOpponentCardHighlight(position);
                updateUI(true, false);
                if (elements.guessBtn) elements.guessBtn.disabled = false;
            }, 2000);
        } else if (data.action === 'decision') {
            showMessage(data.message);
            updateUI();
        }
    });

    eventSource.addEventListener('state_update', () => refreshState());

    eventSource.addEventListener('error', (e) => {
        console.error('SSE error:', e);
    });
}

function disconnectSSE() {
    if (eventSource) { eventSource = null; }
}

// ============== Game Management ==============

async function createGame() {
    try {
        const result = await apiCall('/api/lobby/new', 'POST');
        if (result) {
            gameId = result.game_id;
            playerId = result.player_id;
            connectSSE();
            showLobbyScreen();
            if (elements.waitingGameId) elements.waitingGameId.textContent = gameId;
        }
    } catch (e) { console.error('Failed to create game:', e); }
}

async function createAIGame(useModel = true) {
    try {
        const result = await apiCall(`/api/lobby/new/vs-ai?use_model=${useModel}`, 'POST');
        if (result) {
            gameId = result.game_id;
            playerId = result.player_id;
            connectSSE();
            await refreshState();
            showGameScreen();
        }
    } catch (e) { console.error('Failed to create AI game:', e); }
}

async function joinGame() {
    const inputGameId = elements.gameIdInput?.value?.trim();
    if (!inputGameId) { showMessage(t('enterGameId')); return; }
    try {
        const result = await apiCall('/api/lobby/join', 'POST', { game_id: inputGameId });
        if (result) {
            gameId = result.game_id;
            playerId = result.player_id;
            connectSSE();
            await refreshState();
            showGameScreen();
        }
    } catch (e) { console.error('Failed to join game:', e); }
}

async function refreshState(preserveMessage = false, updateActionAfter = false) {
    if (!gameId || !playerId) return;
    try {
        const result = await apiCall('/api/game/state', 'POST', { game_id: gameId, player_id: playerId });
        if (result) {
            gameState = result;
            if (gameState.phase === 'waiting') {
                showLobbyScreen();
            } else {
                showGameScreen();
                updateUI(preserveMessage, updateActionAfter);
            }
        }
    } catch (e) { console.error('Failed to refresh state:', e); }
}

// ============== Game Actions ==============

async function draw(color) {
    if (!gameState || !gameId || !playerId || isLoading) return;
    try {
        await apiCall('/api/game/draw', 'POST', { game_id: gameId, player_id: playerId, color });
    } catch (e) { console.error('Draw failed:', e); }
}

async function place(position) {
    if (!gameState || !gameId || !playerId || isLoading || !pendingCard) return;
    try {
        await apiCall('/api/game/place', 'POST', {
            game_id: gameId, player_id: playerId,
            color: pendingCard.color, number: pendingCard.value, position
        });
    } catch (e) { console.error('Place failed:', e); }
}

async function guess() {
    if (!gameState || !gameId || !playerId || isLoading) return;
    const position = selectedGuessPosition;
    const value = parseInt(elements.guessValue.value);
    if (position === null || isNaN(value)) { showMessage(t('selectCardValue')); return; }
    if (elements.guessBtn) elements.guessBtn.disabled = true;
    try {
        const result = await apiCall('/api/game/guess', 'POST', { game_id: gameId, player_id: playerId, position, value });
        if (!result || !result.success) {
            if (elements.guessBtn) elements.guessBtn.disabled = false;
        }
    } catch (e) {
        console.error('Guess failed:', e);
        if (elements.guessBtn) elements.guessBtn.disabled = false;
    }
}

async function makeDecision(continueGuessing) {
    if (!gameState || !gameId || !playerId || isLoading) return;
    try {
        await apiCall('/api/game/decision', 'POST', { game_id: gameId, player_id: playerId, continue_guessing: continueGuessing });
    } catch (e) { console.error('Decision failed:', e); }
}

// ============== UI Functions ==============

function showStartScreen() {
    elements.startScreen?.classList.remove('hidden');
    elements.lobbyScreen?.classList.add('hidden');
    elements.gameScreen?.classList.add('hidden');
    elements.gameOverOverlay?.classList.add('hidden');
    disconnectSSE();
    gameState = null; gameId = null; playerId = null;
}

function showLobbyScreen() {
    elements.startScreen?.classList.add('hidden');
    elements.lobbyScreen?.classList.remove('hidden');
    elements.gameScreen?.classList.add('hidden');
}

function showGameScreen() {
    elements.startScreen?.classList.add('hidden');
    elements.lobbyScreen?.classList.add('hidden');
    elements.gameScreen?.classList.remove('hidden');
}

function showMessage(msg, lockMs = 0) {
    if (!elements.message) return;
    if (Date.now() < messageLockUntil) { console.log('Message locked:', msg); return; }
    elements.message.innerHTML = msg;
    elements.message.parentElement?.classList.remove('flash');
    void elements.message.parentElement?.offsetWidth;
    elements.message.parentElement?.classList.add('flash');
    if (lockMs > 0) messageLockUntil = Date.now() + lockMs;
}

function updateUI(preserveMessage = false, updateActionAfter = false) {
    if (!gameState) return;
    if (elements.phase) elements.phase.textContent = translatePhase(gameState.phase);
    if (!preserveMessage && gameState.message) showMessage(gameState.message);
    renderHand(elements.playerHand, gameState.my_hand, false);
    renderHand(elements.opponentHand, gameState.opponent_hand, true);
    if (!updateActionAfter) updateActionPanel();
    if (gameState.game_over && elements.gameOverOverlay?.classList.contains('hidden')) showGameOver();
}

async function fetchState() {
    if (!gameId || !playerId) return null;
    try {
        const result = await apiCall('/api/game/state', 'POST', { game_id: gameId, player_id: playerId });
        if (result) { gameState = result; return result; }
    } catch (e) { console.error('Failed to fetch state:', e); }
    return null;
}

function updateHands() {
    if (!gameState) return;
    renderHand(elements.playerHand, gameState.my_hand, false);
    renderHand(elements.opponentHand, gameState.opponent_hand, true);
}

async function fetchAndUpdateHands() {
    const state = await fetchState();
    if (state) updateHands();
    return state;
}

function updatePhaseDisplay() {
    if (!gameState || !elements.phase) return;
    elements.phase.textContent = translatePhase(gameState.phase);
}

function updateDeck() { if (gameState) renderDeckCards(); }

async function fetchAndUpdateDeck() {
    const state = await fetchState();
    if (state) updateDeck();
    return state;
}

function updateHandsAndActions() {
    if (!gameState) return;
    updateHands();
    updateActionPanel();
}

async function fetchAndUpdateHandsAndActions() {
    const state = await fetchState();
    if (state) updateHandsAndActions();
    return state;
}

function updateHeader() {
    if (!gameState) return;
    updatePhaseDisplay();
    if (gameState.message) showMessage(gameState.message);
}

function revealOpponentCard(position, value) {
    const card = elements.opponentHand?.querySelector(`[data-position="${position}"]`);
    if (card) {
        card.classList.add('revealed', 'newly-revealed');
        const valueSpan = card.querySelector('.value');
        if (valueSpan) valueSpan.textContent = value === 12 ? '-' : value;
    }
}

function revealMyCard(position) {
    const card = elements.playerHand?.querySelector(`[data-position="${position}"]`);
    if (card) card.classList.add('revealed', 'newly-revealed');
}

function translatePhase(phase) {
    const map = { waiting: t('phaseWaiting'), draw: t('phaseDraw'), guess: t('phaseGuess'), decision: t('phaseDecision'), place: t('phasePlace') };
    return map[phase] || phase;
}

function renderHand(container, cards, isOpponent) {
    if (!container || !cards) return;
    container.innerHTML = '';
    cards.forEach(card => {
        const el = document.createElement('div');
        el.className = 'card';
        el.dataset.position = card.position;
        el.classList.add(card.color === 0 ? 'card-black' : 'card-white');
        if (card.revealed) el.classList.add('revealed');
        if (card.is_last_drawn) {
            el.classList.add('drawn-card');
            if (card.revealed) el.classList.add('newly-revealed');
        }
        const valueText = card.value === -1 ? '?' : (card.value === 12 ? '-' : card.value);
        el.innerHTML = `<span class="position">${card.position}</span><span class="value">${valueText}</span>`;
        if (isOpponent && gameState.phase === 'guess' && gameState.is_my_turn && !card.revealed) {
            el.classList.add('clickable');
            el.addEventListener('click', () => selectOpponentCard(card.position));
        }
        container.appendChild(el);
    });
}

function selectOpponentCard(position) {
    elements.opponentHand?.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
    elements.opponentHand?.querySelector(`[data-position="${position}"]`)?.classList.add('selected');
    selectedGuessPosition = position;
}

function updateActionPanel() {
    elements.drawAction?.classList.add('hidden');
    elements.placeAction?.classList.add('hidden');
    elements.guessAction?.classList.add('hidden');
    elements.decisionAction?.classList.add('hidden');
    elements.waitingTurn?.classList.add('hidden');

    if (!gameState || gameState.game_over) { elements.actionArea?.classList.add('hidden'); return; }
    elements.actionArea?.classList.remove('hidden');

    if (pendingCard && pendingCard.valid_positions.length > 1) {
        elements.placeAction?.classList.remove('hidden');
        renderPlaceSlots();
        return;
    }

    if (!gameState.is_my_turn) { elements.waitingTurn?.classList.remove('hidden'); return; }

    if (gameState.phase === 'draw') {
        const totalDeck = (gameState.deck_black || 0) + (gameState.deck_white || 0);
        if (totalDeck === 0) {
            elements.guessAction?.classList.remove('hidden');
            updateGuessSelect();
        } else {
            elements.drawAction?.classList.remove('hidden');
            renderDeckCards();
        }
    } else if (gameState.phase === 'guess') {
        elements.guessAction?.classList.remove('hidden');
        updateGuessSelect();
    } else if (gameState.phase === 'decision') {
        elements.decisionAction?.classList.remove('hidden');
    }
}

function renderPlaceSlots() {
    if (!elements.placeSlots || !pendingCard) return;
    elements.placeSlots.innerHTML = '';
    const drawnCardPreview = document.createElement('div');
    drawnCardPreview.className = 'drawn-card-preview';
    drawnCardPreview.classList.add(pendingCard.color === 0 ? 'card-black' : 'card-white');
    drawnCardPreview.innerHTML = `<span class="label">${t('drawnCard')}</span><span class="value">${pendingCard.value === 12 ? '-' : pendingCard.value}</span>`;
    elements.placeSlots.appendChild(drawnCardPreview);
    const separator = document.createElement('div');
    separator.className = 'place-separator';
    separator.innerHTML = '→';
    elements.placeSlots.appendChild(separator);
    const positions = pendingCard.valid_positions;
    const hand = gameState.my_hand;
    for (let i = 0; i <= hand.length; i++) {
        if (positions.includes(i)) {
            const slot = document.createElement('div');
            slot.className = 'place-slot';
            slot.innerHTML = '<span>?</span>';
            slot.addEventListener('click', () => place(i));
            elements.placeSlots.appendChild(slot);
        }
        if (i < hand.length) {
            const card = hand[i];
            const cardEl = document.createElement('div');
            cardEl.className = 'place-preview-card';
            cardEl.classList.add(card.color === 0 ? 'card-black' : 'card-white');
            cardEl.innerHTML = `<span>${card.value === 12 ? '-' : card.value}</span>`;
            elements.placeSlots.appendChild(cardEl);
        }
    }
}

function renderDeckCards() {
    if (!elements.deckCards) return;
    elements.deckCards.innerHTML = '';
    const black = gameState.deck_black || 0;
    const white = gameState.deck_white || 0;
    const total = black + white;
    let cards;
    if (preShuffledDeck && preShuffledDeck.length === total) {
        cards = preShuffledDeck.slice();
    } else {
        cards = [];
        for (let i = 0; i < black; i++) cards.push(0);
        for (let i = 0; i < white; i++) cards.push(1);
        for (let i = cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cards[i], cards[j]] = [cards[j], cards[i]];
        }
        if (!preShuffledDeck) preShuffledDeck = cards.slice();
    }
    cards.forEach(color => {
        const el = document.createElement('div');
        el.className = 'deck-card';
        el.classList.add(color === 0 ? 'deck-card-black' : 'deck-card-white');
        el.innerHTML = '<span class="deck-card-back">?</span>';
        el.addEventListener('click', () => draw(color));
        el.style.transform = `rotate(${(Math.random() - 0.5) * 6}deg)`;
        elements.deckCards.appendChild(el);
    });
}

function preparePreShuffledDeck(black, white) {
    const arr = [];
    for (let i = 0; i < black; i++) arr.push(0);
    for (let i = 0; i < white; i++) arr.push(1);
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function updateGuessSelect() {
    if (!elements.guessValue) return;
    elements.guessValue.innerHTML = `<option value="">${t('selectNumber')}</option>`;
    for (let i = 0; i <= 12; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = i === 12 ? t('jokerOption') : i;
        elements.guessValue.appendChild(opt);
    }
}

function showGameOver() {
    elements.gameOverOverlay?.classList.remove('hidden');
    // winner is the player_index (0 = human) — language-independent, unlike
    // the old message-substring check which broke under i18n.
    if (gameState.winner === 0) {
        elements.gameOverTitle.textContent = t('victory');
        elements.gameOverTitle.style.color = '#4ecca3';
    } else {
        elements.gameOverTitle.textContent = t('defeat');
        elements.gameOverTitle.style.color = '#e94560';
    }
    elements.gameOverMessage.textContent = gameState.message || t('gameOverTitle');
}

function showGameOverWithData(data) {
    elements.gameOverOverlay?.classList.remove('hidden');
    if (data.winner === 0) {
        elements.gameOverTitle.textContent = t('victory');
        elements.gameOverTitle.style.color = '#4ecca3';
    } else {
        elements.gameOverTitle.textContent = t('defeat');
        elements.gameOverTitle.style.color = '#e94560';
    }
    elements.gameOverMessage.textContent = data.message || t('gameOverTitle');
    showMessage(data.message);
}

function showDisconnectOverlay(message) {
    if (eventSource) { eventSource = null; }
    elements.gameOverOverlay?.classList.remove('hidden');
    elements.gameOverTitle.textContent = t('oppLeftTitle');
    elements.gameOverTitle.style.color = '#ffc107';
    elements.gameOverMessage.textContent = message || t('oppLeftMsg');
    showMessage(message);
}

// ============== Event Listeners ==============

elements.createGameBtn?.addEventListener('click', createGame);
elements.joinGameBtn?.addEventListener('click', joinGame);
elements.cancelWaitBtn?.addEventListener('click', showStartScreen);
elements.guessBtn?.addEventListener('click', e => { e.preventDefault(); guess(); });
elements.decisionContinue?.addEventListener('click', e => { e.preventDefault(); makeDecision(true); });
elements.decisionStop?.addEventListener('click', e => { e.preventDefault(); makeDecision(false); });
elements.newGameBtn?.addEventListener('click', showStartScreen);

document.getElementById('play-vs-ai-btn')?.addEventListener('click', () => createAIGame(true));
document.getElementById('play-vs-random-btn')?.addEventListener('click', () => createAIGame(false));

elements.gameIdInput?.addEventListener('keypress', (e) => { if (e.key === 'Enter') joinGame(); });

// Re-render language-dependent dynamic UI when the user toggles KO/EN.
// Static text is handled by i18n.js; this covers the phase badge, guess
// dropdown, and action panels built from JS.
window.addEventListener('dvc:langchange', () => {
    // preserveMessage=false so the current game message (reset to the static
    // start prompt by applyI18n) is restored from gameState.
    if (gameState) updateUI(false, false);
});

// ============== Title Cards ==============

function initTitleCards() {
    const blackCard  = document.getElementById('title-card-black');
    const whiteCard  = document.getElementById('title-card-white');
    const blackValue = document.getElementById('black-card-value');
    const whiteValue = document.getElementById('white-card-value');
    if (!blackCard || !whiteCard) return;
    blackValue.textContent = Math.floor(Math.random() * 12);
    whiteValue.textContent = Math.floor(Math.random() * 12);
    blackCard.addEventListener('click', () => blackCard.classList.toggle('flipped'));
    whiteCard.addEventListener('click', () => whiteCard.classList.toggle('flipped'));
    // preload the ONNX model in the background so the first AI turn is snappy
    DV.loadModel('model.onnx?v=2').catch(err => console.error('Model load failed:', err));
}

// ============== Card Highlight ==============

function highlightMyCard(position, className) {
    elements.playerHand?.querySelector(`[data-position="${position}"]`)?.classList.add(className);
}

function removeMyCardHighlight(position) {
    elements.playerHand?.querySelector(`[data-position="${position}"]`)
        ?.classList.remove('guessed-correct', 'guessed-wrong');
}

function flipMyCard(position) {
    const card = elements.playerHand?.querySelector(`[data-position="${position}"]`);
    if (!card) return;
    card.classList.add('flipping');
    setTimeout(() => { card.classList.remove('flipping'); card.classList.add('just-revealed'); }, 600);
}

function flipOpponentCard(position, value = null) {
    const card = elements.opponentHand?.querySelector(`[data-position="${position}"]`);
    if (!card) return;
    card.classList.add('flipping');
    if (value !== null) {
        setTimeout(() => {
            const valueEl = card.querySelector('.value');
            if (valueEl) valueEl.textContent = value === 12 ? '-' : value;
            card.classList.add('revealed');
        }, 300);
    }
    setTimeout(() => { card.classList.remove('flipping'); card.classList.add('just-revealed'); }, 600);
}

function highlightOpponentCard(position, className) {
    elements.opponentHand?.querySelector(`[data-position="${position}"]`)?.classList.add(className);
}

function removeOpponentCardHighlight(position) {
    elements.opponentHand?.querySelector(`[data-position="${position}"]`)
        ?.classList.remove('guessed-correct', 'guessed-wrong', 'guess-failed');
}

function shakeOpponentCard(position) {
    const card = elements.opponentHand?.querySelector(`[data-position="${position}"]`);
    if (!card) return;
    card.classList.add('guess-failed');
    setTimeout(() => card.classList.remove('guess-failed'), 800);
}

function shakeMyCard(position) {
    const card = elements.playerHand?.querySelector(`[data-position="${position}"]`);
    if (!card) return;
    card.classList.add('guess-failed');
    setTimeout(() => card.classList.remove('guess-failed'), 800);
}

// ============== Init ==============
// Public play page: no password gate — initialize once everything (incl. DV) is defined.
initTitleCards();
console.log('Da Vinci Code loaded');
