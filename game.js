// Chess Game Logic
class ChessGame {
    constructor() {
        this.chess = new Chess();
        this.board = null;
        this.playerColor = 'white';
        this.aiElo = 1500;
        this.isPlayerTurn = true;
        this.gameActive = false;
        this.selectedSquare = null;
        this.validMoves = [];
        
        this.initializeEventListeners();
        this.initializeChat();
    }
    
    initializeEventListeners() {
        // Game setup
        document.getElementById('stockfishElo').addEventListener('input', (e) => {
            const elo = e.target.value;
            const eloValueSpans = document.querySelectorAll('#eloValue');
            eloValueSpans.forEach(span => span.textContent = elo);
            this.aiElo = parseInt(elo);
        });
        
        document.getElementById('startGame').addEventListener('click', () => {
            this.startNewGame();
        });
        
        document.getElementById('newGame').addEventListener('click', () => {
            this.showGameSetup();
        });
        
        document.getElementById('undoMove').addEventListener('click', () => {
            this.undoLastMove();
        });
    }
    
    initializeChat() {
        const chatInput = document.getElementById('chatInput');
        const sendButton = document.getElementById('sendMessage');
        
        // Send message on button click
        sendButton.addEventListener('click', () => {
            this.sendChatMessage();
        });
        
        // Send message on Enter key
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendChatMessage();
            }
        });
    }
    
    sendChatMessage() {
        const chatInput = document.getElementById('chatInput');
        const message = chatInput.value.trim();
        
        if (!message) return;
        
        // Add user message to chat
        this.addChatMessage(message, 'user');
        chatInput.value = '';
        
        // Generate AI response
        setTimeout(() => {
            this.generateAIResponse(message);
        }, 500);
    }
    
    addChatMessage(message, sender) {
        const chatMessages = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}-message`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = message;
        
        messageDiv.appendChild(contentDiv);
        chatMessages.appendChild(messageDiv);
        
        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    generateAIResponse(userMessage) {
        // Call the backend API for intelligent responses
        fetch('http://localhost:5100/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: userMessage,
                fen: this.chess.fen()
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.response) {
                this.addChatMessage(data.response, 'ai');
            } else {
                // Fallback to local responses
                const responses = this.getContextualResponse(userMessage.toLowerCase());
                const response = responses[Math.floor(Math.random() * responses.length)];
                this.addChatMessage(response, 'ai');
            }
        })
        .catch(error => {
            console.error('Chat API error:', error);
            // Fallback to local responses
            const responses = this.getContextualResponse(userMessage.toLowerCase());
            const response = responses[Math.floor(Math.random() * responses.length)];
            this.addChatMessage(response, 'ai');
        });
    }
    
    getContextualResponse(message) {
        const position = this.chess.fen();
        const turn = this.chess.turn() === 'w' ? 'White' : 'Black';
        const gamePhase = this.getGamePhase();
        
        // Check if message is about current position
        if (message.includes('position') || message.includes('analyze') || message.includes('evaluation')) {
            return [
                `Current position: ${turn} to move. We're in the ${gamePhase} phase.`,
                `This position shows typical ${gamePhase} characteristics. ${turn} has the initiative.`,
                `Let me analyze: ${turn} to move in this ${gamePhase} position.`
            ];
        }
        
        // Check if message is about strategy
        if (message.includes('strategy') || message.includes('plan') || message.includes('what should')) {
            if (gamePhase === 'opening') {
                return [
                    "In the opening, focus on controlling the center, developing pieces, and castling for king safety.",
                    "Key opening principles: develop knights before bishops, castle early, and control central squares.",
                    "Good opening moves prioritize piece development and center control over material gain."
                ];
            } else if (gamePhase === 'middlegame') {
                return [
                    "In the middlegame, look for tactical opportunities and improve piece coordination.",
                    "Focus on piece activity, pawn structure, and king safety. Look for tactical motifs.",
                    "The middlegame is about improving piece placement and creating threats."
                ];
            } else {
                return [
                    "In the endgame, king activity becomes crucial. Centralize your king!",
                    "Endgame principles: activate your king, push passed pawns, and simplify when ahead.",
                    "Focus on king and pawn endgames - they're the foundation of endgame knowledge."
                ];
            }
        }
        
        // Check if message is about moves
        if (message.includes('move') || message.includes('suggest') || message.includes('recommend')) {
            const moves = this.chess.moves();
            if (moves.length > 0) {
                const randomMove = moves[Math.floor(Math.random() * moves.length)];
                return [
                    `Consider moves like ${randomMove}. Look for tactics and piece development.`,
                    `You have ${moves.length} legal moves. Focus on piece activity and center control.`,
                    `Think about moves that improve your position, like ${randomMove}.`
                ];
            }
        }
        
        // General responses
        const generalResponses = [
            "That's an interesting question! Chess is all about pattern recognition and planning.",
            "Great question! Remember the key principles: development, center control, and king safety.",
            "Chess is a beautiful game of strategy and tactics. What specific aspect interests you?",
            "Every position tells a story. What would you like to know about this position?",
            "I'm here to help with your chess understanding! Feel free to ask about any position or concept.",
            "Chess improvement comes from understanding patterns and practicing regularly!"
        ];
        
        return generalResponses;
    }
    
    getGamePhase() {
        const moves = this.chess.history();
        if (moves.length < 10) return 'opening';
        
        const pieces = this.chess.board().flat().filter(p => p !== null);
        const majorPieces = pieces.filter(p => ['q', 'r'].includes(p.type.toLowerCase())).length;
        
        if (majorPieces <= 4) return 'endgame';
        return 'middlegame';
    }
    
    startNewGame() {
        this.playerColor = document.getElementById('playerColor').value;
        this.aiElo = parseInt(document.getElementById('stockfishElo').value);
        
        // Hide setup, show game
        document.getElementById('gameSetup').style.display = 'none';
        document.getElementById('gameArea').style.display = 'grid';
        
        // Initialize chess and board
        this.chess = new Chess();
        
        // Wait for DOM to update before initializing board
        setTimeout(() => {
            this.initializeBoard();
            this.gameActive = true;
            
            // Set initial turn
            this.isPlayerTurn = this.playerColor === 'white';
            this.updateGameStatus();
            
            // Clear any selection
            this.deselectSquare();
            
            // If player is black, let AI move first
            if (this.playerColor === 'black') {
                setTimeout(() => {
                    this.makeAIMove();
                }, 500);
            } else {
            }
            
            this.updateMoveHistory();
        }, 50);
    }
    
    initializeBoard() {
        // Clear any existing board
        document.getElementById('chessboard').innerHTML = '';
        
        const config = {
            draggable: false, // Disable drag and drop
            position: 'start',
            orientation: this.playerColor,
            pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
        };
        
        // Ensure the library is loaded
        if (typeof Chessboard === 'undefined') {
            console.error('Chessboard.js not loaded');
            return;
        }
        
        if (typeof Chess === 'undefined') {
            console.error('Chess.js not loaded');
            return;
        }
        
        this.board = Chessboard('chessboard', config);
        
        // Explicitly set the starting position
        this.board.position('start');
        
        // Add click event listeners to squares
        this.addClickListeners();
        
        // Force a small delay and then resize to ensure proper rendering
        setTimeout(() => {
            this.board.position('start'); // Set position again to ensure pieces load
            this.resizeBoard();
        }, 100);
        
        window.addEventListener('resize', () => this.resizeBoard());
    }
    
    addClickListeners() {
        // Add click event listener to all squares
        setTimeout(() => {
            $('#chessboard .square-55d63').off('click').on('click', (e) => {
                if (!this.gameActive || !this.isPlayerTurn) return;
                
                const square = this.getSquareFromElement(e.currentTarget);
                if (square) {
                    this.handleSquareClick(square);
                }
            });
        }, 200);
    }
    
    getSquareFromElement(element) {
        const classes = element.className.split(' ');
        for (let className of classes) {
            if (className.startsWith('square-') && className.length === 9) {
                return className.substring(7); // Remove 'square-' prefix
            }
        }
        return null;
    }
    
    handleSquareClick(square) {
        
        // If no piece is selected
        if (!this.selectedSquare) {
            this.selectSquare(square);
        } 
        // If clicking the same square, deselect
        else if (this.selectedSquare === square) {
            this.deselectSquare();
        }
        // If clicking a different square
        else {
            // Check if it's a valid move
            if (this.isValidMove(square)) {
                this.makeMove(this.selectedSquare, square);
            } else {
                // Try to select the new square (if it has a piece)
                this.deselectSquare();
                this.selectSquare(square);
            }
        }
    }
    
    selectSquare(square) {
        const piece = this.chess.get(square);
        
        // Only select if there's a piece and it's the player's piece
        if (!piece) return;
        
        const pieceColor = piece.color;
        const playerColor = this.playerColor === 'white' ? 'w' : 'b';
        
        if (pieceColor !== playerColor) return;
        
        // Get valid moves for this piece
        const moves = this.chess.moves({
            square: square,
            verbose: true
        });
        
        if (moves.length === 0) return; // No valid moves
        
        this.selectedSquare = square;
        this.validMoves = moves;
        
        // Highlight the selected square and valid moves
        this.highlightSelectedSquare(square);
        this.highlightValidMoves(moves);
    }
    
    deselectSquare() {
        this.selectedSquare = null;
        this.validMoves = [];
        this.removeHighlights();
    }
    
    isValidMove(targetSquare) {
        return this.validMoves.some(move => move.to === targetSquare);
    }
    
    makeMove(from, to) {
        
        const move = this.chess.move({
            from: from,
            to: to,
            promotion: 'q' // Always promote to queen for simplicity
        });
        
        if (!move) {
            return;
        }
        
        // Update board position
        this.board.position(this.chess.fen());
        
        // Clear selection
        this.deselectSquare();
        
        this.updateMoveHistory();
        this.updateGameStatus();
        
        // Check for game end
        if (this.chess.game_over()) {
            this.handleGameEnd();
            return;
        }
        
        // Switch turns
        this.isPlayerTurn = false;
        this.updateGameStatus('AI is thinking...');
        
        // Make AI move after a short delay
        setTimeout(() => {
            this.makeAIMove();
        }, 200); // Reduced from 500ms to 200ms
    }
    
    highlightSelectedSquare(square) {
        const $square = $(`#chessboard .square-${square}`);
        $square.addClass('highlight-source');
    }
    
    highlightValidMoves(moves) {
        moves.forEach(move => {
            const $square = $(`#chessboard .square-${move.to}`);
            $square.addClass('highlight-destination');
        });
    }
    
    resizeBoard() {
        if (this.board) {
            const container = document.querySelector('.board-container');
            if (container) {
                const maxWidth = Math.min(500, container.clientWidth - 20);
                this.board.resize();
            }
        }
    }
    
    async makeAIMove() {
        if (!this.gameActive || this.isPlayerTurn) return;
        
        this.updateGameStatus('AI is thinking...');
        
        try {
            const response = await fetch('http://localhost:5100/api/move', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    fen: this.chess.fen(),
                    elo: this.aiElo
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to get AI move');
            }
            
            const data = await response.json();
            console.log('Backend response:', data); // Debug log
            console.log('Frontend FEN:', this.chess.fen()); // Debug log
            
            // Try different ways to apply the move
            let move = null;
            
            // Method 1: Direct string move
            try {
                move = this.chess.move(data.move);
                console.log('Method 1 (direct string) result:', move);
            } catch (e) {
                console.log('Method 1 failed:', e.message);
            }
            
            // Method 2: Parse move string and use object format
            if (!move && data.move.length === 4) {
                try {
                    const from = data.move.substring(0, 2);
                    const to = data.move.substring(2, 4);
                    move = this.chess.move({ from: from, to: to });
                    console.log('Method 2 (object format) result:', move);
                } catch (e) {
                    console.log('Method 2 failed:', e.message);
                }
            }
            
            console.log('Final move result:', move); // Debug log
            if (move) {
                this.finishAIMove();
            } else {
                console.log('Invalid move:', data.move, 'for position:', this.chess.fen()); // Debug log
                this.updateGameStatus('AI error occurred');
            }
            
        } catch (error) {
            this.updateGameStatus('AI connection failed');
        }
    }
    

    
    getDepthForElo(elo) {
        if (elo < 1200) return 5;
        if (elo < 1600) return 8;
        if (elo < 2000) return 10;
        if (elo < 2400) return 12;
        return 15;
    }
    
    // Simple AI fallback (optimized version of previous AI)
    makeSimpleAIMove() {
        const possibleMoves = this.chess.moves({ verbose: true });
        if (possibleMoves.length === 0) {
            this.updateGameStatus('AI has no moves');
            return;
        }
        
        let selectedMove;
        const skillLevel = this.eloToSkillLevel(this.aiElo);
        
        if (skillLevel >= 8) {
            selectedMove = this.getBestMove(2);
        } else if (skillLevel >= 5) {
            const bestMoves = this.getTopMoves(3, 2);
            selectedMove = bestMoves[Math.floor(Math.random() * Math.min(2, bestMoves.length))];
        } else if (skillLevel >= 2) {
            if (Math.random() < 0.4) {
                selectedMove = this.getBestMove(1);
            } else {
                selectedMove = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
            }
        } else {
            const captures = possibleMoves.filter(move => move.captured);
            if (captures.length > 0 && Math.random() < 0.3) {
                selectedMove = captures[Math.floor(Math.random() * captures.length)];
            } else {
                selectedMove = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
            }
        }
        
        const move = this.chess.move(selectedMove);
        
        if (move) {
            this.finishAIMove();
        }
    }
    
    finishAIMove() {
        // Update board position
        this.board.position(this.chess.fen());
        this.updateMoveHistory();
        
        // Check for game end
        if (this.chess.game_over()) {
            this.handleGameEnd();
            return;
        }
        
        // Switch back to player
        this.isPlayerTurn = true;
        this.updateGameStatus();
    }
    
    eloToSkillLevel(elo) {
        // Convert Elo to skill level (0-10)
        if (elo < 900) return 0;
        if (elo < 1100) return 1;
        if (elo < 1300) return 2;
        if (elo < 1500) return 3;
        if (elo < 1700) return 4;
        if (elo < 1900) return 5;
        if (elo < 2100) return 6;
        if (elo < 2300) return 7;
        if (elo < 2500) return 8;
        if (elo < 2700) return 9;
        return 10;
    }
    
    // Minimax algorithm with alpha-beta pruning
    minimax(depth, alpha, beta, maximizingPlayer) {
        if (depth === 0 || this.chess.game_over()) {
            return this.evaluatePosition();
        }
        
        const moves = this.chess.moves({ verbose: true });
        
        if (maximizingPlayer) {
            let maxEval = -Infinity;
            for (let move of moves) {
                this.chess.move(move);
                const evaluation = this.minimax(depth - 1, alpha, beta, false);
                this.chess.undo();
                maxEval = Math.max(maxEval, evaluation);
                alpha = Math.max(alpha, evaluation);
                if (beta <= alpha) break; // Alpha-beta pruning
            }
            return maxEval;
        } else {
            let minEval = Infinity;
            for (let move of moves) {
                this.chess.move(move);
                const evaluation = this.minimax(depth - 1, alpha, beta, true);
                this.chess.undo();
                minEval = Math.min(minEval, evaluation);
                beta = Math.min(beta, evaluation);
                if (beta <= alpha) break; // Alpha-beta pruning
            }
            return minEval;
        }
    }
    
    getBestMove(depth) {
        const moves = this.chess.moves({ verbose: true });
        let bestMove = moves[0];
        let bestValue = -Infinity;
        const isAIWhite = this.playerColor === 'black';
        
        for (let move of moves) {
            this.chess.move(move);
            const value = this.minimax(depth - 1, -Infinity, Infinity, !isAIWhite);
            this.chess.undo();
            
            if ((isAIWhite && value > bestValue) || (!isAIWhite && value < bestValue)) {
                bestValue = value;
                bestMove = move;
            }
        }
        
        return bestMove;
    }
    
    getTopMoves(numMoves, depth) {
        const moves = this.chess.moves({ verbose: true });
        const evaluatedMoves = [];
        const isAIWhite = this.playerColor === 'black';
        
        for (let move of moves) {
            this.chess.move(move);
            const value = this.minimax(depth - 1, -Infinity, Infinity, !isAIWhite);
            this.chess.undo();
            evaluatedMoves.push({ move, value });
        }
        
        // Sort moves by value
        evaluatedMoves.sort((a, b) => {
            return isAIWhite ? b.value - a.value : a.value - b.value;
        });
        
        return evaluatedMoves.slice(0, numMoves).map(item => item.move);
    }
    
    // Fast position evaluation function - OPTIMIZED FOR SPEED
    evaluatePosition() {
        if (this.chess.in_checkmate()) {
            return this.chess.turn() === 'w' ? -9999 : 9999;
        }
        
        if (this.chess.in_draw()) {
            return 0;
        }
        
        let evaluation = 0;
        const board = this.chess.board();
        
        // Simple piece values (faster than complex positional evaluation)
        const pieceValues = {
            'p': 100, 'n': 320, 'b': 330, 'r': 500, 'q': 900, 'k': 20000
        };
        
        // Quick material count
        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 8; j++) {
                const piece = board[i][j];
                if (piece) {
                    const value = pieceValues[piece.type];
                    const sign = piece.color === 'w' ? 1 : -1;
                    evaluation += sign * value;
                    
                    // Simple center bonus (much faster than full positional tables)
                    if ((i === 3 || i === 4) && (j === 3 || j === 4)) {
                        evaluation += sign * 10;
                    }
                }
            }
        }
        
        // Simple mobility bonus (count moves for current player only)
        evaluation += this.chess.moves().length * 2;
        
        return evaluation;
    }
    
    // Remove old random move function
    makeRandomMove() {
        this.makeAIMove();
    }
    
    removeHighlights() {
        // Remove all highlight classes
        $('#chessboard .square-55d63').removeClass('highlight-source highlight-destination');
    }
    
    executeStockfishMove(moveStr) {
        const move = this.chess.move(moveStr);
        
        if (move) {
            this.finishAIMove();
        } else {
            this.makeSimpleAIMove(); // Fallback
        }
    }
    
    updateGameStatus(customMessage = null) {
        const statusEl = document.getElementById('gameStatus');
        
        if (customMessage) {
            statusEl.textContent = customMessage;
            statusEl.className = 'status thinking';
            return;
        }
        
        if (this.chess.in_checkmate()) {
            const winner = this.chess.turn() === 'w' ? 'Black' : 'White';
            statusEl.textContent = `Checkmate! ${winner} wins`;
            statusEl.className = 'status game-over';
        } else if (this.chess.in_draw()) {
            statusEl.textContent = 'Game drawn';
            statusEl.className = 'status draw';
        } else if (this.chess.in_check()) {
            const player = this.isPlayerTurn ? 'Your' : "AI's";
            statusEl.textContent = `${player} king is in check`;
            statusEl.className = 'status';
        } else {
            const turn = this.isPlayerTurn ? 'Your turn' : "AI's turn";
            statusEl.textContent = turn;
            statusEl.className = 'status';
        }
    }
    
    handleGameEnd() {
        this.gameActive = false;
        this.updateGameStatus();
        
        // Determine result
        let result;
        if (this.chess.in_checkmate()) {
            const winner = this.chess.turn() === 'w' ? 'Black' : 'White';
            const playerWon = (winner.toLowerCase() === this.playerColor);
            result = playerWon ? 'You won!' : 'You lost!';
        } else {
            result = 'Draw!';
        }
        
        setTimeout(() => {
            alert(`Game Over: ${result}`);
        }, 100);
    }
    
    updateMoveHistory() {
        const moveList = document.getElementById('moveList');
        const history = this.chess.history();
        
        let html = '';
        for (let i = 0; i < history.length; i += 2) {
            const moveNumber = Math.floor(i / 2) + 1;
            const whiteMove = history[i];
            const blackMove = history[i + 1] || '';
            
            html += `
                <div class="move-pair">
                    <span class="move-number">${moveNumber}.</span>
                    <span class="move">${whiteMove}</span>
                    ${blackMove ? `<span class="move">${blackMove}</span>` : ''}
                </div>
            `;
        }
        
        moveList.innerHTML = html;
        moveList.scrollTop = moveList.scrollHeight;
    }
    
    undoLastMove() {
        if (!this.gameActive || this.chess.history().length === 0) return;
        
        // Simple approach: Always undo two moves (player + AI) to get back to player's turn
        // If there's only one move, just undo that one
        const historyLength = this.chess.history().length;
        
        if (historyLength >= 2) {
            // Undo both AI's move and player's move
            this.chess.undo(); // Undo AI's move
            this.chess.undo(); // Undo player's move
        } else if (historyLength === 1) {
            // Only one move exists, just undo it
            this.chess.undo();
        }
        
        // Update board and UI
        this.board.position(this.chess.fen());
        this.updateMoveHistory();
        this.isPlayerTurn = true;
        this.updateGameStatus();
        this.deselectSquare(); // Clear any selection
    }
    
    showGameSetup() {
        // Reset game
        this.gameActive = false;
        document.getElementById('gameSetup').style.display = 'block';
        document.getElementById('gameArea').style.display = 'none';
    }
}

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', () => {
    new ChessGame();
});
