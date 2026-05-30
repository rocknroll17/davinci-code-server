/**
 * Da Vinci Code Game - AI Lab (비밀번호 보호 + AI 추론 시각화)
 *
 * Single-player, fully client-side. The UI (rendering, animations, AI reasoning
 * side-panel, password gate, DOM bindings, event-handler bodies) is preserved
 * UNCHANGED from the server-served static/ai_game.js. The ONLY layer replaced is
 * the data layer:
 *   - apiCall('/api/...') -> local engine calls returning the SAME JSON shapes
 *   - connectSSE()/EventSource -> an in-page event dispatcher firing the SAME
 *     event names with the SAME payload fields (driven by engine.js orchestration)
 */

// ============== 초기화 ==============
// 공개 플레이 페이지: 비밀번호 게이트 없이 바로 시작.
initTitleCards();

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
// Fresh EventTarget per game (re-created in connectSSE) so a "새 게임" restart
// doesn't accumulate duplicate handlers — matching the original fresh-EventSource.
let localBus = new EventTarget();

// The reasoning-panel confirm button calls fetch('/api/game/reasoning_ack', ...)
// in its UNCHANGED handler body. Route that one local endpoint to the session so
// the AI guess (which awaits the ack) can proceed. Everything else falls through
// to the real fetch (e.g. loading model.onnx / ort wasm from the CDN).
const _origFetch = window.fetch.bind(window);
window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.includes('/api/game/reasoning_ack')) {
        if (session) session.reasoningAck();
        return Promise.resolve(new Response(JSON.stringify({ success: true }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
        }));
    }
    return _origFetch(input, init);
};

function emitEvent(eventName, dataObj) {
    // mimics SSE: handlers read JSON.parse(e.data)
    localBus.dispatchEvent(new MessageEvent(eventName, { data: JSON.stringify(dataObj) }));
}

let session = null;  // current LocalSession

class LocalSession {
    constructor(useModel) {
        this.useModel = useModel;
        this.message = '플레이어 대기 중...';
        // human = players[0] (first), ai = players[1]
        this.human = DV.makeHumanPlayer('human');
        this.ai = DV.makeAIPlayer('ai', useModel);
        this.human.player_index = 0;
        this.ai.player_index = 1;
        this.engine = DV.makeEngine([this.human, this.ai], 'local');
        this.gameId = 'local';
        this.playerId = this.human.id;
        this._reasoningAck = null;   // resolver for reasoning_ack
    }

    start() {
        DV.engineSetup(this.engine);
        this.message = '검정 또는 흰색 카드를 뽑으세요.';
        // game_start (emit_to_all) — fired after a tick like the server
        emitEvent('game_start', { message: '게임이 시작되었습니다!', current_player: 0 });
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
                ? '🎉 축하합니다! 당신이 승리했습니다!'
                : '😢 아쉽습니다. 상대방이 승리했습니다.';
        } else if (forActor) {
            message = this.message;
        } else if (myTurn) {
            message = this.message;
        } else {
            message = '⏳ 상대방의 차례입니다. 기다려주세요.';
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
            ? `카드를 배치할 위치를 선택하세요. (${valid.length}곳 가능)`
            : '카드가 자동으로 배치됩니다.';
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
        this.message = '상대방 카드를 추측하세요.';
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
        const valueStr = value === 12 ? '조커' : String(value);
        if (result.is_correct) {
            this.message = e.game_over
                ? '🎉 정답! 게임 종료! 당신이 승리했습니다!'
                : '✅ 정답! 계속 추측하시겠습니까?';
        } else {
            this.message = e.game_over
                ? '❌ 틀렸습니다! 카드가 모두 공개되어 게임이 종료됩니다.'
                : '❌ 틀렸습니다! 상대방 차례입니다.';
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
                    emitEvent('game_over', { winner: e.winner.player_index, message: '🎉 축하합니다! 당신이 승리했습니다!' });
                } else {
                    emitEvent('game_over', { winner: e.winner.player_index, message: '😢 아쉽습니다. 다음에 다시 도전하세요!' });
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
        this.message = continueGuessing ? '🎯 계속 추측하세요!' : '턴을 종료했습니다.';
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

    // reasoning_ack: resolve the pending promise that pauses the AI guess
    reasoningAck() {
        if (this._reasoningAck) { const r = this._reasoningAck; this._reasoningAck = null; r(); }
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
            const colorName = color === 0 ? '검정' : '흰색';
            emitEvent('opponent_action', {
                action: 'place',
                color: placeResult.placed_card.color,
                position: placeResult.position,
                message: `상대방이 ${colorName} 카드를 위치 ${placeResult.position}에 배치했습니다.`,
            });
        } else if (e.phase === DV.Phase.GUESS) {
            await this.aiGuess(ai);
        } else if (e.phase === DV.Phase.DECISION) {
            const action = await DV.getAction(e, ai.id);
            const continueGuessing = action.decision === 1;
            DV.engineDecision(e, ai.id, continueGuessing);
            const msg = continueGuessing ? '⏳ 상대방이 계속 추측합니다.' : '상대방이 턴을 종료했습니다.';
            // DecisionEmitter.emit_to_opponent_only -> opponent_action (decision)
            emitEvent('opponent_action', { action: 'decision', continue: continueGuessing, message: msg });
            if (!continueGuessing) {
                const deckEmpty = DV.deckIsEmpty(e.deck);
                setTimeout(() => {
                    emitEvent('turn_change', {
                        your_turn: true,
                        message: deckEmpty
                            ? '🎯 당신의 차례입니다! 상대방 카드를 추측하세요.'
                            : '🎯 당신의 차례입니다! 카드를 뽑으세요.',
                    });
                }, 2000);
            }
        }
    }

    async aiGuess(ai) {
        const e = this.engine;
        // Compute reasoning + action (mirrors guess_action). Emit ai_reasoning,
        // then WAIT for the human's confirm button (reasoning_ack), then guess.
        let reasoning, position, value;
        try {
            reasoning = await DV.getActionWithReasoning(e, ai.id);
            position = reasoning.position;
            value = reasoning.value;
            // AI's own hand (real values) added to payload
            reasoning.ai_hand = ai.hand.map((card, i) => ({
                position: i, color: card.color, value: card.value, is_revealed: card.is_revealed,
            }));
        } catch (err) {
            const action = await DV.getAction(e, ai.id);
            position = action.position; value = action.value;
            reasoning = null;
        }

        // guess_action validity check + first-hidden fallback
        const oppHand = DV.handToOpponentView(this.human.hand);
        if (!(oppHand && position < oppHand.length && !oppHand[position].is_revealed)) {
            let fixed = null;
            for (let i = 0; i < oppHand.length; i++) {
                if (!oppHand[i].is_revealed) { fixed = i; break; }
            }
            if (fixed !== null) { position = fixed; if (reasoning) reasoning.position = fixed; }
            else { position = 0; value = 0; }
        }

        // Public play: no reasoning panel — brief "thinking" pause, then guess.
        await new Promise((resolve) => setTimeout(resolve, 800));

        const result = DV.engineGuess(e, ai.id, position, value);
        const valueStr = value === 12 ? '조커' : String(value);

        // GuessEmitter opponent_data (AI is actor -> human gets opponent_action)
        const oppData = {
            action: 'guess',
            position: result.position,
            value: value,
            correct: result.is_correct,
            message: `상대방이 위치 ${result.position}을(를) ${valueStr}로 추측했습니다.`,
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
                    emitEvent('game_over', { winner: e.winner.player_index, message: '😢 아쉽습니다. 다음에 다시 도전하세요!' });
                } else {
                    // AI lost -> human gets victory
                    emitEvent('game_over', { winner: e.winner.player_index, message: '🎉 축하합니다! 당신이 승리했습니다!' });
                }
            }, 2000);
        } else if (!result.is_correct) {
            const deckEmpty = DV.deckIsEmpty(e.deck);
            setTimeout(() => {
                emitEvent('turn_change', {
                    your_turn: true,
                    message: deckEmpty
                        ? '🎯 당신의 차례입니다! 상대방 카드를 추측하세요.'
                        : '🎯 당신의 차례입니다! 카드를 뽑으세요.',
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
        throw new Error('PvP는 이 페이지에서 지원되지 않습니다.');
    }
    if (path === '/api/game/state') {
        if (!session) throw new Error('게임이 없습니다.');
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
    if (path === '/api/game/reasoning_ack') {
        if (session) session.reasoningAck();
        return { success: true };
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
// connectSSE attaches the SAME handlers to the in-page localBus. Handler BODIES
// are byte-identical to the server build's ai_game.js.

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

            // AI 추측 결과가 오면 추론 오버레이 닫기
            hideAIReasoningOverlay();

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

    // AI 추론 시각화 — AI 추측 0.8s 전에 수신
    eventSource.addEventListener('ai_reasoning', (e) => {
        const data = JSON.parse(e.data);
        console.log('AI reasoning:', data);
        showAIReasoningOverlay(data);
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
                showMessage('✅ 정답!');
                highlightOpponentCard(position, 'guessed-correct');
                flipOpponentCard(position, data.value);
            } else {
                showMessage('❌ 틀렸습니다!');
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
    if (!inputGameId) { showMessage('⚠️ 게임 ID를 입력하세요'); return; }
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
    if (position === null || isNaN(value)) { showMessage('⚠️ 카드와 숫자를 선택하세요'); return; }
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
    const map = { waiting: '대기중', draw: '뽑기', guess: '추측', decision: '선택', place: '배치' };
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
    drawnCardPreview.innerHTML = `<span class="label">뽑은 카드</span><span class="value">${pendingCard.value === 12 ? '-' : pendingCard.value}</span>`;
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
    elements.guessValue.innerHTML = '<option value="">숫자 선택...</option>';
    for (let i = 0; i <= 12; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = i === 12 ? '- 조커' : i;
        elements.guessValue.appendChild(opt);
    }
}

function showGameOver() {
    elements.gameOverOverlay?.classList.remove('hidden');
    if (gameState.message?.includes('승리')) {
        elements.gameOverTitle.textContent = '🎉 승리!';
        elements.gameOverTitle.style.color = '#4ecca3';
    } else {
        elements.gameOverTitle.textContent = '💀 패배';
        elements.gameOverTitle.style.color = '#e94560';
    }
    elements.gameOverMessage.textContent = gameState.message || '게임 종료';
}

function showGameOverWithData(data) {
    elements.gameOverOverlay?.classList.remove('hidden');
    if (data.message?.includes('승리')) {
        elements.gameOverTitle.textContent = '🎉 승리!';
        elements.gameOverTitle.style.color = '#4ecca3';
    } else {
        elements.gameOverTitle.textContent = '💀 패배';
        elements.gameOverTitle.style.color = '#e94560';
    }
    elements.gameOverMessage.textContent = data.message || '게임 종료';
    showMessage(data.message);
}

function showDisconnectOverlay(message) {
    if (eventSource) { eventSource = null; }
    elements.gameOverOverlay?.classList.remove('hidden');
    elements.gameOverTitle.textContent = '🚪 상대방 퇴장';
    elements.gameOverTitle.style.color = '#ffc107';
    elements.gameOverMessage.textContent = message || '상대방이 게임을 나갔습니다.';
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
    DV.loadModel('model.onnx').catch(err => console.error('Model load failed:', err));
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

// ============== AI 추론 사이드 패널 ==============

let _aiRevealHuman = false;  // 토글 상태: 내 패 실제 값 표시 여부
let _lastReasoningData = null;  // 마지막 reasoning 데이터 (토글 시 재렌더)

/**
 * AI 미니 카드 엘리먼트 생성
 */
function _makeMiniCard(position, color, displayVal, classes = []) {
    const el = document.createElement('div');
    el.className = `ai-mini-card ${color === 0 ? 'mini-black' : 'mini-white'}`;
    classes.forEach(c => el.classList.add(c));
    el.innerHTML = `<span class="mini-pos">${position}</span><span class="mini-val">${displayVal}</span>`;
    return el;
}

// ── 믿음 확률 툴팁 ────────────────────────────────────────────────────────
let _beliefTooltip = null;

function _ensureBeliefTooltip() {
    if (_beliefTooltip) return _beliefTooltip;
    const el = document.createElement('div');
    el.id = 'ai-belief-tooltip';
    el.className = 'ai-belief-tooltip hidden';
    document.body.appendChild(el);
    _beliefTooltip = el;
    return el;
}

function _showBeliefTooltip(anchorEl, pos, probs, cardColor, isRevealed, realVal) {
    const tooltip = _ensureBeliefTooltip();
    tooltip.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'belief-tooltip-title';
    if (isRevealed) {
        title.textContent = `내 ${pos}번 (공개됨: ${realVal === 12 ? '-' : realVal})`;
    } else {
        title.textContent = `내 ${pos}번 — AI 추정 분포`;
    }
    tooltip.appendChild(title);

    if (!probs || probs.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'belief-tooltip-empty';
        empty.textContent = '데이터 없음';
        tooltip.appendChild(empty);
    } else {
        // 카드 색 기준으로 필터: color=0(흑) → 짝수 값(0,2,4,6,8,10) + 조커
        //                        color=1(백) → 홀수 값(1,3,5,7,9,11) + 조커
        // 단, 모델 내부 belief는 색 정보를 학습했을 수 있으니 필터 없이 전체 표시 후 낮은 건 제거
        const minProb = 0.03;
        const entries = probs
            .map((p, v) => ({ v, p }))
            .filter(e => e.p >= minProb)
            .sort((a, b) => b.p - a.p)
            .slice(0, 10);  // 최대 10개

        if (entries.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'belief-tooltip-empty';
            empty.textContent = '유의미한 확률 없음';
            tooltip.appendChild(empty);
        } else {
            const chart = document.createElement('div');
            chart.className = 'belief-chart';

            // 세로 막대 그래프: 값별로 한 열
            const barsRow = document.createElement('div');
            barsRow.className = 'belief-bars-row';

            const maxP = entries[0].p;
            entries.forEach(({ v, p }) => {
                const col = document.createElement('div');
                col.className = 'belief-bar-col';
                const pct = Math.round(p * 100);
                const barH = Math.round((p / maxP) * 52);  // 최대 52px 기준 상대 높이

                // 실제 값과 일치하면 강조
                const isTrue = isRevealed && v === realVal;
                col.innerHTML = `
                    <div class="belief-bar-pct">${pct}%</div>
                    <div class="belief-bar-wrap">
                        <div class="belief-bar-fill ${isTrue ? 'belief-bar-true' : ''}" style="height:${barH}px"></div>
                    </div>
                    <div class="belief-bar-label">${v === 12 ? 'J' : v}</div>`;
                barsRow.appendChild(col);
            });
            chart.appendChild(barsRow);
            tooltip.appendChild(chart);
        }
    }

    tooltip.classList.remove('hidden');

    // 패널 왼쪽에 고정 위치
    const panel = document.getElementById('ai-reasoning-panel');
    const panelRect = panel ? panel.getBoundingClientRect() : { left: window.innerWidth - 300, top: 0 };
    const anchorRect = anchorEl.getBoundingClientRect();

    // 툴팁 크기 측정용 임시 렌더
    tooltip.style.left = '0px';
    tooltip.style.top = '0px';
    const tW = tooltip.offsetWidth;
    const tH = tooltip.offsetHeight;

    let left = panelRect.left - tW - 10;
    if (left < 5) left = 5;
    let top = anchorRect.top + anchorRect.height / 2 - tH / 2;
    if (top < 5) top = 5;
    if (top + tH > window.innerHeight - 5) top = window.innerHeight - tH - 5;

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
}

function _hideBeliefTooltip() {
    if (_beliefTooltip) _beliefTooltip.classList.add('hidden');
}

/**
 * 카드 수에 따라 패널 너비 + 카드 크기 동적 조정 (한 줄 유지)
 */
function _adjustPanelWidth(data) {
    const panel = document.getElementById('ai-reasoning-panel');
    if (!panel) return;

    const N = Math.max(
        (data.ai_hand || []).length,
        (gameState?.my_hand || []).length,
        1
    );

    const GAP = 3, PADDING = 28, BASE_W = 34, BASE_H = 50;
    const MAX_PANEL = 480, MIN_PANEL = 300;

    // 한 줄에 N장 넣는 데 필요한 너비
    const needed = N * (BASE_W + GAP) - GAP + PADDING;
    const panelW = Math.max(MIN_PANEL, Math.min(MAX_PANEL, needed));

    // 패널 내 실제 가용 너비에 맞춰 카드 폭 계산
    const available = panelW - PADDING;
    let cardW = Math.floor((available + GAP) / N - GAP);
    cardW = Math.max(22, Math.min(BASE_W, cardW));
    const cardH = Math.round(BASE_H * cardW / BASE_W);
    const valSize = Math.max(0.65, cardW / BASE_W).toFixed(2);

    panel.style.width = panelW + 'px';
    panel.style.setProperty('--mini-card-w', cardW + 'px');
    panel.style.setProperty('--mini-card-h', cardH + 'px');
    panel.style.setProperty('--mini-val-size', valSize + 'rem');
}
// ─────────────────────────────────────────────────────────────────────────

/**
 * AI 패 섹션 렌더 (data.ai_hand 기반 — 실제 값 포함)
 */
function _renderAIHand(data) {
    const { attention_scores, ai_hand } = data;
    const el = document.getElementById('ai-panel-ai-hand');
    if (!el) return;
    el.innerHTML = '';
    if (!ai_hand || !ai_hand.length) {
        el.innerHTML = '<span style="opacity:0.35;font-size:0.75rem">데이터 없음</span>';
        return;
    }
    ai_hand.forEach(card => {
        const score   = attention_scores?.[card.position] ?? 0;  // [0-12] = AI 자신 카드
        const isAttn  = score >= 0.2;
        const val     = card.value === 12 ? '-' : card.value;
        const classes = isAttn ? ['mini-attention'] : [];
        el.appendChild(_makeMiniCard(card.position, card.color, val, classes));
    });
}

/**
 * 내 패 섹션 렌더 (AI가 보는 시점 + 토글)
 * - 기본: hidden=?, revealed=실제값, target=추측값(빨간 글로우)
 * - 토글: 전부 실제 값 표시
 */
function _renderHumanHand(data, showReal) {
    const { position, value, attention_scores, belief_probs } = data;
    const el = document.getElementById('ai-panel-human-hand');
    if (!el || !gameState?.my_hand) return;
    el.innerHTML = '';
    const valueLabel = value === 12 ? '-' : String(value);
    const sorted = [...gameState.my_hand].sort((a, b) => a.position - b.position);
    sorted.forEach(card => {
        const score    = attention_scores?.[13 + card.position] ?? 0;  // [13-25] = 인간 카드
        const isTarget = card.position === position;
        const isAttn   = !isTarget && score >= 0.2;
        let displayVal;
        if (isTarget) {
            displayVal = valueLabel;  // AI 추측값 표시
        } else if (showReal) {
            displayVal = card.value === 12 ? '-' : card.value;  // 실제 값
        } else {
            // AI 시점: 공개된 것만 보임, 나머지는 ?
            displayVal = card.revealed ? (card.value === 12 ? '-' : card.value) : '?';
        }
        const classes = [];
        if (isTarget) classes.push('mini-target');
        else if (isAttn) classes.push('mini-attention');

        const miniCard = _makeMiniCard(card.position, card.color, displayVal, classes);

        // 호버 시 belief 확률 분포 표시 (비공개 카드에서 특히 유용)
        if (belief_probs && belief_probs[card.position]) {
            miniCard.classList.add('mini-belief-hoverable');
            const posProbs = belief_probs[card.position];
            miniCard.addEventListener('mouseenter', () => {
                _showBeliefTooltip(miniCard, card.position, posProbs, card.color, card.revealed, card.value);
            });
            miniCard.addEventListener('mouseleave', _hideBeliefTooltip);
        }

        el.appendChild(miniCard);
    });
}

/**
 * AI 추론을 사이드 패널에 표시
 * @param {object} data  {position, value, attention_scores[28], ai_hand[]}
 */
function showAIReasoningOverlay(data) {
    const { position, value, attention_scores } = data;
    if (!elements.gameScreen || elements.gameScreen.classList.contains('hidden')) return;

    const panel = document.getElementById('ai-reasoning-panel');
    if (!panel) return;

    _lastReasoningData = data;
    _aiRevealHuman = false;  // 패널 열 때마다 토글 초기화

    // 결론 텍스트
    const valueLabel = value === 12 ? '-' : String(value);
    const conclusionEl = document.getElementById('ai-panel-conclusion');
    if (conclusionEl) conclusionEl.textContent = `"포지션 ${position} → ${valueLabel === '-' ? '조커' : valueLabel}이다!"`;

    // AI 자신의 패
    _renderAIHand(data);

    // 내 패 (AI 시점 기본)
    _renderHumanHand(data, false);

    // 카드 수에 따라 패널 너비 + 카드 크기 조정 (한 줄 유지)
    _adjustPanelWidth(data);

    // 토글 버튼 초기 상태
    const toggleBtn = document.getElementById('ai-panel-reveal-toggle');
    if (toggleBtn) {
        toggleBtn.textContent = '실제 값 보기';
        toggleBtn.classList.remove('active');
        // 기존 핸들러 제거 후 재연결
        const newBtn = toggleBtn.cloneNode(true);
        toggleBtn.parentNode.replaceChild(newBtn, toggleBtn);
        newBtn.addEventListener('click', () => {
            _aiRevealHuman = !_aiRevealHuman;
            newBtn.textContent = _aiRevealHuman ? '숨기기' : '실제 값 보기';
            newBtn.classList.toggle('active', _aiRevealHuman);
            _renderHumanHand(_lastReasoningData, _aiRevealHuman);
        });
    }

    // 어텐션 스코어 바
    const scoresEl = document.getElementById('ai-panel-scores');
    if (scoresEl && attention_scores) {
        scoresEl.innerHTML = '';

        // 카드 정보 맵 구성
        const myCardMap = {};
        (gameState.my_hand || []).forEach(c => { myCardMap[c.position] = c; });
        const aiCardMap = {};
        (data.ai_hand || []).forEach(c => { aiCardMap[c.position] = c; });
        const colorName = c => c === 0 ? '흑' : '백';
        const valName = v => (v !== undefined && v >= 0) ? (v === 12 ? 'J' : String(v)) : '?';

        const entries = [];
        // [13-25] = 내 패. 실제 카드가 있는 위치만 표시.
        // 인간은 자기 패를 다 알므로 항상 실제 값 표시 (revealed 무관)
        for (let i = 13; i < 26; i++) {
            const score = attention_scores[i] ?? 0;
            if (score < 0.12) continue;
            const pos = i - 13;
            const card = myCardMap[pos];
            if (!card) continue; // 실제 패가 없는 빈 슬롯 → 무시
            const label = `내 패 ${pos}번 (${colorName(card.color)}·${valName(card.value)})`;
            entries.push({ label, score, isTarget: pos === position, type: 'my', card });
        }
        // [0-12] = AI 패. 실제 카드가 있는 위치만 표시.
        for (let i = 0; i < 13; i++) {
            const score = attention_scores[i] ?? 0;
            if (score < 0.12) continue;
            const card = aiCardMap[i];
            if (!card) continue; // 빈 슬롯 → 무시
            const label = `AI 패 ${i}번 (${colorName(card.color)}·${valName(card.value)})`;
            entries.push({ label, score, isTarget: false, type: 'ai', card });
        }
        entries.sort((a, b) => b.score - a.score);

        // 추론 서사 문장 구성
        const targetCard = myCardMap[position];
        const targetColorStr = targetCard ? colorName(targetCard.color) : '?';
        const guessedValStr = valName(value);
        const top1 = entries[0];
        const top2 = entries[1];

        let narrativeText = `내 ${position}번(${targetColorStr}) → `;
        narrativeText += `AI 추측: ${guessedValStr}`;
        if (top1) {
            narrativeText += ` | 주요 근거: ${top1.label}`;
            if (top2 && top2.score > 0.18) narrativeText += `, ${top2.label}`;
        }

        const narrative = document.createElement('div');
        narrative.className = 'ai-scores-narrative';
        narrative.textContent = narrativeText;
        scoresEl.appendChild(narrative);

        if (entries.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ai-scores-header';
            empty.textContent = '유의미한 어텐션 없음';
            scoresEl.appendChild(empty);
        } else {
            const header = document.createElement('div');
            header.className = 'ai-scores-header';
            header.textContent = '판단에 영향을 준 카드 (어텐션 비중)';
            scoresEl.appendChild(header);

            entries.slice(0, 6).forEach(({ label, score, isTarget, type }) => {
                const pct = Math.round(score * 100);
                const row = document.createElement('div');
                row.className = 'ai-score-row' + (isTarget ? ' ai-score-target-row' : '') + (type === 'ai' ? ' ai-score-ai-card' : '');
                row.innerHTML = `
                    <div class="ai-score-top">
                        <span class="ai-score-label">${label}</span>
                        ${isTarget ? '<span class="ai-score-target-mark">추측 대상</span>' : ''}
                        <span class="ai-score-value">${pct}%</span>
                    </div>
                    <div class="ai-score-bar-bg"><div class="ai-score-bar-fill" style="width:${Math.min(100, pct)}%"></div></div>`;
                scoresEl.appendChild(row);
            });
        }
    }

    panel.classList.remove('hidden');

    // 확인 버튼 재연결 (중복 핸들러 방지)
    const confirmBtn = document.getElementById('ai-reasoning-confirm-btn');
    if (confirmBtn) {
        const newBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
        newBtn.addEventListener('click', async () => {
            try {
                await fetch(`/api/game/reasoning_ack?game_id=${gameId}&player_id=${playerId}`, { method: 'POST' });
            } catch (e) { console.error('reasoning_ack failed:', e); }
            hideAIReasoningOverlay();
        });
    }
    // 자동 타이머 없음 — 확인 버튼으로만 닫힘
}

function hideAIReasoningOverlay() {
    document.getElementById('ai-reasoning-panel')?.classList.add('hidden');
}

// ============== Init ==============

console.log('🧠 Da Vinci Code AI Lab loaded');
