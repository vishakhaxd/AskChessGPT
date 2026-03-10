from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import chess
import chess.engine
import random
import os
import json
import uuid
import time
from openai import OpenAI
from dotenv import load_dotenv

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

engine = None
openai_client = None
load_dotenv()

# -- Session memory (in-process) -----------------------------------------------
sessions = {}
MAX_SESSION_HISTORY = 12
SESSION_TTL = 7200

def get_session(sid):
    if sid and sid in sessions:
        return sessions[sid]
    new_sid = sid or str(uuid.uuid4())
    sessions[new_sid] = {'messages': [], 'created': time.time()}
    return sessions[new_sid]

def prune_sessions():
    now = time.time()
    expired = [k for k, v in sessions.items() if now - v['created'] > SESSION_TTL]
    for k in expired:
        del sessions[k]

# -- Opening book ---------------------------------------------------------------
OPENINGS = {
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR": "King\'s Pawn Opening",
    "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR": "Queen\'s Pawn Opening",
    "rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR": "English Opening",
    "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R": "Reti Opening",
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR": "Open Game",
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R": "King\'s Knight Opening",
    "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R": "Italian / Spanish complex",
    "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R": "Ruy Lopez",
    "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R": "Italian Game",
    "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R": "Two Knights Defense",
    "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R": "Giuoco Piano",
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR": "Vienna Game",
    "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR": "Sicilian Defense",
    "rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R": "Open Sicilian",
    "rnbqkbnr/pp1ppppp/8/2p5/4P3/2N5/PPPP1PPP/R1BQKBNR": "Closed Sicilian",
    "rnbqkbnr/pp1ppppp/3p4/8/3PP3/8/PPP2PPP/RNBQKBNR": "Sicilian Najdorf zone",
    "rnbqkb1r/pp2pppp/3p1n2/8/3NP3/8/PPP2PPP/RNBQKB1R": "Sicilian Classical",
    "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR": "Scandinavian Defense",
    "rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR": "Queen\'s Pawn Game",
    "rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR": "Queen\'s Gambit",
    "rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/8/PP2PPPP/RNBQKBNR": "Queen\'s Gambit Declined",
    "rnbqkbnr/ppp2ppp/4p3/8/2pP4/8/PP2PPPP/RNBQKBNR": "Queen\'s Gambit Accepted",
    "rnbqkb1r/ppp1pppp/5n2/3p4/2PP4/8/PP2PPPP/RNBQKBNR": "Queen\'s Gambit (Nf6)",
    "rnbqkb1r/pppppp1p/5np1/8/2PP4/8/PP2PPPP/RNBQKBNR": "King\'s Indian Defense",
    "rnbqk2r/ppppppbp/5np1/8/2PP4/2N5/PP2PPPP/R1BQKBNR": "King\'s Indian Classical",
    "rnbqkb1r/pppp1ppp/4pn2/8/2PP4/8/PP2PPPP/RNBQKBNR": "Nimzo/Queen\'s Indian zone",
    "rnbqk2r/pppp1ppp/4pn2/8/1bPP4/2N5/PP2PPPP/R1BQKBNR": "Nimzo-Indian Defense",
    "rnbqkb1r/pppp1ppp/4pn2/8/2PP4/5N2/PP2PPPP/RNBQKB1R": "Queen\'s Indian Defense",
    "rnbqkbnr/pppppp1p/6p1/8/4P3/8/PPPP1PPP/RNBQKBNR": "Modern Defense",
    "rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR": "Caro-Kann Defense",
    "rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR": "French Defense",
    "rnbqkbnr/pppp1ppp/8/4p3/4PP2/8/PPPP2PP/RNBQKBNR": "King\'s Gambit",
    "rnbqkb1r/pppppppp/5n2/8/3P4/8/PPP1PPPP/RNBQKBNR": "Indian Game",
    "rnbqkbnr/ppp1pppp/3p4/8/4P3/8/PPPP1PPP/RNBQKBNR": "Pirc Defense",
    "rnbqkbnr/ppp1pppp/3p4/8/3P4/8/PPP1PPPP/RNBQKBNR": "Pirc / Philidor zone",
}

def detect_opening(fen):
    return OPENINGS.get(fen.split()[0] if fen else '')

# -- ELO profiles ---------------------------------------------------------------

def clamp_elo(elo):
    try: return max(400, min(3000, int(elo)))
    except (TypeError, ValueError): return 1500

def get_engine_profile(elo):
    n = clamp_elo(elo)
    if n < 800:  return {'elo': n, 'uci_elo': 1320, 'skill': 0,  'depth': 4,  'time': 0.03, 'multipv': 5, 'exploration': 0.95, 'max_score_gap': 350}
    if n < 1000: return {'elo': n, 'uci_elo': 1350, 'skill': 1,  'depth': 6,  'time': 0.05, 'multipv': 5, 'exploration': 0.8,  'max_score_gap': 220}
    if n < 1300: return {'elo': n, 'uci_elo': 1450, 'skill': 3,  'depth': 7,  'time': 0.08, 'multipv': 4, 'exploration': 0.55, 'max_score_gap': 180}
    if n < 1600: return {'elo': n, 'uci_elo': 1600, 'skill': 6,  'depth': 9,  'time': 0.12, 'multipv': 4, 'exploration': 0.32, 'max_score_gap': 130}
    if n < 1900: return {'elo': n, 'uci_elo': 1800, 'skill': 9,  'depth': 11, 'time': 0.22, 'multipv': 3, 'exploration': 0.16, 'max_score_gap': 90}
    if n < 2300: return {'elo': n, 'uci_elo': min(2500, n), 'skill': 14, 'depth': 13, 'time': 0.35, 'multipv': 2, 'exploration': 0.05, 'max_score_gap': 50}
    return {'elo': n, 'uci_elo': min(2850, n), 'skill': 20, 'depth': 15, 'time': 0.6, 'multipv': 1, 'exploration': 0.0, 'max_score_gap': 20}

def configure_engine_for_profile(profile):
    if not engine: return
    options = getattr(engine, 'options', {})
    config = {}
    if 'UCI_LimitStrength' in options and 'UCI_Elo' in options:
        config['UCI_LimitStrength'] = True
        config['UCI_Elo'] = profile['uci_elo']
    if 'Skill Level' in options:
        config['Skill Level'] = profile['skill']
    if config: engine.configure(config)

# -- Engine helpers ---------------------------------------------------------------

def normalize_analysis_entries(analysis):
    return analysis if isinstance(analysis, list) else [analysis]

def pv_to_san(board, pv, limit=5):
    b = board.copy()
    sans = []
    for m in pv[:limit]:
        if m not in b.legal_moves: break
        sans.append(b.san(m))
        b.push(m)
    return sans

def deep_analyze(board, multipv=3, depth=15, time_limit=0.4):
    if not engine: return []
    options = getattr(engine, 'options', {})
    config = {}
    if 'UCI_LimitStrength' in options: config['UCI_LimitStrength'] = False
    if 'Skill Level' in options: config['Skill Level'] = 20
    if config: engine.configure(config)
    analysis = engine.analyse(board, chess.engine.Limit(depth=depth, time=time_limit), multipv=multipv)
    candidates = []
    for entry in normalize_analysis_entries(analysis):
        pv = entry.get('pv') or []
        move = pv[0] if pv else None
        if not move: continue
        score_obj = entry.get('score')
        cp = score_obj.relative.score(mate_score=100000) if score_obj else 0
        line = pv_to_san(board, pv)
        candidates.append({'move': move, 'san': board.san(move), 'score': cp, 'line': line})
    return candidates

def pick_weighted_engine_move(analysis, legal_moves, profile):
    candidates = []
    legal_set = set(legal_moves)
    for entry in normalize_analysis_entries(analysis):
        pv = entry.get('pv') or []
        move = pv[0] if pv else None
        if not move or move not in legal_set: continue
        score_obj = entry.get('score')
        score = score_obj.relative.score(mate_score=100000) if score_obj else 0
        candidates.append((move, score))
    if not candidates: return None
    candidates.sort(key=lambda x: x[1], reverse=True)
    if len(candidates) == 1 or profile['exploration'] <= 0:
        return candidates[0][0]
    best = candidates[0][1]
    wc, ws = [], []
    for i, (m, s) in enumerate(candidates):
        gap = max(0, best - s)
        if i > 0 and gap > profile['max_score_gap']: continue
        w = 1.0 if i == 0 else profile['exploration'] / (i + 1)
        w *= max(0.15, 1 - (gap / max(profile['max_score_gap'], 1)))
        wc.append(m)
        ws.append(max(w, 0.05))
    return random.choices(wc, weights=ws, k=1)[0] if wc else candidates[0][0]

def get_engine_move(board, elo):
    if not engine: return None, None
    profile = get_engine_profile(elo)
    configure_engine_for_profile(profile)
    analysis = engine.analyse(board, chess.engine.Limit(depth=profile['depth'], time=profile['time']), multipv=profile['multipv'])
    return pick_weighted_engine_move(analysis, list(board.legal_moves), profile), profile

# -- Position features ---------------------------------------------------------------

def format_score(cp):
    if cp >= 99900: return '+M'
    if cp <= -99900: return '-M'
    return f'{cp/100:+.1f}'

def get_quality_label(delta):
    if delta >= -10: return 'brilliant'
    if delta >= -40: return 'strong'
    if delta >= -80: return 'good'
    if delta >= -150: return 'inaccuracy'
    if delta >= -300: return 'mistake'
    return 'blunder'

def get_quality_emoji(label):
    return {'brilliant': '!!', 'strong': '!', 'good': '', 'inaccuracy': '?!', 'mistake': '?', 'blunder': '??'}.get(label, '')

def analyze_position_features(board):
    features = []
    turn = board.turn
    opp = not turn
    if board.is_check():
        features.append('King is in check')
    for sq in chess.SQUARES:
        piece = board.piece_at(sq)
        if piece and piece.color == turn and piece.piece_type != chess.KING:
            attackers = board.attackers(opp, sq)
            defenders = board.attackers(turn, sq)
            if attackers and len(defenders) < len(attackers):
                features.append(f'{("White" if turn else "Black")} {chess.piece_name(piece.piece_type)} on {chess.square_name(sq)} is hanging')
    king_sq = board.king(turn)
    if king_sq is not None:
        for sq in chess.SQUARES:
            piece = board.piece_at(sq)
            if piece and piece.color == turn and piece.piece_type != chess.KING:
                test = board.copy()
                test.remove_piece_at(sq)
                if test.is_attacked_by(opp, king_sq):
                    features.append(f'{chess.piece_name(piece.piece_type).capitalize()} on {chess.square_name(sq)} is pinned')
    for f in range(8):
        has_wp = any(board.piece_at(chess.square(f, r)) == chess.Piece(chess.PAWN, chess.WHITE) for r in range(8))
        has_bp = any(board.piece_at(chess.square(f, r)) == chess.Piece(chess.PAWN, chess.BLACK) for r in range(8))
        if not has_wp and not has_bp:
            col = chr(ord('a') + f)
            for r in range(8):
                p = board.piece_at(chess.square(f, r))
                if p and p.piece_type == chess.ROOK:
                    features.append(f'Rook on open {col}-file')
                    break
    for sq in chess.SQUARES:
        piece = board.piece_at(sq)
        if not piece or piece.piece_type != chess.PAWN: continue
        f_idx, r = chess.square_file(sq), chess.square_rank(sq)
        passed = True
        if piece.color == chess.WHITE:
            for cf in [f_idx-1, f_idx, f_idx+1]:
                if 0 <= cf <= 7:
                    for cr in range(r+1, 7):
                        b = board.piece_at(chess.square(cf, cr))
                        if b and b.piece_type == chess.PAWN and b.color == chess.BLACK:
                            passed = False; break
        else:
            for cf in [f_idx-1, f_idx, f_idx+1]:
                if 0 <= cf <= 7:
                    for cr in range(1, r):
                        b = board.piece_at(chess.square(cf, cr))
                        if b and b.piece_type == chess.PAWN and b.color == chess.WHITE:
                            passed = False; break
        if passed:
            color = 'White' if piece.color == chess.WHITE else 'Black'
            features.append(f'{color} passed pawn on {chess.square_name(sq)}')
    if board.has_castling_rights(turn):
        features.append(f'{("White" if turn else "Black")} can still castle')
    return features[:6]

# -- Rich context builder ---------------------------------------------------------------

def get_position_context(fen, last_move=None):
    board = chess.Board(fen)
    turn = "White" if board.turn else "Black"
    mn = board.fullmove_number
    pc = len(board.piece_map())
    phase = "opening" if mn <= 8 else ("endgame" if pc <= 12 else "middlegame")
    vals = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}
    wm = sum(vals.get(p.piece_type, 0) for p in board.piece_map().values() if p.color == chess.WHITE)
    bm = sum(vals.get(p.piece_type, 0) for p in board.piece_map().values() if p.color == chess.BLACK)
    opening = detect_opening(fen)
    candidates = deep_analyze(board, multipv=3, depth=15, time_limit=0.4)
    features = analyze_position_features(board)
    lm_analysis = _analyze_last_move(last_move, candidates) if last_move else None

    ctx = f"POSITION STATE:\n"
    ctx += f"  FEN: {fen}\n"
    ctx += f"  Turn: {turn} (move {mn}), Phase: {phase}\n"
    ctx += f"  Material: White {wm} / Black {bm} (balance {wm-bm:+d})\n"
    ctx += f"  In check: {board.is_check()}"
    if opening: ctx += f"\n  Opening: **{opening}**"
    if candidates:
        ctx += "\n\nENGINE ANALYSIS (Stockfish depth 15):"
        for i, c in enumerate(candidates):
            ctx += f"\n  {i+1}. `{c['san']}` ({format_score(c['score'])}) line: {' '.join(c['line'])}"
    if features:
        ctx += "\n\nPOSITION FEATURES:"
        for feat in features:
            ctx += f"\n  - {feat}"
    if lm_analysis:
        ctx += f"\n\nLAST MOVE PLAYED:\n{lm_analysis}"
    return ctx

def _analyze_last_move(last_move, current_candidates):
    before_fen = last_move.get('beforeFen')
    uci = last_move.get('uci')
    san = last_move.get('san') or uci
    actor = 'Player' if last_move.get('actor') == 'player' else 'AI'
    if not before_fen or not uci: return None
    try:
        before_board = chess.Board(before_fen)
        move = chess.Move.from_uci(uci)
    except ValueError: return None
    if move not in before_board.legal_moves: return None
    before_cands = deep_analyze(before_board, multipv=4, depth=15, time_limit=0.4)
    if not before_cands: return None
    best = before_cands[0]
    played_score = None
    for c in before_cands:
        if c['move'] == move:
            played_score = c['score']; break
    if played_score is None: played_score = best['score'] - 200
    delta = played_score - best['score']
    quality = get_quality_label(delta)
    emoji = get_quality_emoji(quality)
    result = f"  {actor} played `{san}` {emoji} -- **{quality}**\n"
    result += f"  Score: {format_score(played_score)} (best was `{best['san']}` at {format_score(best['score'])})"
    if delta < -80 and best['san'] != san:
        result += f"\n  Lost ~{abs(delta)}cp. Better: `{best['san']}` ({' '.join(best['line'])})"
    return result

# -- System prompt ---------------------------------------------------------------

SYSTEM_PROMPT = """You are **AskChessGPT**, a world-class chess coach (2400+ strength) who explains positions in clear, practical language for club players (700-1800 Elo).

## Your approach
- Ground every explanation in the ENGINE ANALYSIS data provided. Never invent moves.
- Use `backtick` notation for moves (e.g. `Nf3`, `e4`).
- Name openings in **bold** (e.g. **Sicilian Defense**).
- Be concise: 80-150 words unless deep analysis is requested.
- Use bullet points for lists.

## Response types (detect from user query):
- **Move explanation**: Reference LAST MOVE PLAYED data. Say if it was good/bad, why, and what was better.
- **Candidate moves**: Present top 3 engine moves with practical reasoning.
- **Plan/strategy**: What should each side do? Reference pawn structure, piece activity, king safety.
- **Mistake review**: Show score drop, name what went wrong, explain the better move.
- **Opening guidance**: Name the opening, explain typical plans.
- **Position overview**: Who stands better and why.

## Proactive analysis
For [PROACTIVE] messages: give a brief 40-80 word coach comment. Focus on:
- Was the move good or bad? (use the quality rating)
- One tip for what to focus on next
- If a mistake, briefly name the better move
Be encouraging but honest.

## Rules
- NEVER fabricate lines. Only reference moves from the analysis data.
- Format moves in `backticks`, concepts in **bold**.
- If a blunder, be constructive: explain what to watch for next time."""

def build_llm_messages(session, position_context, user_message, is_proactive=False):
    messages = [{"role": "system", "content": SYSTEM_PROMPT + "\n\n" + position_context}]
    for msg in session['messages'][-MAX_SESSION_HISTORY:]:
        messages.append(msg)
    tag = "[PROACTIVE] " if is_proactive else ""
    messages.append({"role": "user", "content": f"{tag}{user_message}"})
    return messages

# -- LLM calls ---------------------------------------------------------------

def call_llm(messages, max_tokens=400):
    if not openai_client: return None
    try:
        r = openai_client.chat.completions.create(
            model="anthropic/claude-opus-4.6", messages=messages,
            max_tokens=max_tokens, temperature=0.15)
        return r.choices[0].message.content.strip()
    except Exception as e:
        print(f"[chat] LLM failed: {e}")
        return None

def call_llm_stream(messages, max_tokens=400):
    if not openai_client:
        yield "data: " + json.dumps({"done": True, "full": ""}) + "\n\n"
        return
    try:
        stream = openai_client.chat.completions.create(
            model="anthropic/claude-opus-4.6", messages=messages,
            max_tokens=max_tokens, temperature=0.15, stream=True)
        full = ""
        for chunk in stream:
            d = chunk.choices[0].delta if chunk.choices else None
            if d and d.content:
                full += d.content
                yield "data: " + json.dumps({"content": d.content}) + "\n\n"
        yield "data: " + json.dumps({"done": True, "full": full}) + "\n\n"
    except Exception as e:
        print(f"[chat] Stream failed: {e}")
        yield "data: " + json.dumps({"error": str(e)}) + "\n\n"

# -- Fallback ---------------------------------------------------------------

def get_fallback_response(fen, message, last_move=None):
    board = chess.Board(fen)
    candidates = deep_analyze(board, multipv=3)
    if not candidates:
        return f'{("White" if board.turn else "Black")} to move. Engine unavailable.'
    best = candidates[0]
    ml = message.lower()
    if any(w in ml for w in ['candidate', 'best', 'suggest']):
        lines = [f"  {c['san']} ({format_score(c['score'])}) {' '.join(c['line'])}" for c in candidates[:3]]
        return "Top moves:\n" + "\n".join(lines)
    if last_move and any(w in ml for w in ['last', 'why', 'explain']):
        a = _analyze_last_move(last_move, candidates)
        if a: return a
    return f'{("White" if board.turn else "Black")} to move. Best: `{best["san"]}` ({format_score(best["score"])}). Line: {" ".join(best["line"])}'

# -- Init ---------------------------------------------------------------

def init_openai():
    global openai_client
    try:
        key = os.environ.get('OPENROUTER_API_KEY')
        if key:
            openai_client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=key)
            print("[chat] Using OpenRouter API")
            return True
        key = os.environ.get('OPENAI_API_KEY')
        if key:
            openai_client = OpenAI(api_key=key)
            print("[chat] Using OpenAI API")
            return True
        print("[chat] No LLM key -- fallback only")
        return False
    except Exception as e:
        print(f"[chat] Init error: {e}")
        return False

def init_stockfish():
    global engine
    try:
        import platform
        system = platform.system().lower()
        paths = {'linux': ['./stockfish-linux', './stockfish', 'stockfish'],
                 'darwin': ['./stockfish-macos-m1-apple-silicon', './stockfish', 'stockfish']
                 }.get(system, ['./stockfish.exe', './stockfish', 'stockfish'])
        for p in paths:
            try:
                if os.path.exists(p) or p == 'stockfish':
                    engine = chess.engine.SimpleEngine.popen_uci(p)
                    return True
            except Exception: continue
        return False
    except Exception: return False

# -- Routes ---------------------------------------------------------------

@app.route('/api/move', methods=['POST'])
def api_move():
    try:
        data = request.json
        fen = data.get('fen')
        elo = clamp_elo(data.get('elo', 1500))
        if not fen: return jsonify({'error': 'FEN required'}), 400
        board = chess.Board(fen)
        legal = list(board.legal_moves)
        if not legal: return jsonify({'error': 'No legal moves'}), 400
        move, profile = (None, None)
        if engine:
            try: move, profile = get_engine_move(board, elo)
            except Exception: pass
        if not move: move = random.choice(legal)
        if move not in legal: move = legal[0]
        return jsonify({'move': str(move), 'elo': elo, 'engine': 'Stockfish' if engine else 'Random'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/chat', methods=['POST'])
def api_chat():
    try:
        data = request.json
        message = data.get('message', '')
        fen = data.get('fen', '')
        last_move = data.get('lastMove')
        session_id = data.get('sessionId', '')
        do_stream = data.get('stream', False)
        if not message: return jsonify({'error': 'Message required'}), 400
        prune_sessions()
        session = get_session(session_id)
        try:
            pos_ctx = get_position_context(fen, last_move) if fen else "No position provided."
        except Exception:
            pos_ctx = f"FEN: {fen}" if fen else "No position provided."
        if openai_client:
            msgs = build_llm_messages(session, pos_ctx, message)
            if do_stream:
                def gen():
                    full = ""
                    for chunk in call_llm_stream(msgs):
                        try:
                            payload = json.loads(chunk.replace('data: ', '').strip())
                            if payload.get('content'): full += payload['content']
                            if payload.get('done') and payload.get('full'): full = payload['full']
                        except Exception: pass
                        yield chunk
                    if full:
                        session['messages'].append({"role": "user", "content": message})
                        session['messages'].append({"role": "assistant", "content": full})
                return Response(gen(), mimetype='text/event-stream',
                                headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})
            resp = call_llm(msgs)
            if resp:
                session['messages'].append({"role": "user", "content": message})
                session['messages'].append({"role": "assistant", "content": resp})
                return jsonify({'response': resp, 'status': 'success', 'source': 'llm', 'sessionId': session_id})
        fb = get_fallback_response(fen, message, last_move) if fen else "Start a game first."
        return jsonify({'response': fb, 'status': 'success', 'source': 'fallback', 'sessionId': session_id})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/analyze-move', methods=['POST'])
def api_analyze_move():
    try:
        data = request.json
        fen = data.get('fen', '')
        last_move = data.get('lastMove')
        session_id = data.get('sessionId', '')
        do_stream = data.get('stream', False)
        if not fen or not last_move: return jsonify({'error': 'FEN and lastMove required'}), 400
        prune_sessions()
        session = get_session(session_id)
        try:
            pos_ctx = get_position_context(fen, last_move)
        except Exception:
            pos_ctx = f"FEN: {fen}"
        actor = 'I' if last_move.get('actor') == 'player' else 'AI'
        san = last_move.get('san', '?')
        prompt = f"{actor} just played {san}. Give a quick coach comment."
        if openai_client:
            msgs = build_llm_messages(session, pos_ctx, prompt, is_proactive=True)
            if do_stream:
                def gen():
                    full = ""
                    for chunk in call_llm_stream(msgs, max_tokens=200):
                        try:
                            payload = json.loads(chunk.replace('data: ', '').strip())
                            if payload.get('content'): full += payload['content']
                            if payload.get('done') and payload.get('full'): full = payload['full']
                        except Exception: pass
                        yield chunk
                    if full:
                        session['messages'].append({"role": "assistant", "content": f"[Auto] {full}"})
                return Response(gen(), mimetype='text/event-stream',
                                headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})
            resp = call_llm(msgs, max_tokens=200)
            if resp:
                session['messages'].append({"role": "assistant", "content": f"[Auto] {resp}"})
                return jsonify({'response': resp, 'status': 'success', 'source': 'llm'})
        lma = _analyze_last_move(last_move, [])
        return jsonify({'response': lma or 'No analysis available.', 'status': 'success', 'source': 'fallback'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/gameplay')
def gameplay():
    return app.send_static_file('gameplay.html')

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'engine': 'Stockfish' if engine else 'Random',
                    'stockfish': engine is not None, 'llm': bool(openai_client)})

def cleanup():
    global engine
    if engine:
        try: engine.quit()
        except Exception: pass

if __name__ == '__main__':
    init_stockfish()
    init_openai()
    try:
        app.run(debug=True, host='0.0.0.0', port=5100)
    finally:
        cleanup()
