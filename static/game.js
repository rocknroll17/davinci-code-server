/**
 * Da Vinci Code Game - PvP + SSE
 */

// ============== State ==============

let gameState = null;
let gameId = null;
let playerId = null;  // 내 플레이어 ID
let isLoading = false;
let pendingCard = null;
let selectedGuessPosition = null;
let eventSource = null;  // SSE 연결
let preShuffledDeck = null; // pre-shuffled deck array (0=black,1=white)
let messageLockUntil = 0;  // 메시지 잠금 타임스탬프 (이 시간까지 덮어쓰기 방지)

// ============== DOM Elements ==============

const elements = {
    startScreen: document.getElementById('start-screen'),
    lobbyScreen: document.getElementById('lobby-screen'),
    gameScreen: document.getElementById('game-screen'),
    createGameBtn: document.getElementById('create-game-btn'),
    joinGameBtn: document.getElementById('join-game-btn'),
    gameIdInput: document.getElementById('game-id-input'),
    waitingMessage: document.getElementById('waiting-message'),
    waitingGameId: document.getElementById('waiting-game-id'),
    cancelWaitBtn: document.getElementById('cancel-wait-btn'),
    phase: document.getElementById('phase'),
    message: document.getElementById('message'),
    playerHand: document.getElementById('player-hand'),
    opponentHand: document.getElementById('opponent-hand'),
    actionArea: document.getElementById('action-area'),
    drawAction: document.getElementById('draw-action'),
    placeAction: document.getElementById('place-action'),
    placeSlots: document.getElementById('place-slots'),
    guessAction: document.getElementById('guess-action'),
    decisionAction: document.getElementById('decision-action'),
    waitingTurn: document.getElementById('waiting-turn'),
    deckCards: document.getElementById('deck-cards'),
    guessValue: document.getElementById('guess-value'),
    guessBtn: document.getElementById('guess-btn'),
    decisionContinue: document.getElementById('decision-continue'),
    decisionStop: document.getElementById('decision-stop'),
    gameOverOverlay: document.getElementById('game-over-overlay'),
    gameOverTitle: document.getElementById('game-over-title'),
    gameOverMessage: document.getElementById('game-over-message'),
    newGameBtn: document.getElementById('new-game-btn')
};

// ============== API Functions ==============

async function apiCall(endpoint, method = 'GET', body = null) {
    if (isLoading) return null;
    
    isLoading = true;
    setLoadingState(true);
    
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' }
    };
    
    if (body) options.body = JSON.stringify(body);
    
    try {
        const response = await fetch(endpoint, options);
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || '서버 오류');
        }
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        showMessage(`⚠️ ${error.message}`);
        throw error;
    } finally {
        isLoading = false;
        setLoadingState(false);
    }
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

// ============== SSE (Server-Sent Events) ==============

function connectSSE() {
    if (!gameId || !playerId) return;
    
    // 기존 연결 종료
    if (eventSource) {
        eventSource.close();
    }
    
    const url = `/api/game/events?game_id=${gameId}&player_id=${playerId}`;
    eventSource = new EventSource(url);
    
    eventSource.addEventListener('connected', (e) => {
        console.log('SSE connected:', JSON.parse(e.data));
    });
    
    eventSource.addEventListener('game_start', (e) => {
        const data = JSON.parse(e.data);
        console.log('Game started:', data);
        showMessage('🎮 ' + data.message);
        refreshState();
    });
    
    eventSource.addEventListener('opponent_action', (e) => {
        const data = JSON.parse(e.data);
        console.log('Opponent action:', data);
        
        // 상태 갱신: 상대의 'guess' 결과일 경우 화면을 2초 유지한 뒤 갱신
        if (data && data.action === 'guess') {
            const position = data.position;
            
            // 액션에 따른 메시지 (2초 잠금)
            showMessage(`🎭 ${data.message}`, 2000);
            
            if (data.correct) {
                // 상대가 맞춤 - 내 카드에 뒤집기 애니메이션 + 초록색 하이라이트
                highlightMyCard(position, 'guessed-correct');
                flipMyCard(position);
                setTimeout(() => {
                    removeMyCardHighlight(position);
                    fetchAndUpdateHands();
                }, 2000);
            } else {
                // 상대가 틀림 - 내 카드에 빨간 진동 애니메이션 + 상대방 카드 뒤집기
                shakeMyCard(position);
                // 상대방의 공개된 카드 뒤집기 애니메이션 (500ms 후)
                if (data.revealed_position !== undefined && data.revealed_position >= 0) {
                    setTimeout(() => {
                        flipOpponentCard(data.revealed_position, data.revealed_value);
                    }, 500);
                }
                setTimeout(async () => {
                    await refreshState(false, false);
                }, 2000);
            }
        } else if (data && data.action === 'place') {
            // 액션에 따른 메시지
            showMessage(`🎭 ${data.message}`);
            // 메시지는 이미 표시했으므로 메시지를 보존하면서 상태만 갱신
            refreshState(true, false);
        } else if (data && data.action === 'decision') {
            // 액션에 따른 메시지
            showMessage(`🎭 ${data.message}`);
            // decision은 메시지만 표시하고 상태는 갱신하지 않음 (turn_change에서 갱신됨)
        } else {
            // 액션에 따른 메시지
            showMessage(`🎭 ${data.message}`);
            setTimeout(() => refreshState(), 500);
        }
    });

    // 남은 카드 수 업데이트 수신 -> 상태 갱신 및 사전 셔플
    eventSource.addEventListener('deck_update', (e) => {
        const data = JSON.parse(e.data);
        console.log('Deck update:', data);

        // 상태를 갱신한 뒤 deck composition으로 미리 섞어둠
        refreshState().then(() => {
            if (!gameState) return;
            const black = gameState.deck_black || 0;
            const white = gameState.deck_white || 0;
            preShuffledDeck = preparePreShuffledDeck(black, white);
            console.log('Prepared pre-shuffled deck (len):', preShuffledDeck.length);
        }).catch(err => console.error('Failed refresh on deck_update:', err));
    });
    
    eventSource.addEventListener('turn_change', (e) => {
        const data = JSON.parse(e.data);
        console.log('Turn change:', data);
        
        if (data.your_turn) {
            // 메시지 잠금 중이면 잠시 대기 후 처리
            const remainingLock = messageLockUntil - Date.now();
            if (remainingLock > 0) {
                // 잠금이 풀릴 때까지 대기 후 처리
                setTimeout(() => {
                    showMessage(data.message);
                    refreshState(true, false);
                }, remainingLock + 100);
            } else {
                // 잠금 없으면 바로 처리
                showMessage(data.message);
                refreshState(true, false);
            }
        }
    });
    
    eventSource.addEventListener('game_over', (e) => {
        const data = JSON.parse(e.data);
        console.log('Game over:', data);
        
        // SSE에서 받은 데이터로 직접 모달 표시
        showGameOverWithData(data);
    });
    
    eventSource.addEventListener('player_disconnected', (e) => {
        const data = JSON.parse(e.data);
        console.log('Player disconnected:', data);
        
        // 상대방이 나감 - 게임 종료 오버레이 표시
        showDisconnectOverlay(data.message);
    });
    
    eventSource.addEventListener('heartbeat', (e) => {
        console.log('Heartbeat');
    });

    // 본인 액션 결과 수신 (API 응답 대신 SSE로 상태 갱신)
    eventSource.addEventListener('my_action', (e) => {
        const data = JSON.parse(e.data);
        console.log('My action:', data);
        
        // 상태 업데이트
        if (data.state) {
            gameState = data.state;
        }
        
        if (data.action === 'draw') {
            // 뽑기 결과 - pendingCard 설정 및 UI 갱신
            pendingCard = data.card;
            preShuffledDeck = null;  // 덱 정보 무효화
            
            // 유효 위치가 1개면 자동 배치 (isLoading 해제 후 즉시 실행)
            if (pendingCard && pendingCard.valid_positions && pendingCard.valid_positions.length === 1) {
                // 약간의 딜레이로 isLoading 해제 대기
                setTimeout(() => {
                    place(pendingCard.valid_positions[0]);
                }, 50);
            } else {
                showMessage(data.message);
                updateUI();
            }
        } else if (data.action === 'place') {
            // 배치 결과
            pendingCard = null;
            preShuffledDeck = null;
            showMessage(data.message);
            updateUI();
        } else if (data.action === 'guess') {
            // 추측 결과
            selectedGuessPosition = null;
            const position = data.position;
            
            if (data.correct) {
                showMessage('✅ 정답!');
                // 상대 카드 뒤집기 애니메이션 (초록색)
                highlightOpponentCard(position, 'guessed-correct');
                flipOpponentCard(position, data.value);
            } else {
                showMessage('❌ 틀렸습니다!');
                // 상대 카드 빨간색 진동 애니메이션
                shakeOpponentCard(position);
                // 내 카드가 공개되면 뒤집기 애니메이션
                if (data.revealed_card) {
                    const revealedPos = data.revealed_card.position;
                    setTimeout(() => {
                        flipMyCard(revealedPos);
                    }, 500);
                }
            }
            
            // 결과 메시지를 2초 유지한 뒤 UI를 갱신함
            setTimeout(() => {
                removeOpponentCardHighlight(position);
                updateUI(true, false);
                // UI 갱신 후 버튼 다시 활성화
                if (elements.guessBtn) {
                    elements.guessBtn.disabled = false;
                }
            }, 2000);
        } else if (data.action === 'decision') {
            // 결정 결과
            showMessage(data.message);
            updateUI();
        }
    });
    
    eventSource.addEventListener('error', (e) => {
        console.error('SSE error:', e);
        // 재연결 시도
        setTimeout(() => {
            if (gameId && playerId) connectSSE();
        }, 3000);
    });

    // AI 추론 이벤트 — 일반 모드에서는 오버레이 없이 자동 확인
    eventSource.addEventListener('ai_reasoning', async () => {
        try {
            await fetch(`/api/game/reasoning_ack?game_id=${gameId}&player_id=${playerId}`, { method: 'POST' });
        } catch (e) {
            console.error('Reasoning ack failed:', e);
        }
    });

    eventSource.addEventListener('state_update', (e) => {
        console.log('State update event received');
        refreshState();
    });
}

function disconnectSSE() {
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
}

// ============== Game Management ==============

async function createGame() {
    try {
        const result = await apiCall('/api/lobby/new', 'POST');
        if (result) {
            gameId = result.game_id;
            playerId = result.player_id;
            
            // SSE 연결 (게임 시작 이벤트 대기)
            connectSSE();
            
            // 대기 화면 표시
            showLobbyScreen();
            if (elements.waitingGameId) {
                elements.waitingGameId.textContent = gameId;
            }
        }
    } catch (error) {
        console.error('Failed to create game:', error);
    }
}

async function createAIGame(useModel = true) {
    try {
        const url = `/api/lobby/new/vs-ai?use_model=${useModel}`;
        const result = await apiCall(url, 'POST');
        if (result) {
            gameId = result.game_id;
            playerId = result.player_id;
            
            // AI 게임은 바로 시작 - SSE 연결 후 게임 화면으로
            connectSSE();
            await refreshState();
            showGameScreen();
        }
    } catch (error) {
        console.error('Failed to create AI game:', error);
    }
}

async function joinGame() {
    const inputGameId = elements.gameIdInput?.value?.trim();
    if (!inputGameId) {
        showMessage('⚠️ 게임 ID를 입력하세요');
        return;
    }
    
    try {
        const result = await apiCall('/api/lobby/join', 'POST', { game_id: inputGameId });
        if (result) {
            gameId = result.game_id;
            playerId = result.player_id;
            
            // SSE 연결
            connectSSE();
            
            // 게임 화면으로
            await refreshState();
            showGameScreen();
        }
    } catch (error) {
        console.error('Failed to join game:', error);
    }
}

async function refreshState(preserveMessage = false, updateActionAfter = false) {
    if (!gameId || !playerId) return;
    
    try {
        const result = await apiCall('/api/game/state', 'POST', { 
            game_id: gameId, 
            player_id: playerId 
        });
        if (result) {
            gameState = result;
            
            // 대기 중이면 로비, 아니면 게임 화면
            if (gameState.phase === 'waiting') {
                showLobbyScreen();
            } else {
                showGameScreen();
                updateUI(preserveMessage, updateActionAfter);
            }
        }
    } catch (error) {
        console.error('Failed to refresh state:', error);
    }
}

// ============== Game Actions ==============

async function draw(color) {
    if (!gameState || !gameId || !playerId || isLoading) return;
    
    try {
        // API는 성공 여부만 확인, 실제 상태는 SSE my_action에서 처리
        const result = await apiCall('/api/game/draw', 'POST', { 
            game_id: gameId, 
            player_id: playerId,
            color 
        });
        // SSE my_action 이벤트에서 상태 갱신 처리
        if (!result || !result.success) {
            console.error('Draw failed: API returned failure');
        }
    } catch (error) {
        console.error('Draw failed:', error);
    }
}

async function place(position) {
    if (!gameState || !gameId || !playerId || isLoading || !pendingCard) return;
    
    try {
        // API는 성공 여부만 확인, 실제 상태는 SSE my_action에서 처리
        const result = await apiCall('/api/game/place', 'POST', { 
            game_id: gameId,
            player_id: playerId,
            color: pendingCard.color,
            number: pendingCard.value,
            position 
        });
        // SSE my_action 이벤트에서 상태 갱신 처리
        if (!result || !result.success) {
            console.error('Place failed: API returned failure');
        }
    } catch (error) {
        console.error('Place failed:', error);
    }
}

async function guess() {
    if (!gameState || !gameId || !playerId || isLoading) return;
    
    const position = selectedGuessPosition;
    const value = parseInt(elements.guessValue.value);
    
    if (position === null || isNaN(value)) {
        showMessage('⚠️ 카드와 숫자를 선택하세요');
        return;
    }
    
    // 추측 버튼 비활성화
    if (elements.guessBtn) {
        elements.guessBtn.disabled = true;
    }
    
    try {
        // API는 성공 여부만 확인, 실제 상태는 SSE my_action에서 처리
        const result = await apiCall('/api/game/guess', 'POST', { 
            game_id: gameId,
            player_id: playerId,
            position, 
            value 
        });
        // SSE my_action 이벤트에서 상태 갱신 및 애니메이션 처리
        if (!result || !result.success) {
            console.error('Guess failed: API returned failure');
            // 에러 시에도 버튼 다시 활성화
            if (elements.guessBtn) {
                elements.guessBtn.disabled = false;
            }
        }
    } catch (error) {
        console.error('Guess failed:', error);
        // 에러 시에도 버튼 다시 활성화
        if (elements.guessBtn) {
            elements.guessBtn.disabled = false;
        }
    }
}

async function makeDecision(continueGuessing) {
    if (!gameState || !gameId || !playerId || isLoading) return;
    
    try {
        // API는 성공 여부만 확인, 실제 상태는 SSE my_action에서 처리
        const result = await apiCall('/api/game/decision', 'POST', { 
            game_id: gameId,
            player_id: playerId,
            continue_guessing: continueGuessing 
        });
        // SSE my_action 이벤트에서 상태 갱신 처리
        if (!result || !result.success) {
            console.error('Decision failed: API returned failure');
        }
    } catch (error) {
        console.error('Decision failed:', error);
    }
}

// ============== UI Functions ==============

function showStartScreen() {
    elements.startScreen?.classList.remove('hidden');
    elements.lobbyScreen?.classList.add('hidden');
    elements.gameScreen?.classList.add('hidden');
    elements.gameOverOverlay?.classList.add('hidden');
    
    disconnectSSE();
    gameState = null;
    gameId = null;
    playerId = null;
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
    
    // 메시지 잠금 중이면 무시
    if (Date.now() < messageLockUntil) {
        console.log('Message locked, ignoring:', msg);
        return;
    }
    
    elements.message.innerHTML = msg;
    elements.message.parentElement?.classList.remove('flash');
    void elements.message.parentElement?.offsetWidth;
    elements.message.parentElement?.classList.add('flash');
    
    // 잠금 설정
    if (lockMs > 0) {
        messageLockUntil = Date.now() + lockMs;
    }
}

function updateUI(preserveMessage = false, updateActionAfter = false) {
    if (!gameState) return;
    
    if (elements.phase) {
        elements.phase.textContent = translatePhase(gameState.phase);
    }
    
    if (!preserveMessage && gameState.message) {
        showMessage(gameState.message);
    }
    
    // PvP: my_hand, opponent_hand 사용
    renderHand(elements.playerHand, gameState.my_hand, false);
    renderHand(elements.opponentHand, gameState.opponent_hand, true);
    
    if (!updateActionAfter) {
        updateActionPanel();
    }
    
    // game_over 모달이 이미 표시되어 있지 않을 때만 표시
    if (gameState.game_over && elements.gameOverOverlay?.classList.contains('hidden')) {
        showGameOver();
    }
}

// ============== Partial Update Functions ==============

/**
 * 상태만 받아오고 gameState에 저장 (UI 업데이트 없음)
 * @returns {Promise<object|null>} 받아온 상태 또는 null
 */
async function fetchState() {
    if (!gameId || !playerId) return null;
    
    try {
        const result = await apiCall('/api/game/state', 'POST', { 
            game_id: gameId, 
            player_id: playerId 
        });
        if (result) {
            gameState = result;
            return result;
        }
    } catch (error) {
        console.error('Failed to fetch state:', error);
    }
    return null;
}

/**
 * 양쪽 손패만 업데이트
 */
function updateHands() {
    if (!gameState) return;
    renderHand(elements.playerHand, gameState.my_hand, false);
    renderHand(elements.opponentHand, gameState.opponent_hand, true);
}

/**
 * 상태를 받아와서 손패만 업데이트
 */
async function fetchAndUpdateHands() {
    const state = await fetchState();
    if (state) {
        updateHands();
    }
    return state;
}

/**
 * 페이즈 표시만 업데이트
 */
function updatePhaseDisplay() {
    if (!gameState || !elements.phase) return;
    elements.phase.textContent = translatePhase(gameState.phase);
}

/**
 * 덱 카드 수만 업데이트 (덱 영역 다시 렌더링)
 */
function updateDeck() {
    if (!gameState) return;
    renderDeckCards();
}

/**
 * 상태를 받아와서 덱만 업데이트
 */
async function fetchAndUpdateDeck() {
    const state = await fetchState();
    if (state) {
        updateDeck();
    }
    return state;
}

/**
 * 손패 + 액션 패널만 업데이트
 */
function updateHandsAndActions() {
    if (!gameState) return;
    updateHands();
    updateActionPanel();
}

/**
 * 상태를 받아와서 손패 + 액션 패널 업데이트
 */
async function fetchAndUpdateHandsAndActions() {
    const state = await fetchState();
    if (state) {
        updateHandsAndActions();
    }
    return state;
}

/**
 * 메시지와 페이즈만 업데이트
 */
function updateHeader() {
    if (!gameState) return;
    updatePhaseDisplay();
    if (gameState.message) {
        showMessage(gameState.message);
    }
}

/**
 * 특정 상대 카드만 공개 상태로 업데이트 (전체 리렌더링 없이)
 * @param {number} position - 카드 위치
 * @param {number} value - 공개된 값
 */
function revealOpponentCard(position, value) {
    const card = elements.opponentHand?.querySelector(`[data-position="${position}"]`);
    if (card) {
        card.classList.add('revealed', 'newly-revealed');
        const valueSpan = card.querySelector('.value');
        if (valueSpan) {
            valueSpan.textContent = value === 12 ? '-' : value;
        }
    }
}

/**
 * 특정 내 카드만 공개 상태로 업데이트 (전체 리렌더링 없이)
 * @param {number} position - 카드 위치
 */
function revealMyCard(position) {
    const card = elements.playerHand?.querySelector(`[data-position="${position}"]`);
    if (card) {
        card.classList.add('revealed', 'newly-revealed');
    }
}

function translatePhase(phase) {
    const map = { 
        'waiting': '대기중',
        'draw': '뽑기', 
        'guess': '추측', 
        'decision': '선택',
        'place': '배치'
    };
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
            if (card.revealed) {
                el.classList.add('newly-revealed');
            }
        }
        
        const valueText = card.value === -1 ? '?' : (card.value === 12 ? '-' : card.value);
        el.innerHTML = `
            <span class="position">${card.position}</span>
            <span class="value">${valueText}</span>
        `;
        
        // 상대 카드 클릭 (추측용)
        if (isOpponent && gameState.phase === 'guess' && gameState.is_my_turn && !card.revealed) {
            el.classList.add('clickable');
            el.addEventListener('click', () => selectOpponentCard(card.position));
        }
        
        container.appendChild(el);
    });
}

function selectOpponentCard(position) {
    elements.opponentHand?.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
    const card = elements.opponentHand?.querySelector(`[data-position="${position}"]`);
    if (card) card.classList.add('selected');
    selectedGuessPosition = position;
}

function updateActionPanel() {
    // Hide all
    elements.drawAction?.classList.add('hidden');
    elements.placeAction?.classList.add('hidden');
    elements.guessAction?.classList.add('hidden');
    elements.decisionAction?.classList.add('hidden');
    elements.waitingTurn?.classList.add('hidden');
    
    if (!gameState || gameState.game_over) {
        elements.actionArea?.classList.add('hidden');
        return;
    }
    
    elements.actionArea?.classList.remove('hidden');
    
    // 배치 대기 중
    if (pendingCard && pendingCard.valid_positions.length > 1) {
        elements.placeAction?.classList.remove('hidden');
        renderPlaceSlots();
        return;
    }
    
    // 내 턴이 아니면 대기
    if (!gameState.is_my_turn) {
        elements.waitingTurn?.classList.remove('hidden');
        return;
    }
    
    if (gameState.phase === 'draw') {
        // 덱이 비어있으면 draw 대신 guess로 표시
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
    
    // 뽑은 카드 미리보기
    const drawnCardPreview = document.createElement('div');
    drawnCardPreview.className = 'drawn-card-preview';
    const drawnVal = pendingCard.value === 12 ? '-' : pendingCard.value;
    drawnCardPreview.classList.add(pendingCard.color === 0 ? 'card-black' : 'card-white');
    drawnCardPreview.innerHTML = `<span class="label">뽑은 카드</span><span class="value">${drawnVal}</span>`;
    elements.placeSlots.appendChild(drawnCardPreview);
    
    // 구분선
    const separator = document.createElement('div');
    separator.className = 'place-separator';
    separator.innerHTML = '→';
    elements.placeSlots.appendChild(separator);
    
    // 손패 + 슬롯 표시
    const positions = pendingCard.valid_positions;
    const hand = gameState.my_hand;
    
    for (let i = 0; i <= hand.length; i++) {
        if (positions.includes(i)) {
            const slot = document.createElement('div');
            slot.className = 'place-slot';
            slot.innerHTML = `<span>?</span>`;
            slot.addEventListener('click', () => place(i));
            elements.placeSlots.appendChild(slot);
        }
        
        if (i < hand.length) {
            const card = hand[i];
            const cardEl = document.createElement('div');
            cardEl.className = 'place-preview-card';
            cardEl.classList.add(card.color === 0 ? 'card-black' : 'card-white');
            const val = card.value === 12 ? '-' : card.value;
            cardEl.innerHTML = `<span>${val}</span>`;
            elements.placeSlots.appendChild(cardEl);
        }
    }
}

function renderDeckCards() {
    if (!elements.deckCards) return;
    
    elements.deckCards.innerHTML = '';
    
    const black = gameState.deck_black || 0;
    const white = gameState.deck_white || 0;
    // Use pre-shuffled deck if available and matches counts
    let cards = null;
    const total = black + white;
    if (preShuffledDeck && Array.isArray(preShuffledDeck) && preShuffledDeck.length === total) {
        cards = preShuffledDeck.slice(); // copy to avoid mutation
    } else {
        cards = [];
        for (let i = 0; i < black; i++) cards.push(0);
        for (let i = 0; i < white; i++) cards.push(1);

        // Shuffle
        for (let i = cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cards[i], cards[j]] = [cards[j], cards[i]];
        }
        // store as preShuffled if server hasn't provided one
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
    
    // 메시지로 승패 판단
    if (gameState.message?.includes('승리')) {
        elements.gameOverTitle.textContent = '🎉 승리!';
        elements.gameOverTitle.style.color = '#4ecca3';
    } else {
        elements.gameOverTitle.textContent = '💀 패배';
        elements.gameOverTitle.style.color = '#e94560';
    }
    
    elements.gameOverMessage.textContent = gameState.message || '게임 종료';
}

/**
 * SSE game_over 이벤트 데이터로 직접 게임 종료 모달 표시
 * @param {object} data - SSE에서 받은 game_over 데이터 {winner, message}
 */
function showGameOverWithData(data) {
    elements.gameOverOverlay?.classList.remove('hidden');
    
    // SSE 메시지로 승패 판단
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

/**
 * 상대방 연결 끊김 시 오버레이 표시
 * @param {string} message - 표시할 메시지
 */
function showDisconnectOverlay(message) {
    // SSE 연결 종료
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    
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

// AI 게임 버튼
document.getElementById('play-vs-ai-btn')?.addEventListener('click', () => createAIGame(true));
document.getElementById('play-vs-random-btn')?.addEventListener('click', () => createAIGame(false));

// Enter 키로 게임 참가
elements.gameIdInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinGame();
});

// ============== Title Cards ==============

function initTitleCards() {
    const blackCard = document.getElementById('title-card-black');
    const whiteCard = document.getElementById('title-card-white');
    const blackValue = document.getElementById('black-card-value');
    const whiteValue = document.getElementById('white-card-value');
    
    if (!blackCard || !whiteCard) return;
    
    blackValue.textContent = Math.floor(Math.random() * 12);
    whiteValue.textContent = Math.floor(Math.random() * 12);
    
    blackCard.addEventListener('click', () => blackCard.classList.toggle('flipped'));
    whiteCard.addEventListener('click', () => whiteCard.classList.toggle('flipped'));
}

// ============== Card Highlight ==============

function highlightMyCard(position, className) {
    const card = elements.playerHand?.querySelector(`[data-position="${position}"]`);
    if (card) {
        card.classList.add(className);
    }
}

function removeMyCardHighlight(position) {
    const card = elements.playerHand?.querySelector(`[data-position="${position}"]`);
    if (card) {
        card.classList.remove('guessed-correct', 'guessed-wrong');
    }
}

function flipMyCard(position) {
    const card = elements.playerHand?.querySelector(`[data-position="${position}"]`);
    if (card) {
        card.classList.add('flipping');
        // 애니메이션 끝나면 just-revealed 클래스로 교체
        setTimeout(() => {
            card.classList.remove('flipping');
            card.classList.add('just-revealed');
        }, 600);
    }
}

function flipOpponentCard(position, value = null) {
    const card = elements.opponentHand?.querySelector(`[data-position="${position}"]`);
    if (card) {
        card.classList.add('flipping');
        // 카드가 90도 회전했을 때 (300ms) 값을 업데이트
        if (value !== null) {
            setTimeout(() => {
                const valueEl = card.querySelector('.value');
                if (valueEl) {
                    valueEl.textContent = value === 12 ? '-' : value;
                }
                card.classList.add('revealed');
            }, 300);
        }
        // 애니메이션 끝나면 just-revealed 클래스로 교체
        setTimeout(() => {
            card.classList.remove('flipping');
            card.classList.add('just-revealed');
        }, 600);
    }
}

function highlightOpponentCard(position, className) {
    const card = elements.opponentHand?.querySelector(`[data-position="${position}"]`);
    if (card) {
        card.classList.add(className);
    }
}

function removeOpponentCardHighlight(position) {
    const card = elements.opponentHand?.querySelector(`[data-position="${position}"]`);
    if (card) {
        card.classList.remove('guessed-correct', 'guessed-wrong', 'guess-failed');
    }
}

function shakeOpponentCard(position) {
    const card = elements.opponentHand?.querySelector(`[data-position="${position}"]`);
    if (card) {
        card.classList.add('guess-failed');
        // 애니메이션 끝나면 클래스 제거
        setTimeout(() => {
            card.classList.remove('guess-failed');
        }, 800);
    }
}

function shakeMyCard(position) {
    const card = elements.playerHand?.querySelector(`[data-position="${position}"]`);
    if (card) {
        card.classList.add('guess-failed');
        // 애니메이션 끝나면 클래스 제거
        setTimeout(() => {
            card.classList.remove('guess-failed');
        }, 800);
    }
}

// ============== Init ==============

initTitleCards();
console.log('🎴 Da Vinci Code Game loaded (PvP + SSE)');
