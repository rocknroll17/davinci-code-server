/* Da Vinci Code — client-side ONNX inference spike.
 *
 * Ports the MINIMUM Python game logic needed to drive the model:
 *   - observation builder  (from app/schemas/observation.py Observation.from_engine)
 *   - action-mask builder   (from app/schemas/observation.py ActionMask.from_engine,
 *                            incl. the sort-order range constraint)
 *   - constraint matrix      (-1 absent slot, 0 unknown, 1 ruled-out value)
 *   - phase gating + masked argmax  (from model.py get_action, deterministic=True)
 *
 * ONNX graph (model.onnx) is a PURE tensor function:
 *   in : phase, my_hand, opponent_hand, constraint_matrix, remaining_deck, selected_position
 *   out: color_logits, position_logits, value_logits(@pos), decision_logits, belief_logits, value
 * Two runs per GUESS: run#1 (pos=0) -> argmax position; run#2 (pos=pos*) -> read value.
 */

const HAND = 13, NV = 13, MASK = -1e4;
const BLACK = 0, WHITE = 1;
const DRAW = 0, GUESS = 1, DECISION = 2;
const $ = id => document.getElementById(id);
const log = (m) => { const l = $('log'); l.textContent += m + '\n'; l.scrollTop = l.scrollHeight; };

let session = null;
let game = null;

/* ---------- ONNX runtime ---------- */
async function initModel() {
  // WASM backend, single-thread (GitHub Pages can't set COOP/COEP for threads).
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.0/dist/';
  session = await ort.InferenceSession.create('model.onnx', {
    executionProviders: ['wasm'],
  });
  $('status').textContent = 'Model loaded. Click "AI take a turn".';
}

function f32(arr, dims) { return new ort.Tensor('float32', Float32Array.from(arr.flat(Infinity)), dims); }
function i64(arr, dims) { return new ort.Tensor('int64', BigInt64Array.from(arr.map(BigInt)), dims); }

async function runModel(obs, selectedPos) {
  const feeds = {
    phase: f32(obs.phase, [1, 3]),
    my_hand: f32(obs.my_hand, [1, HAND, 2]),
    opponent_hand: f32(obs.opponent_hand, [1, HAND, 2]),
    constraint_matrix: f32(obs.constraint_matrix, [1, HAND, NV]),
    remaining_deck: f32(obs.remaining_deck, [1, 2]),
    selected_position: i64([selectedPos], [1]),
  };
  const r = await session.run(feeds);
  const toArr = t => Array.from(r[t].data);
  return {
    color: toArr('color_logits'),
    position: toArr('position_logits'),
    value: toArr('value_logits'),
    decision: toArr('decision_logits'),
    value_state: toArr('value'),
  };
}

/* ---------- game state ----------
 * A card: {color:0|1, value:0..12, revealed:bool}. Hands kept sorted ascending,
 * ties broken BLACK before WHITE (Da Vinci Code ordering). value 12 = joker.
 */
function newDeck() {
  const d = [];
  for (let v = 0; v <= 12; v++) { d.push({ color: BLACK, value: v }); d.push({ color: WHITE, value: v }); }
  for (let i = d.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
function cmp(a, b) { return a.value !== b.value ? a.value - b.value : a.color - b.color; }
function sortHand(h) { h.sort(cmp); }

function newGame() {
  const deck = newDeck();
  const draw = () => deck.pop();
  const ai = [], me = [];
  for (let i = 0; i < 4; i++) { ai.push({ ...draw(), revealed: false }); me.push({ ...draw(), revealed: false }); }
  sortHand(ai); sortHand(me);
  // constraint matrix the AI keeps about MY hand: -1 absent, 0 unknown, 1 ruled out
  const cm = Array.from({ length: HAND }, () => new Array(NV).fill(-1));
  for (let i = 0; i < me.length; i++) cm[i].fill(0);
  return { deck, ai, me, cm, over: false };
}

function remainingDeck(g) {
  let b = 0, w = 0;
  for (const c of g.deck) (c.color === BLACK ? b++ : w++);
  return [b, w];
}

/* ---------- observation builder (mirrors Observation.from_engine) ----------
 * "my_hand" from the AI's view = the AI's own cards (fully known).
 * "opponent_hand" = MY cards; hidden ones get value -1.
 */
function buildObs(g) {
  const phase = [0, 0, 0]; phase[GUESS] = 1;
  const my = [], opp = [];
  for (let i = 0; i < HAND; i++) {
    if (i < g.ai.length) my.push([g.ai[i].color, g.ai[i].value]);
    else my.push([-1, -2]);
  }
  for (let i = 0; i < HAND; i++) {
    if (i < g.me.length) {
      const c = g.me[i];
      opp.push([c.color, c.revealed ? c.value : -1]);
    } else opp.push([-1, -2]);
  }
  return { phase, my_hand: my, opponent_hand: opp, constraint_matrix: g.cm, remaining_deck: remainingDeck(g) };
}

/* ---------- action masks (mirrors ActionMask.from_engine) ---------- */
function buildMasks(g) {
  const opp = g.me, mine = g.ai;
  const positionMask = new Array(HAND).fill(false);
  for (let i = 0; i < opp.length; i++) if (!opp[i].revealed) positionMask[i] = true;

  const blackConfirmed = new Array(NV).fill(false);
  const whiteConfirmed = new Array(NV).fill(false);
  const mark = c => { (c.color === BLACK ? blackConfirmed : whiteConfirmed)[c.value] = true; };
  for (const c of mine) mark(c);
  for (const c of opp) if (c.revealed) mark(c);

  const valueMask = Array.from({ length: HAND }, () => new Array(NV).fill(true));
  for (let i = 0; i < opp.length; i++) {
    const card = opp[i];
    if (card.revealed) continue;
    const conf = card.color === BLACK ? blackConfirmed : whiteConfirmed;
    for (let v = 0; v < NV; v++) valueMask[i][v] = !conf[v];

    // sort-order range constraint from revealed non-joker neighbours
    let left = null, right = null;
    for (let j = i - 1; j >= 0; j--) { const a = opp[j]; if (a.revealed && a.value !== 12) { left = a; break; } }
    for (let j = i + 1; j < opp.length; j++) { const a = opp[j]; if (a.revealed && a.value !== 12) { right = a; break; } }
    if (left || right) {
      const hc = card.color;
      for (let v = 0; v < NV - 1; v++) {
        if (!valueMask[i][v]) continue;
        if (left && (v < left.value || (v === left.value && hc <= left.color))) { valueMask[i][v] = false; continue; }
        if (right && (v > right.value || (v === right.value && hc >= right.color))) valueMask[i][v] = false;
      }
    }
    if (!valueMask[i].some(Boolean)) {
      const step1 = conf.map(x => !x);
      valueMask[i] = step1.some(Boolean) ? step1 : new Array(NV).fill(true);
    }
  }
  return { position: positionMask, value: valueMask };
}

/* ---------- masked argmax + phase gating (mirrors get_action deterministic) ---------- */
function maskedArgmax(logits, mask) {
  let best = -Infinity, idx = 0;
  for (let i = 0; i < logits.length; i++) {
    const v = (mask && !mask[i]) ? MASK : logits[i];
    if (v > best) { best = v; idx = i; }
  }
  return idx;
}

/* ---------- AI turn: GUESS one hidden card of the human ---------- */
async function aiTurn() {
  if (game.over) return;
  const obs = buildObs(game);
  const masks = buildMasks(game);

  if (!masks.position.some(Boolean)) { endGame('AI has revealed all your cards. AI wins!'); return; }

  // run #1 — read position logits (selected_position arbitrary=0)
  const r1 = await runModel(obs, 0);
  const pos = maskedArgmax(r1.position, masks.position);

  // run #2 — value head conditioned on chosen position
  const r2 = await runModel(obs, pos);
  const val = maskedArgmax(r2.value, masks.value[pos]);

  const target = game.me[pos];
  log(`AI guesses your slot ${pos} (a ${target.color === BLACK ? 'B' : 'W'} card) = ${val === 12 ? 'Joker' : val}  [V(s)=${r1.value_state[0].toFixed(2)}]`);

  if (target.value === val) {
    target.revealed = true;
    log('  -> CORRECT. Your card is revealed.');
    // update constraint matrix: whole row known/revealed
    game.cm[pos].fill(1);
    if (game.me.every(c => c.revealed)) { render(); endGame('AI revealed all your cards. AI wins!'); return; }
  } else {
    log('  -> WRONG. AI draws a card and ends its turn.');
    game.cm[pos][val] = 1; // record failed guess
    if (game.deck.length) {
      game.ai.push({ ...game.deck.pop(), revealed: false });
      sortHand(game.ai);
    }
  }
  render();
}

function endGame(msg) { game.over = true; $('status').textContent = msg; log('=== ' + msg + ' ==='); $('step').disabled = true; }

/* ---------- rendering ---------- */
function cardDiv(c, faceUpForViewer) {
  const d = document.createElement('div');
  d.className = 'card ' + (c.color === BLACK ? 'black' : 'white');
  if (faceUpForViewer || c.revealed) d.textContent = c.value === 12 ? 'J' : c.value;
  else { d.textContent = '?'; d.classList.add('hidden'); }
  return d;
}
function render() {
  const ah = $('ai-hand'); ah.innerHTML = '';
  for (const c of game.ai) ah.appendChild(cardDiv(c, c.revealed)); // AI cards hidden from you unless revealed
  const mh = $('my-hand'); mh.innerHTML = '';
  for (const c of game.me) mh.appendChild(cardDiv(c, true)); // you see your own; faded = still hidden from AI
}

/* ---------- wire up ---------- */
$('step').addEventListener('click', () => aiTurn());
$('reset').addEventListener('click', () => { game = newGame(); game.over = false; $('step').disabled = false; $('status').textContent = 'New game. Click "AI take a turn".'; $('log').textContent = ''; render(); });

(async () => {
  try {
    await initModel();
    game = newGame();
    render();
  } catch (e) {
    $('status').textContent = 'Init failed: ' + e.message;
    log('ERROR: ' + e.stack);
  }
})();
