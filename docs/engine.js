/**
 * Da Vinci Code — client-side engine (no backend).
 *
 * This file is the DATA LAYER. It ports, as literally as possible, the Python
 * server logic so that game.js (the UI) can call plain functions instead of an
 * HTTP API + SSE, while receiving byte-compatible JSON shapes / event payloads.
 *
 * Python sources ported here:
 *   app/game/constants.py, app/game/cards/*, app/game/hand.py, app/game/deck.py
 *   app/services/game_engine.py  (GameEngine + PendingCard)
 *   app/services/player.py        (HumanPlayer, AIPlayer + constraint matrix)
 *   app/schemas/observation.py    (Observation.from_engine + ActionMask.from_engine)
 *   app/core/model_loader.py      (get_action_with_reasoning: attention + belief)
 *   app/game/model.py             (get_action deterministic: masked argmax + phase gating)
 *   app/services/game_session.py  (_build_state)
 *   app/services/actions/*.py     (handlers: messages + emit shape)
 *   app/schemas/emitters/*.py     (exact SSE event payload fields + Korean strings)
 *   app/services/game_service.py  (execute_ai_turn orchestration + timings)
 *   app/api/game.py               (background AI trigger after human actions)
 *
 * The ONNX graph (model.onnx) is a pure tensor function exported from the same
 * checkpoint, plus two extra graph outputs (last_layer_src / last_layer_out)
 * that expose the last transformer layer's residual-stream input & output so the
 * attention-score reasoning panel can be reproduced exactly (no re-export from
 * the .pt checkpoint — weights are byte-identical, only outputs were annotated).
 */

(function (global) {
  'use strict';

  // ==================== constants.py ====================
  const MAX_HAND_SIZE = 13;
  const NUM_VALUES = 13;       // 0-11 + joker(12)
  const MASK_VALUE = -1e4;
  const JOKER = 12;            // CardValue.JOKER
  const HIDDEN = -1;           // CardValue.HIDDEN
  const NONE_VAL = -2;         // CardValue.NONE
  const COLOR_NONE = -1;       // Color.NONE
  const BLACK = 0, WHITE = 1;
  const Phase = { DRAW: 0, GUESS: 1, DECISION: 2 };
  const PhaseName = { 0: 'draw', 1: 'guess', 2: 'decision' };
  const INITIAL_HAND_SIZE = 4;

  // ==================== ONNX runtime ====================
  let session = null;
  let modelReady = null;

  async function loadModel(url = 'model.onnx') {
    if (modelReady) return modelReady;
    modelReady = (async () => {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.0/dist/';
      session = await ort.InferenceSession.create(url, { executionProviders: ['wasm'] });
      return session;
    })();
    return modelReady;
  }

  function f32(arr, dims) { return new ort.Tensor('float32', Float32Array.from(arr.flat(Infinity)), dims); }
  function i64(arr, dims) { return new ort.Tensor('int64', BigInt64Array.from(arr.map(BigInt)), dims); }

  async function runModel(obs, selectedPos) {
    const feeds = {
      phase: f32(obs.phase, [1, 3]),
      my_hand: f32(obs.my_hand, [1, MAX_HAND_SIZE, 2]),
      opponent_hand: f32(obs.opponent_hand, [1, MAX_HAND_SIZE, 2]),
      constraint_matrix: f32(obs.constraint_matrix, [1, MAX_HAND_SIZE, NUM_VALUES]),
      remaining_deck: f32(obs.remaining_deck, [1, 2]),
      selected_position: i64([selectedPos], [1]),
    };
    return session.run(feeds);
  }

  // ==================== Card (cards/card.py) ====================
  // A card is a plain object: { color: 0|1, value: 0..12, is_revealed: bool }
  function makeCard(color, value, is_revealed = false) {
    return { color, value, is_revealed };
  }
  const isJoker = (c) => c.value === JOKER;
  // Card.__lt__ : if either is joker -> True; else (value, color) tuple compare
  function cardLt(a, b) {
    if (isJoker(a) || isJoker(b)) return true;
    if (a.value !== b.value) return a.value < b.value;
    return a.color < b.color;
  }

  // ==================== Deck (deck.py) ====================
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function newDeck() {
    // 13 black (0-11 + joker) and 13 white, each pile shuffled separately, drawn via pop()
    const black = [], white = [];
    for (let v = 0; v <= JOKER; v++) { black.push(makeCard(BLACK, v)); white.push(makeCard(WHITE, v)); }
    shuffle(black); shuffle(white);
    return { black, white };
  }
  const deckBlackCount = (d) => d.black.length;
  const deckWhiteCount = (d) => d.white.length;
  const deckTotal = (d) => d.black.length + d.white.length;
  const deckIsEmpty = (d) => deckTotal(d) === 0;
  function deckHasColor(d, color) { return color === BLACK ? d.black.length > 0 : d.white.length > 0; }
  function deckDraw(d, color) {
    if (color === BLACK) return d.black.length ? d.black.pop() : null;
    if (color === WHITE) return d.white.length ? d.white.pop() : null;
    return null;
  }
  function deckRemaining(d) { return [deckBlackCount(d), deckWhiteCount(d)]; }
  // Deck.initial_draw: each card independently 50% black/white; fall back to other color
  function deckInitialDraw(d, count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      let color = Math.random() < 0.5 ? BLACK : WHITE;
      let card = deckDraw(d, color);
      if (card === null) card = deckDraw(d, color === BLACK ? WHITE : BLACK);
      if (card === null) return null;
      out.push(card);
    }
    return out;
  }

  // ==================== Hand (hand.py) ====================
  // A hand is an array of cards (+ tracked last_drawn_card reference).
  function newHand() { const h = []; h.last_drawn_card = null; return h; }

  // _get_insert_position (used by add_card / add_initial_cards)
  function getInsertPosition(hand, card) {
    if (isJoker(card) || hand.length === 0) {
      return Math.floor(Math.random() * (hand.length + 1));
    }
    let left_idx = -1, right_idx = hand.length;
    for (let i = 0; i < hand.length; i++) {
      const c = hand[i];
      if (!isJoker(c) && cardLt(c, card)) left_idx = i;
    }
    for (let i = 0; i < hand.length; i++) {
      const c = hand[i];
      if (!isJoker(c) && cardLt(card, c)) { right_idx = i; break; }
    }
    const candidates = [];
    for (let p = left_idx + 1; p <= right_idx; p++) candidates.push(p);
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function handAddCard(hand, card) {
    hand.last_drawn_card = card;
    const pos = getInsertPosition(hand, card);
    hand.splice(pos, 0, card);
    return pos;
  }

  // add_pending_card: insert at exact position (used by place)
  function handAddPending(hand, card, position) {
    hand.last_drawn_card = card;
    hand.splice(position, 0, card);
    return position;
  }

  // add_initial_cards: normal cards sorted by (value,color) then inserted; jokers random; reset last_drawn
  function handAddInitial(hand, cards) {
    const normal = cards.filter(c => !isJoker(c));
    const jokers = cards.filter(c => isJoker(c));
    normal.sort((a, b) => a.value !== b.value ? a.value - b.value : a.color - b.color);
    for (const c of normal) handAddCard(hand, c);
    for (const j of jokers) handAddCard(hand, j);
    hand.last_drawn_card = null;
  }

  // _is_valid_position
  function isValidPosition(hand, newCard, pos) {
    const n = hand.length;
    let left_bound = null; // [value,color]
    for (let i = pos - 1; i >= 0; i--) {
      if (!isJoker(hand[i])) { left_bound = [hand[i].value, hand[i].color]; break; }
    }
    let right_bound = null;
    for (let i = pos; i < n; i++) {
      if (!isJoker(hand[i])) { right_bound = [hand[i].value, hand[i].color]; break; }
    }
    const new_val = newCard.value, new_col = newCard.color;
    if (left_bound) {
      const [lv, lc] = left_bound;
      if (new_val < lv) return false;
      if (new_val === lv && new_col <= lc) return false;
    }
    if (right_bound) {
      const [rv, rc] = right_bound;
      if (new_val > rv) return false;
      if (new_val === rv && new_col >= rc) return false;
    }
    return true;
  }

  // _find_valid_positions
  function findValidPositions(hand, newCard) {
    if (isJoker(newCard)) {
      const arr = []; for (let i = 0; i <= hand.length; i++) arr.push(i); return arr;
    }
    const n = hand.length;
    if (n === 0) return [0];
    const valid = [];
    for (let pos = 0; pos <= n; pos++) if (isValidPosition(hand, newCard, pos)) valid.push(pos);
    return valid;
  }

  const handAllRevealed = (hand) => hand.length > 0 && hand.every(c => c.is_revealed);

  // to_observation (hidden flag): [color,value] or [color, HIDDEN] if hidden && !revealed
  function handToObservation(hand, hidden) {
    const obs = [];
    for (let i = 0; i < MAX_HAND_SIZE; i++) {
      if (i < hand.length) {
        const c = hand[i];
        if (hidden && !c.is_revealed) obs.push([c.color, HIDDEN]);
        else obs.push([c.color, c.value]);
      } else {
        obs.push([COLOR_NONE, NONE_VAL]);
      }
    }
    return obs;
  }

  // to_opponent_view: returns array of cards as opponent sees them (hidden -> value HIDDEN)
  // We model this as plain card-like objects; reveal status preserved.
  function handToOpponentView(hand) {
    const view = [];
    view.last_drawn_card = null;
    for (const c of hand) {
      if (c.is_revealed) {
        view.push(c);
        if (c === hand.last_drawn_card) view.last_drawn_card = c;
      } else {
        const opp = makeCard(c.color, HIDDEN, false);
        view.push(opp);
        if (c === hand.last_drawn_card) view.last_drawn_card = opp;
      }
    }
    return view;
  }

  // ==================== Players (player.py) ====================
  function makeHumanPlayer(id) {
    return {
      id, type: 'human', player_index: null, hand: newHand(),
      pending_card: null, opponent: null,
    };
  }

  function makeAIPlayer(id, useModel) {
    return {
      id, type: 'ai', player_index: null, hand: newHand(),
      pending_card: null, opponent: null,
      useModel: useModel,
      // constraint matrix: (MAX_HAND_SIZE, NUM_VALUES) filled with -1
      cm: Array.from({ length: MAX_HAND_SIZE }, () => new Array(NUM_VALUES).fill(-1)),
      _last_reasoning: null,
    };
  }
  const isAI = (p) => p && p.type === 'ai';

  // Constraint-matrix updates (AIPlayer methods)
  function cmReset(p) { for (const row of p.cm) row.fill(-1); }
  function cmInitInitial(p, n) { for (let i = 0; i < n; i++) p.cm[i].fill(0); }
  function cmRecordFailedGuess(p, position, value) {
    if (position >= 0 && position < MAX_HAND_SIZE && value >= 0 && value < NUM_VALUES) {
      p.cm[position][value] = 1;
    }
  }
  function cmRecordRevealed(p, position) {
    if (position >= 0 && position < MAX_HAND_SIZE) p.cm[position].fill(1);
  }
  // np.insert row of zeros at position, then truncate to MAX_HAND_SIZE rows
  function cmUpdateForNewCard(p, position) {
    const nrows = MAX_HAND_SIZE;
    position = Math.max(0, Math.min(position, nrows));
    p.cm.splice(position, 0, new Array(NUM_VALUES).fill(0));
    if (p.cm.length > nrows) p.cm = p.cm.slice(0, nrows);
  }

  // ==================== GameEngine (game_engine.py) ====================
  function makeEngine(players, gameId) {
    const e = {
      id: gameId,
      players,                 // [p0, p1]  (p0 = human/first, p1 = AI)
      play_order: players.slice(),
      deck: newDeck(),
      phase: Phase.DRAW,
      current_player: players[0],
      pending_card: null,      // { color, value, valid_positions }
      game_over: false,
      winner: null,
      is_started: false,
    };
    return e;
  }
  const playerIndex = (e) => e.play_order.indexOf(e.current_player);
  const opponentPlayer = (e) => e.play_order[(playerIndex(e) + 1) % 2];
  const getPlayerById = (e, id) => e.players.find(p => p.id === id);
  const getOpponentById = (e, id) => getPlayerById(e, id).opponent;

  function engineSetup(e) {
    e.players[0].opponent = e.players[1];
    e.players[1].opponent = e.players[0];
    const p0c = deckInitialDraw(e.deck, INITIAL_HAND_SIZE);
    const p1c = deckInitialDraw(e.deck, INITIAL_HAND_SIZE);
    handAddInitial(e.players[0].hand, p0c);
    handAddInitial(e.players[1].hand, p1c);
    for (const p of e.players) {
      if (isAI(p)) { cmReset(p); cmInitInitial(p, INITIAL_HAND_SIZE); }
    }
    e.current_player = e.play_order[0];
    e.is_started = true;
    e.phase = Phase.DRAW;
  }

  // draw
  function engineDraw(e, playerId, color) {
    validateTurn(e, playerId);
    const player = getPlayerById(e, playerId);
    if (e.phase !== Phase.DRAW) throw new Error('Invalid phase');
    if (!deckHasColor(e.deck, color)) throw new Error('No cards of that color remaining');
    const card = deckDraw(e.deck, color);
    const valid_positions = findValidPositions(e.current_player.hand, card);
    const pending = { color: card.color, value: card.value, valid_positions };
    e.pending_card = pending;
    player.pending_card = pending;
    return { pending_card: pending };
  }

  // place
  function enginePlace(e, playerId, color, number, position) {
    validateTurn(e, playerId);
    const player = getPlayerById(e, playerId);
    const pending = e.pending_card;
    if (!pending) throw new Error('No pending card to place');
    if (pending.color !== color || pending.value !== number) throw new Error('카드 정보 불일치');
    if (!pending.valid_positions.includes(position)) throw new Error('Invalid position');
    const card = makeCard(pending.color, pending.value, false);
    handAddPending(player.hand, card, position);
    player.pending_card = null;
    const opponent = getOpponentById(e, playerId);
    if (isAI(opponent)) cmUpdateForNewCard(opponent, position);
    e.pending_card = null;
    e.phase = Phase.GUESS;
    return { placed_card: card, position };
  }

  // guess
  function engineGuess(e, playerId, targetPosition, guessedValue) {
    validateTurn(e, playerId);
    const player = getPlayerById(e, playerId);
    if (e.phase !== Phase.GUESS) throw new Error('Invalid phase');
    const targetHand = opponentPlayer(e).hand;
    if (targetPosition < 0 || targetPosition >= targetHand.length) throw new Error('Invalid target position');
    const targetCard = targetHand[targetPosition];
    if (targetCard.is_revealed) throw new Error('Cannot guess already revealed card');

    const correct = targetCard.value === guessedValue;
    let result;
    if (correct) {
      targetCard.is_revealed = true;
      if (isAI(player)) cmRecordRevealed(player, targetPosition);
      result = { card: targetCard, position: targetPosition, guessed_value: String(guessedValue), is_correct: true, revealed_position: -1 };
      e.phase = Phase.DECISION;
      if (handAllRevealed(targetHand)) endGame(e, e.current_player);
    } else {
      if (isAI(player)) cmRecordFailedGuess(player, targetPosition, guessedValue);
      const revealedIndex = revealDrawnCard(e);
      const revealedCard = e.current_player.hand[revealedIndex];
      const opponent = getOpponentById(e, player.id);
      if (isAI(opponent)) cmRecordRevealed(opponent, revealedIndex);
      result = { card: revealedCard, position: targetPosition, guessed_value: String(guessedValue), is_correct: false, revealed_position: revealedIndex };
      if (handAllRevealed(e.current_player.hand)) endGame(e, opponentPlayer(e));
      else endTurn(e);
    }
    return result;
  }

  function revealDrawnCard(e) {
    const hand = e.current_player.hand;
    if (hand.last_drawn_card && !hand.last_drawn_card.is_revealed) {
      hand.last_drawn_card.is_revealed = true;
      return hand.indexOf(hand.last_drawn_card);
    }
    return revealRandomHidden(e);
  }
  function revealRandomHidden(e) {
    const hand = e.current_player.hand;
    const hidden = [];
    for (let i = 0; i < hand.length; i++) if (!hand[i].is_revealed) hidden.push(i);
    if (hidden.length === 0) throw new Error('No hidden cards to reveal');
    const idx = hidden[Math.floor(Math.random() * hidden.length)];
    hand[idx].is_revealed = true;
    return idx;
  }

  // decision
  function engineDecision(e, playerId, continueGuessing) {
    if (e.phase !== Phase.DECISION) throw new Error('Invalid phase');
    if (continueGuessing) e.phase = Phase.GUESS;
    else endTurn(e);
  }

  function endTurn(e) {
    e.current_player.hand.last_drawn_card = null;
    e.current_player = opponentPlayer(e);
    e.phase = deckIsEmpty(e.deck) ? Phase.GUESS : Phase.DRAW;
  }
  function endGame(e, winner) { e.game_over = true; e.winner = winner; }
  function validateTurn(e, playerId) {
    if (!e.is_started) throw new Error('게임이 아직 시작되지 않았습니다.');
    if (e.current_player.id !== playerId) throw new Error('당신의 차례가 아닙니다.');
  }

  // ==================== Observation (observation.py) ====================
  function buildObservation(e, playerId) {
    const phase = [0, 0, 0]; phase[e.phase] = 1;
    const player = getPlayerById(e, playerId);
    const my_hand = handToObservation(player.hand, false);
    const opp_hand = handToObservation(player.opponent.hand, true);
    let constraint_matrix;
    if (isAI(player)) constraint_matrix = player.cm.map(r => r.slice());
    else constraint_matrix = Array.from({ length: MAX_HAND_SIZE }, () => new Array(NUM_VALUES).fill(0));
    const remaining_deck = deckRemaining(e.deck);
    return { phase, my_hand, opponent_hand: opp_hand, constraint_matrix, remaining_deck };
  }

  // ActionMask.from_engine (color/position/value/decision)
  function buildActionMask(e, playerId) {
    const player = getPlayerById(e, playerId);
    const opponent_hand = player.opponent.hand;       // raw cards
    const my_hand = player.hand;

    const color = [deckBlackCount(e.deck) > 0, deckWhiteCount(e.deck) > 0];

    const position = new Array(MAX_HAND_SIZE).fill(false);
    for (let i = 0; i < opponent_hand.length; i++) {
      const card = opponent_hand[i];
      if (card && !card.is_revealed) position[i] = true;
    }

    const blackConfirmed = new Array(NUM_VALUES).fill(false);
    const whiteConfirmed = new Array(NUM_VALUES).fill(false);
    for (const card of my_hand) {
      if (card) (card.color === BLACK ? blackConfirmed : whiteConfirmed)[card.value] = true;
    }
    for (const card of opponent_hand) {
      if (card && card.is_revealed) (card.color === BLACK ? blackConfirmed : whiteConfirmed)[card.value] = true;
    }

    const value = Array.from({ length: MAX_HAND_SIZE }, () => new Array(NUM_VALUES).fill(true));
    for (let i = 0; i < opponent_hand.length; i++) {
      const card = opponent_hand[i];
      if (!card || card.is_revealed) continue;
      // Step 1: confirmed (color+value) masked
      const conf = card.color === BLACK ? blackConfirmed : whiteConfirmed;
      for (let v = 0; v < NUM_VALUES; v++) value[i][v] = !conf[v];

      // Step 2: sort-order range constraint from revealed non-joker neighbours
      let left_val = null, left_col = null;
      for (let j = i - 1; j >= 0; j--) {
        const adj = j < opponent_hand.length ? opponent_hand[j] : null;
        if (adj && adj.is_revealed && !isJoker(adj)) { left_val = adj.value; left_col = adj.color; break; }
      }
      let right_val = null, right_col = null;
      for (let j = i + 1; j < opponent_hand.length; j++) {
        const adj = opponent_hand[j];
        if (adj && adj.is_revealed && !isJoker(adj)) { right_val = adj.value; right_col = adj.color; break; }
      }
      if (left_val !== null || right_val !== null) {
        const hc = card.color;
        for (let v = 0; v < NUM_VALUES - 1; v++) {
          if (!value[i][v]) continue;
          if (left_val !== null) {
            if (v < left_val || (v === left_val && hc <= left_col)) { value[i][v] = false; continue; }
          }
          if (right_val !== null) {
            if (v > right_val || (v === right_val && hc >= right_col)) value[i][v] = false;
          }
        }
      }
      // Safety: at least one valid value; fall back to step1, else allow all
      if (!value[i].some(Boolean)) {
        const step1 = conf.map(x => !x);
        value[i] = step1.some(Boolean) ? step1 : new Array(NUM_VALUES).fill(true);
      }
    }

    const decision = [true, true];
    return { color, position, value, decision };
  }

  // ==================== get_action (model.py, deterministic) ====================
  function maskedArgmax(logits, mask) {
    let best = -Infinity, idx = 0;
    for (let i = 0; i < logits.length; i++) {
      const v = (mask && !mask[i]) ? MASK_VALUE : logits[i];
      if (v > best) { best = v; idx = i; }
    }
    return idx;
  }

  // Returns {color, position, value, decision} actions (deterministic argmax, masked, phase-gated)
  async function getAction(e, playerId) {
    const obs = buildObservation(e, playerId);
    const mask = buildActionMask(e, playerId);
    const r1 = await runModel(obs, 0);
    const colorLogits = Array.from(r1.color_logits.data);
    const posLogits = Array.from(r1.position_logits.data);
    const decLogits = Array.from(r1.decision_logits.data);

    const colorAction = maskedArgmax(colorLogits, mask.color);
    const positionAction = maskedArgmax(posLogits, mask.position);
    const decisionAction = maskedArgmax(decLogits, mask.decision);

    // value head conditioned on chosen position (2nd run)
    const r2 = await runModel(obs, positionAction);
    const valLogits = Array.from(r2.value_logits.data);
    const valueAction = maskedArgmax(valLogits, mask.value[positionAction]);

    return { color: colorAction, position: positionAction, value: valueAction, decision: decisionAction,
             stateValue: Array.from(r1.value.data)[0] };
  }

  // ==================== get_action_with_reasoning (model_loader.py) ====================
  // Reproduces attention_scores (41) + belief_probs (13x13) exactly.
  async function getActionWithReasoning(e, playerId) {
    const obs = buildObservation(e, playerId);
    const mask = buildActionMask(e, playerId);

    const r1 = await runModel(obs, 0);
    const posLogits = Array.from(r1.position_logits.data);
    const position = maskedArgmax(posLogits, mask.position);

    const r2 = await runModel(obs, position);
    const valLogits = Array.from(r2.value_logits.data);
    const value = maskedArgmax(valLogits, mask.value[position]);

    // ----- attention scores -----
    const D = 128, T = 42;
    const src = r1.last_layer_src.data;   // (1,42,128)
    const out = r1.last_layer_out.data;
    const rowOf = (buf, idx) => { const o = idx * D, v = new Float32Array(D); for (let k = 0; k < D; k++) v[k] = buf[o + k]; return v; };
    const normVec = (v) => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s); const r = new Float32Array(v.length); for (let i = 0; i < v.length; i++) r[i] = s > 0 ? v[i] / s : 0; return r; };

    let scores = new Array(41).fill(0);
    const oppTokenIdx = 1 + MAX_HAND_SIZE + position; // CLS + 13 my + pos
    const targetOut = normVec(rowOf(out, oppTokenIdx));
    let raw = new Array(41).fill(0);
    for (let t = 1; t < T; t++) {
      const s = normVec(rowOf(src, t));
      let dot = 0; for (let k = 0; k < D; k++) dot += targetOut[k] * s[k];
      raw[t - 1] = dot;
    }
    const cardTokens = 2 * MAX_HAND_SIZE; // 26
    const selfIdxNoCls = oppTokenIdx - 1;
    let minCard = Infinity; for (let i = 0; i < cardTokens; i++) if (raw[i] < minCard) minCard = raw[i];
    raw[selfIdxNoCls] = minCard;
    let sMin = Infinity, sMax = -Infinity;
    for (let i = 0; i < cardTokens; i++) { if (raw[i] < sMin) sMin = raw[i]; if (raw[i] > sMax) sMax = raw[i]; }
    if (sMax - sMin > 1e-6) scores = raw.map(x => (x - sMin) / (sMax - sMin));
    else scores = raw.map(() => 0);

    // ----- belief probs -----
    const bl = r1.belief_logits.data; // (1,13,13)
    const softmax = (arr) => { const m = Math.max(...arr); const ex = arr.map(x => Math.exp(x - m)); const s = ex.reduce((a, b) => a + b, 0); return ex.map(x => x / s); };
    const myHandObs = obs.my_hand, oppHandObs = obs.opponent_hand;
    const myKnown = [], oppRevealed = [];
    for (const c of myHandObs) if (c[1] >= 0) myKnown.push([c[0], c[1]]);
    for (const c of oppHandObs) if (c[1] >= 0) oppRevealed.push([c[0], c[1]]);
    const belief = [];
    for (let pos = 0; pos < 13; pos++) {
      const rowL = []; for (let v = 0; v < 13; v++) rowL.push(bl[pos * 13 + v]);
      let p = softmax(rowL);
      const posColor = oppHandObs[pos][0], posValue = oppHandObs[pos][1];
      if (posValue === NONE_VAL) { belief.push(new Array(13).fill(0)); continue; }
      if (posValue >= 0) { const z = new Array(13).fill(0); z[posValue] = 1; belief.push(z); continue; }
      const impossible = new Set();
      for (const [cl, v] of myKnown) if (cl === posColor) impossible.add(v);
      for (const [cl, v] of oppRevealed) if (cl === posColor) impossible.add(v);
      for (const v of impossible) if (v >= 0 && v <= 12) p[v] = 0;
      let sum = p.reduce((a, b) => a + b, 0);
      if (sum > 1e-8) p = p.map(x => x / sum);
      belief.push(p);
    }

    return { position, value, attention_scores: scores, belief_probs: belief };
  }

  // expose to game.js
  global.DVEngine = {
    // constants
    MAX_HAND_SIZE, NUM_VALUES, JOKER, HIDDEN, NONE_VAL, BLACK, WHITE, Phase, PhaseName, INITIAL_HAND_SIZE,
    // onnx
    loadModel,
    // builders
    makeHumanPlayer, makeAIPlayer, makeEngine, engineSetup,
    engineDraw, enginePlace, engineGuess, engineDecision,
    getPlayerById, getOpponentById, opponentPlayer, playerIndex,
    handToOpponentView, handAllRevealed,
    buildObservation, buildActionMask,
    getAction, getActionWithReasoning,
    isAI, deckIsEmpty, deckBlackCount, deckWhiteCount,
  };
})(window);
