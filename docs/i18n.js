/**
 * i18n.js — tiny dictionary-based i18n for the static demo (no dependencies).
 *
 * Usage:
 *   - Static DOM text: add data-i18n="key" to the element; applyI18n() swaps
 *     innerHTML from the dictionary on load and on toggle.
 *   - Dynamic JS text: call I18N.t('key', {param: value}); '{param}' in the
 *     string is substituted.
 *   - Language: localStorage 'dvc_lang' > browser language; toggled by the
 *     #lang-toggle button. Toggling fires a 'dvc:langchange' event so game
 *     code can re-render dynamic UI.
 *
 * To add/change copy, edit ONLY the dictionary below — both languages live
 * side by side per key so a missing translation is obvious at a glance.
 */
(function () {
    'use strict';

    const STRINGS = {
        // ---- static page (index.html data-i18n keys) ----
        docTitle:        { ko: 'DaVinci Code — AI 대전', en: 'DaVinci Code — Play vs AI' },
        aiSection:       { ko: '🤖 AI 대전', en: '🤖 Play vs AI' },
        playVsAi:        { ko: 'AI와 대전하기', en: 'Play against the AI' },
        rulesTitle:      { ko: '📖 게임 규칙', en: '📖 Rules' },
        rule1:           { ko: '<strong>카드:</strong> 검정(0-11) + 하양(0-11) + 조커(-, 각 1장) = 26장', en: '<strong>Cards:</strong> black (0-11) + white (0-11) + jokers (-, one each) = 26 cards' },
        rule2:           { ko: '<strong>정렬:</strong> 카드는 항상 숫자 오름차순 (같으면 검정 우선)', en: '<strong>Order:</strong> cards always sit in ascending order (black first on ties)' },
        rule3:           { ko: '<strong>진행:</strong> 덱에서 카드를 뽑은 뒤, 상대 숨겨진 카드의 숫자를 추측', en: '<strong>Play:</strong> draw a card, then guess the number on one of your opponent\'s hidden cards' },
        rule4:           { ko: '<strong>성공:</strong> 맞히면 상대 카드 공개 + 계속 추측 가능', en: '<strong>Hit:</strong> a correct guess reveals the card and you may keep guessing' },
        rule5:           { ko: '<strong>실패:</strong> 틀리면 내가 뽑은 카드가 공개됨', en: '<strong>Miss:</strong> a wrong guess reveals the card you drew' },
        rule6:           { ko: '<strong>승리:</strong> 상대 모든 카드를 먼저 공개시키면 승리!', en: '<strong>Win:</strong> reveal all of your opponent\'s cards first!' },
        phaseLabel:      { ko: '페이즈:', en: 'Phase:' },
        startPrompt:     { ko: '게임을 시작하세요', en: 'Start a game' },
        oppHand:         { ko: '🎭 상대방', en: '🎭 Opponent\'s hand' },
        myHand:          { ko: '👤 나', en: '👤 My hand' },
        drawTitle:       { ko: '🃏 카드 뽑기', en: '🃏 Draw a card' },
        drawHint:        { ko: '덱에서 원하는 색상의 카드를 클릭하세요', en: 'Click a deck card of the color you want' },
        jokerPlaceTitle: { ko: '🃏 조커 위치 선택', en: '🃏 Place the joker' },
        jokerPlaceHint:  { ko: '조커를 놓을 위치를 클릭하세요 (카드 사이의 슬롯)', en: 'Click a slot between your cards to place the joker' },
        placeTitle:      { ko: '📍 카드 배치 위치 선택', en: '📍 Place the card' },
        placeHint:       { ko: '카드를 놓을 위치를 클릭하세요', en: 'Click where you want to place the card' },
        guessTitle:      { ko: '🔮 카드 추측하기', en: '🔮 Guess a card' },
        guessHint:       { ko: '상대 카드를 클릭하여 선택 후 숫자를 맞춰보세요', en: 'Click an opponent card, then pick a number' },
        numberLabel:     { ko: '숫자:', en: 'Number:' },
        guessBtn:        { ko: '🎯 추측!', en: '🎯 Guess!' },
        decisionTitle:   { ko: '🤔 계속할까요?', en: '🤔 Continue?' },
        decisionHint:    { ko: '맞았습니다! 계속 추측하시겠습니까?', en: 'Correct! Do you want to keep guessing?' },
        continueBtn:     { ko: '✅ 계속 추측', en: '✅ Keep guessing' },
        stopBtn:         { ko: '🛑 턴 종료', en: '🛑 End turn' },
        oppTurnTitle:    { ko: '🎭 상대방 차례', en: '🎭 Opponent\'s turn' },
        oppActing:       { ko: '상대방이 행동 중입니다...', en: 'Opponent is thinking...' },
        gameOverTitle:   { ko: '게임 종료', en: 'Game over' },
        resultDefault:   { ko: '결과', en: 'Result' },
        newGame:         { ko: '🔄 새 게임', en: '🔄 New game' },

        // ---- dynamic messages (game.js) ----
        waitingPlayers:   { ko: '플레이어 대기 중...', en: 'Waiting for players...' },
        drawPrompt:       { ko: '검정 또는 흰색 카드를 뽑으세요.', en: 'Draw a black or white card.' },
        gameStarted:      { ko: '게임이 시작되었습니다!', en: 'The game has started!' },
        winMsg:           { ko: '🎉 축하합니다! 당신이 승리했습니다!', en: '🎉 Congratulations, you win!' },
        loseMsg:          { ko: '😢 아쉽습니다. 상대방이 승리했습니다.', en: '😢 You lost — the opponent wins.' },
        loseRetry:        { ko: '😢 아쉽습니다. 다음에 다시 도전하세요!', en: '😢 You lost — try again!' },
        waitOpponent:     { ko: '⏳ 상대방의 차례입니다. 기다려주세요.', en: '⏳ Opponent\'s turn. Please wait.' },
        choosePlace:      { ko: '카드를 배치할 위치를 선택하세요. ({n}곳 가능)', en: 'Choose where to place the card ({n} spots).' },
        autoPlace:        { ko: '카드가 자동으로 배치됩니다.', en: 'The card is placed automatically.' },
        guessPrompt:      { ko: '상대방 카드를 추측하세요.', en: 'Guess one of your opponent\'s cards.' },
        joker:            { ko: '조커', en: 'Joker' },
        correctWinEnd:    { ko: '🎉 정답! 게임 종료! 당신이 승리했습니다!', en: '🎉 Correct! Game over — you win!' },
        correctContinue:  { ko: '✅ 정답! 계속 추측하시겠습니까?', en: '✅ Correct! Keep guessing?' },
        wrongGameOver:    { ko: '❌ 틀렸습니다! 카드가 모두 공개되어 게임이 종료됩니다.', en: '❌ Wrong! All your cards are revealed — game over.' },
        wrongOppTurn:     { ko: '❌ 틀렸습니다! 상대방 차례입니다.', en: '❌ Wrong! Opponent\'s turn.' },
        keepGuessing:     { ko: '🎯 계속 추측하세요!', en: '🎯 Keep guessing!' },
        turnEnded:        { ko: '턴을 종료했습니다.', en: 'You ended your turn.' },
        black:            { ko: '검정', en: 'black' },
        white:            { ko: '흰색', en: 'white' },
        oppPlaced:        { ko: '상대방이 {color} 카드를 위치 {pos}에 배치했습니다.', en: 'Opponent placed a {color} card at position {pos}.' },
        oppContinues:     { ko: '⏳ 상대방이 계속 추측합니다.', en: '⏳ Opponent keeps guessing.' },
        oppEndedTurn:     { ko: '상대방이 턴을 종료했습니다.', en: 'Opponent ended their turn.' },
        yourTurnGuess:    { ko: '🎯 당신의 차례입니다! 상대방 카드를 추측하세요.', en: '🎯 Your turn! Guess an opponent card.' },
        yourTurnDraw:     { ko: '🎯 당신의 차례입니다! 카드를 뽑으세요.', en: '🎯 Your turn! Draw a card.' },
        oppGuessed:       { ko: '상대방이 위치 {pos}을(를) {val}로 추측했습니다.', en: 'Opponent guessed position {pos} is {val}.' },
        pvpUnsupported:   { ko: 'PvP는 이 페이지에서 지원되지 않습니다.', en: 'PvP is not supported on this page.' },
        noGame:           { ko: '게임이 없습니다.', en: 'No game in progress.' },
        enterGameId:      { ko: '⚠️ 게임 ID를 입력하세요', en: '⚠️ Enter a game ID' },
        selectCardValue:  { ko: '⚠️ 카드와 숫자를 선택하세요', en: '⚠️ Select a card and a number' },
        correctShort:     { ko: '✅ 정답!', en: '✅ Correct!' },
        wrongShort:       { ko: '❌ 틀렸습니다!', en: '❌ Wrong!' },
        phaseWaiting:     { ko: '대기중', en: 'Waiting' },
        phaseDraw:        { ko: '뽑기', en: 'Draw' },
        phaseGuess:       { ko: '추측', en: 'Guess' },
        phaseDecision:    { ko: '선택', en: 'Decide' },
        phasePlace:       { ko: '배치', en: 'Place' },
        drawnCard:        { ko: '뽑은 카드', en: 'Drawn card' },
        selectNumber:     { ko: '숫자 선택...', en: 'Pick a number...' },
        jokerOption:      { ko: '- 조커', en: '- Joker' },
        victory:          { ko: '🎉 승리!', en: '🎉 Victory!' },
        defeat:           { ko: '💀 패배', en: '💀 Defeat' },
        oppLeftTitle:     { ko: '🚪 상대방 퇴장', en: '🚪 Opponent left' },
        oppLeftMsg:       { ko: '상대방이 게임을 나갔습니다.', en: 'The opponent left the game.' },
    };

    const STORAGE_KEY = 'dvc_lang';

    function detectLang() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === 'ko' || saved === 'en') return saved;
        return (navigator.language || '').toLowerCase().startsWith('ko') ? 'ko' : 'en';
    }

    let lang = detectLang();

    function t(key, params) {
        const entry = STRINGS[key];
        let s = entry ? (entry[lang] || entry.ko) : key;
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                s = s.replaceAll('{' + k + '}', String(v));
            }
        }
        return s;
    }

    function applyI18n() {
        document.documentElement.lang = lang;
        document.title = t('docTitle');
        document.querySelectorAll('[data-i18n]').forEach(el => {
            el.innerHTML = t(el.dataset.i18n);
        });
        const btn = document.getElementById('lang-toggle');
        if (btn) btn.textContent = lang === 'ko' ? 'EN' : '한국어';
    }

    function setLang(next) {
        lang = next;
        localStorage.setItem(STORAGE_KEY, lang);
        applyI18n();
        window.dispatchEvent(new CustomEvent('dvc:langchange', { detail: { lang } }));
    }

    window.I18N = {
        t,
        get lang() { return lang; },
        setLang,
        applyI18n,
    };

    document.addEventListener('DOMContentLoaded', () => {
        applyI18n();
        document.getElementById('lang-toggle')
            ?.addEventListener('click', () => setLang(lang === 'ko' ? 'en' : 'ko'));
    });
})();
