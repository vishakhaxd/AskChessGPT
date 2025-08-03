from flask import Flask, request, jsonify
from flask_cors import CORS
import chess
import chess.engine
import random
import os

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend

# Global Stockfish engine
engine = None

def init_stockfish():
    """Initialize Stockfish engine"""
    global engine
    try:
        # Try common Stockfish binary names and locations
        stockfish_paths = [
            '/Users/ninad/Personal_project/chess-ai/stockfish-macos-m1-apple-silicon'
        ]
        
        for path in stockfish_paths:
            if os.path.exists(path) or path == 'stockfish':
                try:
                    engine = chess.engine.SimpleEngine.popen_uci(path)
                    print(f"Stockfish initialized successfully from: {path}")
                    return True
                except Exception as e:
                    print(f"Failed to initialize Stockfish from {path}: {e}")
                    continue
        
        print("Warning: Stockfish not found, falling back to random moves")
        return False
    except Exception as e:
        print(f"Error initializing Stockfish: {e}")
        return False

def elo_to_depth_and_time(elo):
    """Convert Elo rating to appropriate depth and time limits"""
    if elo < 800:
        return 1, 0.1
    elif elo < 1000:
        return 2, 0.2
    elif elo < 1200:
        return 3, 0.3
    elif elo < 1400:
        return 4, 0.5
    elif elo < 1600:
        return 5, 0.8
    elif elo < 1800:
        return 6, 1.0
    elif elo < 2000:
        return 7, 1.5
    elif elo < 2200:
        return 8, 2.0
    elif elo < 2400:
        return 9, 3.0
    elif elo < 2600:
        return 10, 4.0
    else:
        return 12, 5.0

@app.route('/api/move', methods=['POST'])
def get_move():
    """Get AI move for given position"""
    try:
        data = request.json
        fen = data.get('fen')
        elo = data.get('elo', 1500)
        
        print(f"Received FEN: {fen}")  # Debug log
        
        if not fen:
            return jsonify({'error': 'FEN position required'}), 400
        
        # Create chess board from FEN
        board = chess.Board(fen)
        print(f"Turn: {'White' if board.turn else 'Black'}")  # Debug log
        
        # Get legal moves
        legal_moves = list(board.legal_moves)
        print(f"Legal moves count: {len(legal_moves)}")  # Debug log
        
        if not legal_moves:
            return jsonify({'error': 'No legal moves available'}), 400
        
        # For now, make random move (you can implement Stockfish later)
        if not legal_moves:
            return jsonify({'error': 'No legal moves available'}), 400
            
        # Use Stockfish if available, otherwise fall back to random
        move = None
        if engine:
            try:
                depth, time_limit = elo_to_depth_and_time(elo)
                print(f"Using Stockfish with depth={depth}, time={time_limit}s for Elo {elo}")
                
                # Get best move from Stockfish
                result = engine.play(board, chess.engine.Limit(depth=depth, time=time_limit))
                move = result.move
                print(f"Stockfish selected move: {str(move)}")
                
            except Exception as e:
                print(f"Stockfish error: {e}, falling back to random move")
                move = None
        
        # Fallback to random move if Stockfish failed or not available
        if not move:
            print(f"Using random move from {len(legal_moves)} options")
            move = random.choice(legal_moves)
            print(f"Random move selected: {str(move)}")
        
        # Verify the move is legal
        if move not in legal_moves:
            print(f"ERROR: Selected move {move} not in legal moves! Using fallback.")
            move = legal_moves[0]
        
        return jsonify({
            'move': str(move),
            'elo': elo,
            'engine': 'Stockfish' if engine else 'Random',
            'message': f'{"Stockfish" if engine else "Random"} move (Elo {elo})'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/chat', methods=['POST'])
def chat():
    """Handle chat messages and provide chess advice"""
    try:
        data = request.json
        message = data.get('message', '').lower()
        fen = data.get('fen', '')
        
        # Simple chess advice based on keywords
        if 'position' in message or 'analyze' in message:
            if fen:
                board = chess.Board(fen)
                turn = "White" if board.turn else "Black"
                moves_count = len(list(board.legal_moves))
                response = f"Current position: {turn} to move with {moves_count} legal moves available."
            else:
                response = "Please make a move first so I can analyze the position!"
        
        elif 'strategy' in message or 'plan' in message:
            responses = [
                "Focus on piece development and center control in the opening.",
                "Look for tactical opportunities and improve piece coordination.",
                "In chess, always consider your opponent's threats before making a move.",
                "Good chess strategy involves controlling key squares and improving piece activity."
            ]
            response = random.choice(responses)
        
        elif 'move' in message or 'suggest' in message:
            if fen:
                board = chess.Board(fen)
                moves = list(board.legal_moves)
                if moves:
                    suggested_move = random.choice(moves)
                    response = f"Consider playing {str(suggested_move)}. Always look for checks, captures, and threats!"
                else:
                    response = "No legal moves available in this position."
            else:
                response = "Show me the current position and I can suggest moves!"
        
        elif 'help' in message or 'learn' in message:
            responses = [
                "I can help analyze positions, suggest moves, and explain chess concepts!",
                "Ask me about strategy, tactics, or specific positions you'd like to understand.",
                "Chess improvement comes from practice and understanding patterns. What would you like to learn?",
                "I'm here to help with opening principles, middlegame tactics, and endgame technique!"
            ]
            response = random.choice(responses)
        
        else:
            responses = [
                "That's interesting! Chess is a game of infinite possibilities.",
                "Feel free to ask about strategy, tactics, or any position you'd like me to analyze.",
                "I'm here to help improve your chess understanding. What would you like to know?",
                "Every chess position tells a story. What aspect of the game interests you most?",
                "Chess mastery comes through practice and study. How can I assist your learning today?"
            ]
            response = random.choice(responses)
        
        return jsonify({
            'response': response,
            'status': 'success'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok', 
        'message': 'Chess API is running',
        'engine': 'Stockfish' if engine else 'Random',
        'stockfish_available': engine is not None
    })

def cleanup():
    """Clean up resources"""
    global engine
    if engine:
        try:
            engine.quit()
        except:
            pass

if __name__ == '__main__':
    # Initialize Stockfish on startup
    init_stockfish()
    
    try:
        app.run(debug=True, host='0.0.0.0', port=5100)
    finally:
        cleanup()
