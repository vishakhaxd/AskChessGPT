// API Configuration
function getApiBaseUrl() {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:5100';
    return window.location.origin;
}
const API_BASE_URL = getApiBaseUrl();

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('gameSetup')) window.game = new ChessGame();
});

class ChessGame {
    constructor() {
        this.chess = new Chess();
        this.board = null;
        this.playerColor = 'white';
        this.aiElo = 1500;
        this.isPlayerTurn = true;
        this.gameActive = false;
        this.pendingAI = false;
        this.selectedSquare = null;
        this.validMoves = [];
        this.lastMoveContext = null;
        this.sessionId = crypto.randomUUID();
        this._playerAnalysisHtml = '';

        this.initializeEventListeners();
        this.initializeChat();
        this.tryRestoreGame();
    }

    initializeEventListeners() {
        document.getElementById('stockfishElo').addEventListener('input', (e) => {
            document.querySelectorAll('#eloValue').forEach(s => s.textContent = e.target.value);
            this.aiElo = parseInt(e.target.value);
        });
        document.getElementById('startGame').addEventListener('click', () => this.startNewGame());
        document.getElementById('newGame').addEventListener('click', () => this.showGameSetup());
        document.getElementById('undoMove').addEventListener('click', () => this.undoLastMove());
    }

    initializeChat() {
        const input = document.getElementById('chatInput');
        document.getElementById('sendMessage').addEventListener('click', () => this.sendChatMessage());
        input.addEventListener('keypress', (e) => { if (e.key === 'Enter') this.sendChatMessage(); });
    }

    sendChatMessage() {
        const input = document.getElementById('chatInput');
        const message = input.value.trim();
        if (!message) return;
        this.addChatMessage(message, 'user');
        input.value = '';
        this.generateAIResponse(message);
    }

    addChatMessage(message, sender, { isProactive = false } = {}) {
        const chatMessages = document.getElementById('chatMessages');
        const div = document.createElement('div');
        div.className = `message ${sender}-message${isProactive ? ' proactive-message' : ''}`;
        const content = document.createElement('div');
        content.className = 'message-content';
        content.innerHTML = sender === 'ai' ? this.parseChessMarkdown(message) : this.escapeHtml(message);
        div.appendChild(content);
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return content;
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    parseChessMarkdown(text) {
        let parsed = this.escapeHtml(text);
        parsed = parsed.replace(/^#{1,3}\s+(.+)$/gm, '<strong>$1</strong><br>');
        parsed = parsed.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        parsed = parsed.replace(/`([^`]+)`/g, '<code>$1</code>');
        parsed = parsed.replace(/^- (.+)$/gm, '<li>$1</li>');
        parsed = parsed.replace(/(<li>.*?<\/li>(?:\s*<li>.*?<\/li>)*)/gs, '<ul>$1</ul>');
        parsed = parsed.replace(/\n/g, '<br>');
        return parsed;
    }

    // -- Streaming chat --------------------------------------------------------

    async generateAIResponse(userMessage) {
        const contentEl = this.showTypingIndicator();
        try {
            const resp = await fetch(`${API_BASE_URL}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userMessage,
                    fen: this.chess.fen(),
                    lastMove: this.lastMoveContext,
                    sessionId: this.sessionId,
                    stream: true
                })
            });
            if (resp.headers.get('content-type')?.includes('text/event-stream')) {
                await this.readStream(resp, contentEl);
            } else {
                const data = await resp.json();
                this.removeTypingIndicator(contentEl, data.response || 'No response.');
            }
        } catch (e) {
            this.removeTypingIndicator(contentEl, 'Connection error. Try again.');
        }
    }

    async requestProactiveAnalysis(lastMove) {
        if (!this.gameActive) return;
        const panel = document.getElementById('aiLogicContent');
        if (!panel) return;
        const isPlayer = lastMove.actor === 'player';

        if (isPlayer) {
            // Cancel any prior stream
            if (this._analysisAbort) this._analysisAbort.abort();
            this._analysisAbort = new AbortController();
            this._playerAnalysisHtml = '';
            panel.innerHTML = '<span class="typing-indicator" style="display:inline-flex;gap:4px;"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
        } else {
            // Wait for player analysis to finish before starting AI analysis
            if (this._playerAnalysisPromise) await this._playerAnalysisPromise;
            if (this._analysisAbort) this._analysisAbort.abort();
            this._analysisAbort = new AbortController();
            const prefix = this._playerAnalysisHtml ? `<div class="player-analysis">${this._playerAnalysisHtml}</div><hr class="logic-divider">` : '';
            panel.innerHTML = prefix + '<span class="typing-indicator" style="display:inline-flex;gap:4px;"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
        }

        const signal = this._analysisAbort.signal;
        const doWork = async () => {
            try {
                const resp = await fetch(`${API_BASE_URL}/api/analyze-move`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fen: this.chess.fen(), lastMove, sessionId: this.sessionId, stream: true }),
                    signal
                });
                if (resp.headers.get('content-type')?.includes('text/event-stream')) {
                    const reader = resp.body.getReader();
                    const decoder = new TextDecoder();
                    let full = '', buffer = '';
                    while (true) {
                        if (signal.aborted) { reader.cancel(); return; }
                        const { done, value } = await reader.read();
                        if (done) break;
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop();
                        for (const line of lines) {
                            if (!line.startsWith('data: ')) continue;
                            try {
                                const payload = JSON.parse(line.slice(6));
                                if (payload.content) {
                                    full += payload.content;
                                    this._renderAnalysis(panel, isPlayer, this.parseChessMarkdown(full));
                                }
                                if (payload.done && payload.full) full = payload.full;
                            } catch {}
                        }
                    }
                    if (full) this._renderAnalysis(panel, isPlayer, this.parseChessMarkdown(full));
                } else {
                    const data = await resp.json();
                    this._renderAnalysis(panel, isPlayer, data.response ? this.parseChessMarkdown(data.response) : 'No analysis.');
                }
            } catch (e) {
                if (e.name === 'AbortError') return;
            }
        };

        if (isPlayer) {
            this._playerAnalysisPromise = doWork();
            await this._playerAnalysisPromise;
        } else {
            await doWork();
        }
    }

    _renderAnalysis(panel, isPlayer, html) {
        if (isPlayer) {
            this._playerAnalysisHtml = html;
            panel.innerHTML = `<div class="player-analysis">${html}</div>`;
        } else {
            const prefix = this._playerAnalysisHtml ? `<div class="player-analysis">${this._playerAnalysisHtml}</div><hr class="logic-divider">` : '';
            panel.innerHTML = `${prefix}<div class="ai-analysis">${html}</div>`;
        }
    }

    async readStream(resp, contentEl, isProactive = false) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let full = '';
        let buffer = '';
        let cleared = false;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const payload = JSON.parse(line.slice(6));
                    if (payload.content) {
                        if (!cleared) { contentEl.classList.remove('typing-indicator'); contentEl.innerHTML = ''; cleared = true; }
                        full += payload.content;
                        contentEl.innerHTML = this.parseChessMarkdown(full);
                        document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight;
                    }
                    if (payload.done && payload.full) full = payload.full;
                    if (payload.error) {
                        this.removeTypingIndicator(contentEl, 'Error: ' + payload.error);
                        return;
                    }
                } catch {}
            }
        }
        if (full) {
            contentEl.innerHTML = this.parseChessMarkdown(full);
            if (isProactive) contentEl.closest('.message')?.classList.add('proactive-message');
        } else {
            contentEl.closest('.message')?.remove();
        }
    }

    showTypingIndicator(isProactive = false) {
        const chatMessages = document.getElementById('chatMessages');
        const div = document.createElement('div');
        div.className = `message ai-message${isProactive ? ' proactive-message' : ''}`;
        const content = document.createElement('div');
        content.className = 'message-content typing-indicator';
        content.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
        div.appendChild(content);
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return content;
    }

    removeTypingIndicator(contentEl, text, isProactive = false) {
        contentEl.classList.remove('typing-indicator');
        contentEl.innerHTML = this.parseChessMarkdown(text);
        if (isProactive) contentEl.closest('.message')?.classList.add('proactive-message');
        document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight;
    }

    // -- Board & Game ----------------------------------------------------------

    startNewGame() {
        this.playerColor = document.getElementById('playerColor').value;
        this.aiElo = parseInt(document.getElementById('stockfishElo').value);
        this.pendingAI = false;
        this.lastMoveContext = null;
        this.sessionId = crypto.randomUUID();

        history.replaceState(null, '', `/gameplay/${this.sessionId}`);

        document.getElementById('gameSetup').style.display = 'none';
        document.getElementById('gameArea').style.display = 'grid';
        document.getElementById('gameplayIntro').style.display = 'none';
        document.querySelector('.gameplay-shell').classList.add('session-live');

        this.chess = new Chess();

        setTimeout(() => {
            this.initializeBoard();
            this.gameActive = true;
            this.isPlayerTurn = this.playerColor === 'white';
            this.updateGameStatus();
            this.updateLastMoveDisplay();
            this.deselectSquare();
            const lp = document.getElementById('aiLogicContent');
            if (lp) lp.textContent = 'Play a move to see the AI\'s reasoning.';
            if (this.playerColor === 'black') setTimeout(() => this.makeAIMove(), 500);
            this.updateMoveHistory();
        }, 50);
    }

    initializeBoard() {
        document.getElementById('chessboard').innerHTML = '';

        const config = {
            draggable: true,
            position: 'start',
            orientation: this.playerColor,
            pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
            moveSpeed: 150,
            snapbackSpeed: 150,
            snapSpeed: 50,
            onDragStart: (source, piece) => this.onDragStart(source, piece),
            onDrop: (source, target) => this.onDrop(source, target),
            onSnapEnd: () => this.onSnapEnd()
        };

        if (typeof Chessboard === 'undefined' || typeof Chess === 'undefined') return;

        this.board = Chessboard('chessboard', config);
        this.board.position('start');

        $('#chessboard').off('click.chess').on('click.chess', '.square-55d63', (e) => {
            if (!this.gameActive || !this.isPlayerTurn || this.pendingAI) return;
            const square = this.getSquareFromElement(e.currentTarget);
            if (square) this.handleSquareClick(square);
        });

        setTimeout(() => { this.board.position(this.chess.fen()); this.resizeBoard(); }, 100);
        window.addEventListener('resize', () => this.resizeBoard());
    }

    getSquareFromElement(el) {
        for (const c of el.className.split(' '))
            if (c.startsWith('square-') && c.length === 9) return c.substring(7);
        return null;
    }

    handleSquareClick(square) {
        if (this.pendingAI) return;
        if (!this.selectedSquare) { this.selectSquare(square); return; }
        if (this.selectedSquare === square) { this.deselectSquare(); return; }
        if (this.isValidMove(square)) this.makeMove(this.selectedSquare, square);
        else { this.deselectSquare(); this.selectSquare(square); }
    }

    selectSquare(square) {
        const piece = this.chess.get(square);
        if (!piece) return;
        if (piece.color !== (this.playerColor === 'white' ? 'w' : 'b')) return;
        const moves = this.chess.moves({ square, verbose: true });
        if (!moves.length) return;
        this.selectedSquare = square;
        this.validMoves = moves;
        this.highlightSelectedSquare(square);
        this.highlightValidMoves(moves);
    }

    deselectSquare() {
        this.selectedSquare = null;
        this.validMoves = [];
        this.removeHighlights();
    }

    isValidMove(target) { return this.validMoves.some(m => m.to === target); }

    makeMove(from, to) {
        const beforeFen = this.chess.fen();
        const move = this.chess.move({ from, to, promotion: 'q' });
        if (!move) return;

        this.lastMoveContext = this.buildLastMoveContext(move, beforeFen, 'player');
        this.deselectSquare();
        this.board.position(this.chess.fen());
        this.highlightLastMove(from, to);
        this.updateMoveHistory();
        this.updateLastMoveDisplay();
        this.updateGameStatus();

        this.requestProactiveAnalysis(this.lastMoveContext);

        if (this.chess.game_over()) { this.handleGameEnd(); return; }

        this.isPlayerTurn = false;
        this.pendingAI = true;
        this.saveGameState();
        this.updateGameStatus('AI is thinking...');
        setTimeout(() => this.makeAIMove(), 250);
    }

    onDragStart(source, piece) {
        if (!this.gameActive || !this.isPlayerTurn || this.pendingAI) return false;
        if (!piece || piece[0] !== (this.playerColor === 'white' ? 'w' : 'b')) return false;
        this.selectSquare(source);
        return true;
    }

    onDrop(source, target) {
        this.deselectSquare();
        if (target === 'offboard' || !this.gameActive || !this.isPlayerTurn || this.pendingAI) return 'snapback';

        const beforeFen = this.chess.fen();
        const move = this.chess.move({ from: source, to: target, promotion: 'q' });
        if (!move) return 'snapback';

        this.lastMoveContext = this.buildLastMoveContext(move, beforeFen, 'player');
        this._pendingDrop = { from: source, to: target };

        this.updateMoveHistory();
        this.updateLastMoveDisplay();
        this.updateGameStatus();

        this.requestProactiveAnalysis(this.lastMoveContext);

        if (this.chess.game_over()) { this.handleGameEnd(); return; }

        this.isPlayerTurn = false;
        this.pendingAI = true;
        this.saveGameState();
        this.updateGameStatus('AI is thinking...');
    }

    onSnapEnd() {
        this.board.position(this.chess.fen(), false);
        if (this._pendingDrop) {
            this.highlightLastMove(this._pendingDrop.from, this._pendingDrop.to);
            this._pendingDrop = null;
            setTimeout(() => this.makeAIMove(), 200);
        }
    }

    highlightSelectedSquare(square) { $(`#chessboard .square-${square}`).addClass('highlight-source'); }
    highlightValidMoves(moves) {
        moves.forEach(m => {
            $(`#chessboard .square-${m.to}`).addClass(m.captured ? 'highlight-capture' : 'highlight-destination');
        });
    }
    highlightLastMove(from, to) {
        $('#chessboard .square-55d63').removeClass('highlight-last-move');
        $(`#chessboard .square-${from}`).addClass('highlight-last-move');
        $(`#chessboard .square-${to}`).addClass('highlight-last-move');
    }
    resizeBoard() { if (this.board) this.board.resize(); }
    removeHighlights() { $('#chessboard .square-55d63').removeClass('highlight-source highlight-destination highlight-capture'); }

    async makeAIMove() {
        if (!this.gameActive || this.isPlayerTurn) return;
        this.updateGameStatus('AI is thinking...');
        const beforeFen = this.chess.fen();

        try {
            const resp = await fetch(`${API_BASE_URL}/api/move`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fen: this.chess.fen(), elo: this.aiElo })
            });
            if (!resp.ok) throw new Error('AI move failed');
            const data = await resp.json();

            let move = null;
            try { move = this.chess.move(data.move); } catch { move = null; }
            if (!move && data.move.length === 4) {
                try { move = this.chess.move({ from: data.move.substring(0, 2), to: data.move.substring(2, 4) }); }
                catch { move = null; }
            }

            if (move) {
                this.lastMoveContext = this.buildLastMoveContext(move, beforeFen, 'ai');
                this.finishAIMove();
            } else {
                this.pendingAI = false;
                this.updateGameStatus('AI error');
            }
        } catch {
            this.pendingAI = false;
            this.updateGameStatus('AI connection failed');
        }
    }

    finishAIMove() {
        this.pendingAI = false;
        this.removeHighlights();
        this.board.position(this.chess.fen());

        if (this.lastMoveContext) {
            const uci = this.lastMoveContext.uci;
            if (uci && uci.length >= 4)
                setTimeout(() => this.highlightLastMove(uci.substring(0, 2), uci.substring(2, 4)), 160);
        }

        this.updateMoveHistory();
        this.updateLastMoveDisplay();

        if (this.chess.game_over()) { this.handleGameEnd(); return; }

        this.isPlayerTurn = true;
        this.updateGameStatus();

        // Proactive analysis for AI move
        if (this.lastMoveContext) this.requestProactiveAnalysis(this.lastMoveContext);
        this.saveGameState();
    }

    updateGameStatus(custom = null) {
        const el = document.getElementById('gameStatus');
        if (custom) { el.textContent = custom; el.className = 'status thinking'; return; }
        if (this.chess.in_checkmate()) {
            const w = this.chess.turn() === 'w' ? 'Black' : 'White';
            el.textContent = `Checkmate! ${w} wins`;
            el.className = 'status game-over';
        } else if (this.chess.in_draw()) {
            el.textContent = 'Game drawn';
            el.className = 'status draw';
        } else if (this.chess.in_check()) {
            el.textContent = `${this.isPlayerTurn ? 'Your' : "AI's"} king is in check`;
            el.className = 'status';
        } else {
            el.textContent = this.isPlayerTurn ? 'Your turn' : "AI's turn";
            el.className = 'status';
        }
    }

    handleGameEnd() {
        this.gameActive = false;
        this.updateGameStatus();
        this.clearGameState();
        let result;
        if (this.chess.in_checkmate()) {
            const winner = this.chess.turn() === 'w' ? 'Black' : 'White';
            result = winner.toLowerCase() === this.playerColor ? 'You won!' : 'You lost!';
        } else result = 'Draw!';
        setTimeout(() => alert(`Game Over: ${result}`), 100);
    }

    updateMoveHistory() {
        const el = document.getElementById('moveList');
        const h = this.chess.history();
        let html = '';
        for (let i = 0; i < h.length; i += 2) {
            const n = Math.floor(i / 2) + 1;
            html += `<div class="move-pair"><span class="move-number">${n}.</span><span class="move">${h[i]}</span>${h[i+1] ? `<span class="move">${h[i+1]}</span>` : ''}</div>`;
        }
        el.innerHTML = html;
    }

    updateLastMoveDisplay() {
        const el = document.getElementById('lastMoveText');
        if (!el) return;
        if (!this.lastMoveContext) { el.textContent = 'No moves yet.'; return; }
        const actor = this.lastMoveContext.actor === 'player' ? 'You' : 'AI';
        el.textContent = `${actor} played ${this.lastMoveContext.san || '?'}`;
    }

    buildLastMoveContext(move, beforeFen, actor) {
        return {
            actor, san: move.san,
            uci: `${move.from}${move.to}${move.promotion || ''}`,
            from: move.from, to: move.to,
            beforeFen: beforeFen || null,
            afterFen: this.chess.fen(),
            turn: move.color
        };
    }

    undoLastMove() {
        if (!this.gameActive || !this.chess.history().length) return;
        const len = this.chess.history().length;
        if (len >= 2) { this.chess.undo(); this.chess.undo(); }
        else this.chess.undo();
        this.board.position(this.chess.fen(), false);
        this.updateMoveHistory();
        this.isPlayerTurn = true;
        this.pendingAI = false;
        this.lastMoveContext = null;
        this.updateGameStatus();
        this.updateLastMoveDisplay();
        this.deselectSquare();
        this.saveGameState();
    }

    showGameSetup() {
        this.gameActive = false;
        this.pendingAI = false;
        this.lastMoveContext = null;
        this.clearGameState();
        history.replaceState(null, '', '/gameplay');
        document.getElementById('gameSetup').style.display = 'block';
        document.getElementById('gameArea').style.display = 'none';
        document.getElementById('gameplayIntro').style.display = 'flex';
        document.querySelector('.gameplay-shell').classList.remove('session-live');
        document.getElementById('learningStudio').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // -- Persistence -----------------------------------------------------------

    saveGameState() {
        if (!this.gameActive) return;
        const state = {
            sessionId: this.sessionId,
            playerColor: this.playerColor,
            aiElo: this.aiElo,
            pgn: this.chess.pgn(),
            isPlayerTurn: this.isPlayerTurn
        };
        try { localStorage.setItem('askchessgpt_game', JSON.stringify(state)); } catch {}
        fetch(`${API_BASE_URL}/api/session/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state)
        }).catch(() => {});
    }

    clearGameState() {
        try { localStorage.removeItem('askchessgpt_game'); } catch {}
    }

    tryRestoreGame() {
        const pathMatch = window.location.pathname.match(/^\/gameplay\/([a-f0-9-]+)$/i);
        if (pathMatch) {
            const urlSessionId = pathMatch[1];
            fetch(`${API_BASE_URL}/api/session/${urlSessionId}`)
                .then(r => r.ok ? r.json() : null)
                .then(state => {
                    if (state && state.pgn) this._restoreFromState(state);
                    else this._tryLocalRestore();
                })
                .catch(() => this._tryLocalRestore());
            return;
        }
        this._tryLocalRestore();
    }

    _tryLocalRestore() {
        let state;
        try { state = JSON.parse(localStorage.getItem('askchessgpt_game')); } catch {}
        if (!state || !state.pgn) return;
        this._restoreFromState(state);
    }

    _restoreFromState(state) {
        this.sessionId = state.sessionId || crypto.randomUUID();
        this.playerColor = state.playerColor || 'white';
        this.aiElo = state.aiElo || 1500;

        this.chess = new Chess();
        this.chess.load_pgn(state.pgn);

        history.replaceState(null, '', `/gameplay/${this.sessionId}`);

        document.getElementById('gameSetup').style.display = 'none';
        document.getElementById('gameArea').style.display = 'grid';
        document.getElementById('gameplayIntro').style.display = 'none';
        document.querySelector('.gameplay-shell').classList.add('session-live');
        document.querySelectorAll('#eloValue').forEach(s => s.textContent = this.aiElo);

        setTimeout(() => {
            this.initializeBoard();
            this.board.position(this.chess.fen(), false);
            this.gameActive = true;
            this.isPlayerTurn = state.isPlayerTurn !== undefined ? state.isPlayerTurn : (this.chess.turn() === (this.playerColor === 'white' ? 'w' : 'b'));
            this.pendingAI = false;
            this.updateGameStatus();
            this.updateMoveHistory();
            this.updateLastMoveDisplay();
            const lp = document.getElementById('aiLogicContent');
            if (lp) lp.textContent = 'Game restored. Play a move to see analysis.';

            if (this.chess.game_over()) { this.handleGameEnd(); return; }
            if (!this.isPlayerTurn) {
                this.pendingAI = true;
                this.updateGameStatus('AI is thinking...');
                setTimeout(() => this.makeAIMove(), 500);
            }
        }, 50);
    }
}
