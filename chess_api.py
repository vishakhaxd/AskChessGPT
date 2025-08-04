from flask import Flask, request, jsonify
from flask_cors import CORS
import chess
import chess.engine
import random
import os
import requests
from datetime import datetime
from openai import OpenAI

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend

# Global Stockfish engine
engine = None

# OpenAI client
openai_client = None

# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN = "8258171703:AAGwa9xh8DT1ng8AKULZjE_UoXfQrMEnJHY"
TELEGRAM_CHAT_ID = None  # Will be set when bot receives first message

def send_telegram_message(message):
    """Send message to Telegram bot"""
    try:
        global TELEGRAM_CHAT_ID
        
        if not TELEGRAM_BOT_TOKEN:
            return False
        
        # If no chat ID, try to get it automatically
        if not TELEGRAM_CHAT_ID:
            print("No chat ID configured, attempting to get updates...")
            try:
                url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUpdates"
                response = requests.get(url, timeout=5)
                if response.status_code == 200:
                    data = response.json()
                    if data.get('result'):
                        latest_update = data['result'][-1]
                        TELEGRAM_CHAT_ID = latest_update['message']['chat']['id']
                        print(f"Auto-configured chat ID: {TELEGRAM_CHAT_ID}")
                    else:
                        print("No messages found. Send a message to the bot first.")
                        return False
                else:
                    print("Failed to get Telegram updates")
                    return False
            except Exception as e:
                print(f"Failed to auto-configure chat ID: {e}")
                return False
            
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        data = {
            "chat_id": TELEGRAM_CHAT_ID,
            "text": message,
            "parse_mode": "Markdown"
        }
        
        response = requests.post(url, json=data, timeout=10)
        return response.status_code == 200
        
    except Exception as e:
        print(f"Telegram error: {e}")
        return False

def init_openai():
    """Initialize OpenAI client"""
    global openai_client
    try:
        api_key = os.environ.get('OPENAI_API_KEY')
        print(f"Debug: API key exists: {bool(api_key)}")
        if api_key:
            # Initialize OpenAI client with minimal parameters
            openai_client = OpenAI()  # Will use OPENAI_API_KEY from environment
            print("OpenAI client initialized successfully")
            return True
        else:
            print("Warning: OPENAI_API_KEY not found in environment variables")
            return False
    except Exception as e:
        print(f"Error initializing OpenAI: {e}")
        return False

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

def get_position_info(fen):
    """Get detailed position information for GPT context"""
    try:
        board = chess.Board(fen)
        
        # Basic position info
        turn = "White" if board.turn else "Black"
        move_number = board.fullmove_number
        
        # Game phase
        pieces = len([p for p in board.piece_map().values()])
        if move_number <= 10:
            phase = "opening"
        elif pieces <= 10:
            phase = "endgame"  
        else:
            phase = "middlegame"
            
        # Checks and threats
        in_check = board.is_check()
        legal_moves = list(board.legal_moves)
        
        # Material count
        material = {"white": 0, "black": 0}
        piece_values = {"p": 1, "n": 3, "b": 3, "r": 5, "q": 9}
        
        for square, piece in board.piece_map().items():
            color = "white" if piece.color else "black"
            material[color] += piece_values.get(piece.symbol().lower(), 0)
        
        return {
            "turn": turn,
            "move_number": move_number,
            "phase": phase,
            "in_check": in_check,
            "legal_moves_count": len(legal_moves),
            "material_white": material["white"],
            "material_black": material["black"],
            "material_balance": material["white"] - material["black"]
        }
    except Exception as e:
        return {"error": str(e)}

def get_gpt_chess_response(message, fen):
    """Get intelligent chess response from GPT-4o"""
    try:
        if not openai_client:
            return None
            
        # Get position analysis
        pos_info = get_position_info(fen)
        
        # Create context-rich prompt
        system_prompt = f"""You are a world-class chess coach and analyst. You help players understand positions, strategy, and tactics.

**Current Position Analysis:**
- **Turn to move:** {pos_info.get('turn', 'Unknown')}
- **Move number:** {pos_info.get('move_number', 'Unknown')}
- **Game phase:** {pos_info.get('phase', 'Unknown')}
- **In check:** {pos_info.get('in_check', False)}
- **Legal moves:** {pos_info.get('legal_moves_count', 0)}
- **Material balance:** {pos_info.get('material_balance', 0)} (positive favors White)

**FEN:** {fen}

**Formatting Instructions:**
- Use **Opening Name** format for chess openings (e.g., **Italian Game**, **Sicilian Defense**, **Queen's Gambit**)
- Use `move` format for all chess moves (e.g., `1.e4`, `Nf3`, `O-O`, `Bxf7+`)
- Use **bold** for important chess concepts and terms
- Use • for bullet points
- Keep responses concise and well-formatted

Provide helpful, accurate chess advice. Be concise but well-formatted.
Only answer the question asked. Keep responses under 150 words."""

        response = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": message}
            ],
            max_tokens=300,
            temperature=0.1
        )
        
        return response.choices[0].message.content.strip()
        
    except Exception as e:
        print(f"OpenAI API error: {e}")
        return None

@app.route('/api/chat', methods=['POST'])
def chat():
    """Handle chat messages and provide chess advice using GPT-4o"""
    try:
        data = request.json
        message = data.get('message', '')
        fen = data.get('fen', '')
        
        if not message:
            return jsonify({'error': 'Message is required'}), 400
        
        # Try to get GPT-4o response first
        gpt_response = None
        if fen and openai_client:
            gpt_response = get_gpt_chess_response(message, fen)
        
        # Use GPT response if available, otherwise show agent not working
        if gpt_response:
            response = gpt_response
        else:
            response = "Agent not working"
        
        return jsonify({
            'response': response,
            'status': 'success',
            'source': 'gpt-4o' if gpt_response else 'fallback'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/telegram/setup', methods=['GET'])
def telegram_setup():
    """Get Telegram bot updates to find chat ID"""
    try:
        global TELEGRAM_CHAT_ID
        
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUpdates"
        response = requests.get(url, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if data.get('result'):
                # Get the latest chat ID
                latest_update = data['result'][-1]
                chat_id = latest_update['message']['chat']['id']
                TELEGRAM_CHAT_ID = chat_id
                
                return jsonify({
                    'status': 'success',
                    'chat_id': chat_id,
                    'message': 'Telegram chat ID configured successfully!'
                })
            else:
                return jsonify({
                    'status': 'info',
                    'message': 'No messages found. Send a message to the bot first.'
                })
        else:
            return jsonify({'error': 'Failed to get Telegram updates'}), 500
            
    except Exception as e:
        return jsonify({'error': f'Telegram setup error: {str(e)}'}), 500

@app.route('/api/track-visit', methods=['POST'])
def track_visit():
    """Track website visits and send to Telegram"""
    try:
        data = request.json or {}
        
        # Get visitor info
        user_agent = request.headers.get('User-Agent', 'Unknown')
        ip_address = request.headers.get('X-Forwarded-For', request.remote_addr)
        referrer = data.get('referrer', 'Direct')
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        # Try to get location from IP
        location_info = "Unknown"
        try:
            # Using a free IP geolocation service
            geo_response = requests.get(f"http://ip-api.com/json/{ip_address}", timeout=3)
            if geo_response.status_code == 200:
                geo_data = geo_response.json()
                if geo_data.get('status') == 'success':
                    city = geo_data.get('city', 'Unknown')
                    country = geo_data.get('country', 'Unknown')
                    location_info = f"{city}, {country}"
        except Exception as e:
            print(f"Geolocation error: {e}")
        
        # Create telegram message
        telegram_message = f"""
🌍 *Website Visit Tracked*

👤 *Visitor Info:*
📍 *Location:* {location_info}
🌐 *IP:* {ip_address}
🔗 *Referrer:* {referrer}
🕒 *Time:* {timestamp}
📱 *Browser:* {user_agent[:50]}...
"""
        
        # Send to telegram
        telegram_sent = send_telegram_message(telegram_message)
        if telegram_sent:
            print(f"Visit tracked: {ip_address} from {location_info}")
        else:
            print(f"Failed to send visit notification for {ip_address}")
        
        return jsonify({
            'status': 'success',
            'message': 'Visit tracked successfully'
        })
        
    except Exception as e:
        print(f"Visit tracking error: {e}")
        return jsonify({'error': 'Failed to track visit'}), 500

@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok', 
        'message': 'Chess API is running',
        'engine': 'Stockfish' if engine else 'Random',
        'stockfish_available': engine is not None
    })

@app.route('/api/feedback', methods=['POST'])
def submit_feedback():
    """Handle feedback submissions"""
    try:
        data = request.json
        feedback_type = data.get('type', '')
        title = data.get('title', '')
        message = data.get('message', '')
        email = data.get('email', '')
        
        if not title or not message:
            return jsonify({'error': 'Title and message are required'}), 400
        
        # For now, just log the feedback
        # You can later save to database, send email, etc.
        feedback_data = {
            'type': feedback_type,
            'title': title,
            'message': message,
            'email': email,
            'timestamp': data.get('timestamp'),
            'user_agent': data.get('userAgent'),
            'url': data.get('url')
        }
        
        print(f"Feedback received: {feedback_data}")
        
        # Send feedback to Telegram bot
        telegram_message = f"""
🔔 *New Feedback Received*

📋 *Type:* {feedback_type or 'Not specified'}
📝 *Title:* {title}
💬 *Message:* {message}
📧 *Email:* {email or 'Not provided'}
🕒 *Time:* {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
🌐 *URL:* {data.get('url', 'Not provided')}
"""
        
        telegram_sent = send_telegram_message(telegram_message)
        if telegram_sent:
            print("Feedback sent to Telegram successfully")
        else:
            print("Failed to send feedback to Telegram")
        
        return jsonify({
            'status': 'success',
            'message': 'Feedback received successfully!'
        })
        
    except Exception as e:
        print(f"Feedback submission error: {e}")
        return jsonify({'error': 'Failed to submit feedback'}), 500

def cleanup():
    """Clean up resources"""
    global engine
    if engine:
        try:
            engine.quit()
        except:
            pass

if __name__ == '__main__':
    # Initialize Stockfish and OpenAI on startup
    init_stockfish()
    init_openai()
    
    try:
        app.run(debug=True, host='0.0.0.0', port=5100)
    finally:
        cleanup()
