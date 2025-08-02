// Chess Game Logic
class ChessGame {
    constructor() {
        this.chess = new Chess();
        this.board = null;
        this.stockfishWorker = null;
        this.playerColor = 'white';
        this.stockfishElo = 1500;
        this.isPlayerTurn = true;
        this.gameActive = false;
        this.selectedSquare = null;
        this.validMoves = [];
        
        this.initializeEventListeners();
    }
    
    initializeEventListeners() {
        // Game setup
        document.getElementById('stockfishElo').addEventListener('input', (e) => {
            const elo = e.target.value;
            document.getElementById('eloValue').textContent = elo;
            this.stockfishElo = parseInt(elo);
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
    
    startNewGame() {
        this.playerColor = document.getElementById('playerColor').value;
        this.stockfishElo = parseInt(document.getElementById('stockfishElo').value);
        
        // Hide setup, show game
        document.getElementById('gameSetup').style.display = 'none';
        document.getElementById('gameArea').style.display = 'grid';
        
        // Initialize chess and board
        this.chess = new Chess();
        console.log('Chess initialized:', this.chess.ascii());
        
        // Wait for DOM to update before initializing board
        setTimeout(() => {
            this.initializeBoard();
            this.initializeStockfish();
            this.gameActive = true;
            
            // Set initial turn
            this.isPlayerTurn = this.playerColor === 'white';
            console.log('Game started - Player color:', this.playerColor, 'Player turn:', this.isPlayerTurn);
            this.updateGameStatus();
            
            // Clear any selection
            this.deselectSquare();
            
            // If player is black, let AI move first
            if (this.playerColor === 'black') {
                setTimeout(() => {
                    this.makeRandomMove();
                }, 500);
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
        
        console.log('Creating chessboard with config:', config);
        this.board = Chessboard('chessboard', config);
        console.log('Board created:', this.board);
        
        // Explicitly set the starting position
        this.board.position('start');
        
        // Add click event listeners to squares
        this.addClickListeners();
        
        // Force a small delay and then resize to ensure proper rendering
        setTimeout(() => {
            this.board.position('start'); // Set position again to ensure pieces load
            this.resizeBoard();
            console.log('Board position set to start');
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
        console.log('Square clicked:', square);
        
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
        
        console.log('Selected square:', square, 'Valid moves:', moves.length);
        
        // Highlight the selected square and valid moves
        this.highlightSelectedSquare(square);
        this.highlightValidMoves(moves);
    }
    
    deselectSquare() {
        this.selectedSquare = null;
        this.validMoves = [];
        this.removeHighlights();
        console.log('Deselected square');
    }
    
    isValidMove(targetSquare) {
        return this.validMoves.some(move => move.to === targetSquare);
    }
    
    makeMove(from, to) {
        console.log('Making move:', from, 'to', to);
        
        const move = this.chess.move({
            from: from,
            to: to,
            promotion: 'q' // Always promote to queen for simplicity
        });
        
        if (!move) {
            console.log('Invalid move');
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
            this.makeRandomMove();
        }, 500);
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
    
    initializeStockfish() {
        // Temporarily disable Stockfish worker due to security restrictions
        // We'll use a simple random AI instead
        console.log('Using simple random AI instead of Stockfish');
        this.stockfishWorker = null;
    }
    
    // Simple random AI as fallback
    makeRandomMove() {
        const possibleMoves = this.chess.moves();
        if (possibleMoves.length === 0) {
            this.updateGameStatus('AI has no moves');
            return;
        }
        
        const randomMove = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
        const move = this.chess.move(randomMove);
        
        if (move) {
            console.log('AI played:', randomMove);
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
    }
    
    handleStockfishMessage(e) {
        const { type, move, message } = e.data;
        
        switch (type) {
            case 'ready':
                console.log('Stockfish ready');
                break;
                
            case 'bestmove':
                if (move && move !== '(none)') {
                    this.executeStockfishMove(move);
                } else {
                    this.updateGameStatus('Stockfish has no moves');
                }
                break;
                
            case 'error':
                console.error('Stockfish error:', message);
                this.updateGameStatus('AI error occurred');
                break;
        }
    }
    
    removeHighlights() {
        // Remove all highlight classes
        $('#chessboard .square-55d63').removeClass('highlight-source highlight-destination');
    }
    
    makeStockfishMove() {
        if (!this.stockfishWorker || !this.gameActive) return;
        
        this.stockfishWorker.postMessage({
            type: 'getMove',
            fen: this.chess.fen(),
            elo: this.stockfishElo,
            depth: 15
        });
    }
    
    executeStockfishMove(moveStr) {
        const move = this.chess.move(moveStr);
        
        if (move) {
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
        
        // Undo the last move (or two moves if it's player's turn)
        this.chess.undo();
        
        // If it's currently player's turn, undo one more move (the AI's move)
        if (!this.isPlayerTurn && this.chess.history().length > 0) {
            this.chess.undo();
        }
        
        // Update board and UI
        this.board.position(this.chess.fen());
        this.updateMoveHistory();
        this.isPlayerTurn = true;
        this.updateGameStatus();
    }
    
    showGameSetup() {
        // Terminate worker and reset game
        if (this.stockfishWorker) {
            this.stockfishWorker.terminate();
        }
        
        this.gameActive = false;
        document.getElementById('gameSetup').style.display = 'block';
        document.getElementById('gameArea').style.display = 'none';
    }
}

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', () => {
    new ChessGame();
});
