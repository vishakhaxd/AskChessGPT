from flask import Flask, request, jsonify
from flask_cors import CORS
import chess
import chess.engine
import random
import os
import requests
import ipaddress
import time
from datetime import datetime
from openai import OpenAI

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)  # Enable CORS for frontend

# Global Stockfish engine
engine = None

# OpenAI client
openai_client = None

# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN')
TELEGRAM_CHAT_ID = None  # Will be loaded from file on startup
TELEGRAM_CONFIG_FILE = 'telegram_config.txt'

# Simple in-memory cache for geolocation to reduce external calls
GEO_CACHE = {}  # ip -> (timestamp, location_string)
GEO_CACHE_TTL = 3600  # seconds

def get_client_ip():
    """Extract real client IP considering common proxy headers."""
    # Priority order of headers
    header_order = [
        'CF-Connecting-IP',  # Cloudflare
        'X-Forwarded-For',
        'X-Real-IP'
    ]
    for header in header_order:
        val = request.headers.get(header)
        if val:
            # X-Forwarded-For can have multiple comma-separated IPs: client, proxy1, proxy2
            if header == 'X-Forwarded-For':
                first_ip = val.split(',')[0].strip()
                if first_ip:
                    return first_ip
            else:
                return val.strip()
    return request.remote_addr or '0.0.0.0'

def is_public_ip(ip_str):
    try:
        ip_obj = ipaddress.ip_address(ip_str)
        return not (ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_reserved or ip_obj.is_link_local)
    except Exception:
        return False

def geolocate_ip(ip_address):
    """Geolocate IP with caching and fallbacks. Returns human readable string."""
    now = time.time()
    cached = GEO_CACHE.get(ip_address)
    if cached and (now - cached[0]) < GEO_CACHE_TTL:
        return cached[1]

    # Skip geolocation for non-public IPs
    if not is_public_ip(ip_address):
        location = 'Local / Private Network'
        GEO_CACHE[ip_address] = (now, location)
        return location

    # Try providers in order (minimal logic)
    providers = [
        ('ip-api', f"http://ip-api.com/json/{ip_address}", 'city', 'country', 'status', 'success'),  # HTTP only
        ('ipwhois', f"https://ipwho.is/{ip_address}", 'city', 'country', 'success', True)
    ]
    for name, url, city_key, country_key, status_key, success_val in providers:
        try:
            resp = requests.get(url, timeout=3)
            if resp.status_code == 200:
                data = resp.json()
                status_ok = (data.get(status_key) == success_val)
                if status_ok:
                    city = data.get(city_key) or ''
                    country = data.get(country_key) or ''
                    location_parts = [p for p in [city, country] if p]
                    location = ', '.join(location_parts) if location_parts else 'Unknown'
                    GEO_CACHE[ip_address] = (now, location)
                    return location
        except Exception as e:
            print(f"Geolocation provider {name} failed for {ip_address}: {e}")
            continue
    location = 'Unknown'
    GEO_CACHE[ip_address] = (now, location)
    return location

def load_telegram_config():
    """Load Telegram chat ID from file"""
    global TELEGRAM_CHAT_ID
    try:
        if os.path.exists(TELEGRAM_CONFIG_FILE):
            with open(TELEGRAM_CONFIG_FILE, 'r') as f:
                chat_id = f.read().strip()
                if chat_id:
                    TELEGRAM_CHAT_ID = int(chat_id)
                    print(f"Loaded Telegram chat ID: {TELEGRAM_CHAT_ID}")
                    return True
    except Exception as e:
        print(f"Error loading Telegram config: {e}")
    return False

def save_telegram_config(chat_id):
    """Save Telegram chat ID to file"""
    try:
        with open(TELEGRAM_CONFIG_FILE, 'w') as f:
            f.write(str(chat_id))
        print(f"Saved Telegram chat ID: {chat_id}")
        return True
    except Exception as e:
        print(f"Error saving Telegram config: {e}")
        return False

def send_telegram_message(message):
    """Send message to Telegram bot"""
    try:
        if not TELEGRAM_BOT_TOKEN:
            print("No Telegram bot token configured")
            return False
        
        if not TELEGRAM_CHAT_ID:
            print("No Telegram chat ID configured. Please call /api/telegram/setup first")
            return False
            
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        data = {
            "chat_id": TELEGRAM_CHAT_ID,
            "text": message,
            "parse_mode": "Markdown"
        }
        
        response = requests.post(url, json=data, timeout=10)
        if response.status_code == 200:
            print("Telegram message sent successfully")
            return True
        else:
            print(f"Failed to send Telegram message: {response.status_code} - {response.text}")
            return False
        
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
        import platform
        system = platform.system().lower()
        
        # Auto-detect platform and set appropriate Stockfish paths
        stockfish_paths = []
        
        if system == 'linux':
            stockfish_paths = [
                './stockfish-linux',
                './stockfish',
                'stockfish'
            ]
        elif system == 'darwin':  # macOS
            stockfish_paths = [
                './stockfish-macos-m1-apple-silicon',
                './stockfish',
                'stockfish'
            ]
        else:  # Windows or other
            stockfish_paths = [
                './stockfish.exe',
                './stockfish',
                'stockfish'
            ]
        
        print(f"Platform detected: {system}")
        print(f"Trying Stockfish paths: {stockfish_paths}")
        
        for path in stockfish_paths:
            try:
                if os.path.exists(path) or path == 'stockfish':
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
        print(f"GPT function called - OpenAI client: {openai_client is not None}")
        
        if not openai_client:
            print("No OpenAI client available")
            return None
            
        # Get position analysis
        print("Getting position info...")
        pos_info = get_position_info(fen)
        print(f"Position info: {pos_info}")
        
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

        print("Calling OpenAI API...")
        response = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": message}
            ],
            max_tokens=300,
            temperature=0.1
        )
        
        result = response.choices[0].message.content.strip()
        print(f"OpenAI response received: {len(result)} characters")
        return result
        
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
        
        print(f"Chat API called - Message: {message[:50]}..., FEN: {fen[:50] if fen else 'None'}")
        print(f"OpenAI client available: {openai_client is not None}")
        
        if not message:
            print("Error: No message provided")
            return jsonify({'error': 'Message is required'}), 400
        
        # Try to get GPT-4o response first
        gpt_response = None
        if fen and openai_client:
            print("Attempting to get GPT response...")
            gpt_response = get_gpt_chess_response(message, fen)
            print(f"GPT response received: {gpt_response is not None}")
        else:
            print(f"Skipping GPT - FEN: {bool(fen)}, OpenAI client: {openai_client is not None}")
        
        # Use GPT response if available, otherwise show agent not working
        if gpt_response:
            response = gpt_response
            print("Using GPT response")
        else:
            response = "Agent not working"
            print("Using fallback response")
        
        return jsonify({
            'response': response,
            'status': 'success',
            'source': 'gpt-4o' if gpt_response else 'fallback'
        })
        
    except Exception as e:
        print(f"Chat API error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/telegram/setup', methods=['GET'])
def telegram_setup():
    """Get Telegram bot updates to find chat ID"""
    try:
        global TELEGRAM_CHAT_ID
        
        if not TELEGRAM_BOT_TOKEN:
            return jsonify({
                'status': 'error',
                'message': 'TELEGRAM_BOT_TOKEN environment variable not set'
            }), 500
        
        print("Setting up Telegram bot...")
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUpdates"
        response = requests.get(url, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            print(f"Telegram API response: {data}")
            
            if data.get('result'):
                # Get the latest chat ID
                latest_update = data['result'][-1]
                chat_id = latest_update['message']['chat']['id']
                TELEGRAM_CHAT_ID = chat_id
                
                # Save to file for persistence
                if save_telegram_config(chat_id):
                    # Test sending a message
                    test_message = "🎉 Telegram bot setup completed successfully!"
                    if send_telegram_message(test_message):
                        return jsonify({
                            'status': 'success',
                            'chat_id': chat_id,
                            'message': 'Telegram setup completed! Chat ID saved and test message sent.'
                        })
                    else:
                        return jsonify({
                            'status': 'warning',
                            'chat_id': chat_id,
                            'message': 'Chat ID saved but test message failed to send.'
                        })
                else:
                    return jsonify({
                        'status': 'error',
                        'message': 'Failed to save Telegram configuration'
                    }), 500
            else:
                return jsonify({
                    'status': 'info',
                    'message': 'No messages found. Please send a message to your bot first, then try again.'
                })
        else:
            print(f"Telegram API error: {response.status_code} - {response.text}")
            return jsonify({
                'status': 'error',
                'message': f'Failed to get Telegram updates: {response.status_code}'
            }), 500
            
    except Exception as e:
        print(f"Telegram setup error: {e}")
        return jsonify({'error': f'Telegram setup error: {str(e)}'}), 500

@app.route('/api/track-visit', methods=['POST'])
def track_visit():
    """Track website visits and send to Telegram"""
    try:
        data = request.json or {}
        # Get visitor info
        user_agent = request.headers.get('User-Agent', 'Unknown')
        ip_address = get_client_ip()
        referrer = data.get('referrer', 'Direct')
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        # Geolocate with new helper (cached, handles private IP)
        location_info = geolocate_ip(ip_address)

        # Create telegram message (markdown)
        telegram_message = f"""\n🌍 *Website Visit Tracked*\n\n👤 *Visitor Info:*\n📍 *Location:* {location_info}\n🌐 *IP:* {ip_address}\n🔗 *Referrer:* {referrer}\n🕒 *Time:* {timestamp}\n📱 *Browser:* {user_agent[:50]}...\n"""

        # Send to telegram
        telegram_sent = send_telegram_message(telegram_message)
        if telegram_sent:
            print(f"Visit tracked: {ip_address} from {location_info}")
        else:
            print(f"Failed to send visit notification for {ip_address}")

        return jsonify({'status': 'success', 'message': 'Visit tracked successfully'})
        
    except Exception as e:
        print(f"Visit tracking error: {e}")
        return jsonify({'error': 'Failed to track visit'}), 500

@app.route('/')
def index():
    """Serve the main page"""
    return app.send_static_file('index.html')

@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok', 
        'message': 'Chess API is running',
        'engine': 'Stockfish' if engine else 'Random',
        'stockfish_available': engine is not None,
        'telegram_bot_configured': bool(TELEGRAM_BOT_TOKEN),
        'telegram_chat_configured': bool(TELEGRAM_CHAT_ID),
        'openai_configured': bool(openai_client)
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
    # Initialize Stockfish, OpenAI and Telegram on startup
    init_stockfish()
    init_openai()
    load_telegram_config()
    
    try:
        app.run(debug=True, host='0.0.0.0', port=5100)
    finally:
        cleanup()
