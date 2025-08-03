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
