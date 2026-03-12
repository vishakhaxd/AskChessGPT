# AskChessGPT: Architecture and Design of a Real-Time AI Chess Coaching Agent

**Vishakha Dikshit**
Full-Stack AI Engineer | AskChessGPT.com

---

## Abstract

AskChessGPT is a production AI chess coaching system that combines a classical search engine (Stockfish) with a large language model (LLM) to deliver real-time, pedagogically grounded move analysis and natural-language coaching. Unlike prior systems that present engine output as raw centipawn scores and principal variation lines, AskChessGPT introduces a hybrid agent architecture: a domain-specific context builder transforms a structured chess position into a rich grounding document, which is then consumed by an LLM operating under a carefully tuned system prompt to produce explanations calibrated to the learner's Elo band. The system implements bidirectional proactive analysis (triggered automatically on every move without user prompting), a Socratic coaching mode that withholds optimal moves and guides discovery, session memory across conversation turns, real-time token-level SSE streaming, and an Elo-stratified engine emulation layer that reproduces human-style mistakes at target playing strengths. This paper details the technical design of each subsystem, the reasoning behind key architectural choices, and the intended roadmap toward a richer agentic coaching loop.

---

## 1. Introduction

The dominant approach to chess improvement software has historically been deterministic: present the player with engine evaluations and expect them to derive insight. This works well for titled players who can read a +1.4 evaluation on move 23 and understand immediately that the g-file is the key. It fails for the 700–1800 Elo population — the largest segment of active chess players — who lack the pattern recognition to translate a centipawn score into a concrete plan.

Two generations of coaching tools have attempted to bridge this gap. The first, professional human coaches, provide high-quality explanation but are expensive and non-interactive at the board. The second, annotated game databases and YouTube lessons, deliver rich conceptual content but cannot respond to a specific position a student is looking at right now.

LLMs offer a third path: on-demand natural-language generation grounded in structured data. But a naive integration — passing a FEN string to GPT and asking "what should I play?" — produces confident hallucinations. LLMs do not play chess. They pattern-match from training data and will confidently describe moves that are illegal, lines that are wrong, and evaluations that are fabricated.

AskChessGPT is built on the premise that useful AI chess coaching requires a strict separation of concerns:

- **The engine knows what is true.** Stockfish computes evaluations and principal variation lines to depth 15. These are ground truth and are never contradicted.
- **The LLM knows how to explain.** Given grounded, structured context from the engine, the LLM generates pedagogically appropriate natural-language coaching.
- **The agent decides what to say and when.** A proactive analysis loop triggers unprompted, a Socratic mode adapts explanations based on move quality, and session memory enables multi-turn coaching conversations.

The result is a system where every explanation is grounded in verified engine analysis. The LLM never invents a move. Every candidate presented was computed by Stockfish.

---

## 2. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CLIENT (Browser)                                 │
│                                                                             │
│   ChessGame (JS)                                                            │
│   ├── Chessboard.js (board rendering / drag-drop)                           │
│   ├── chess.js (legal move generation / game state)                         │
│   ├── requestProactiveAnalysis() ──► POST /api/analyze-move  (SSE)          │
│   ├── generateAIResponse()        ──► POST /api/chat          (SSE)         │
│   └── makeAIMove()                ──► POST /api/move                        │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ HTTPS / Server-Sent Events
┌───────────────────────────────▼─────────────────────────────────────────────┐
│                         Flask API (Python)                                  │
│                      Azure App Service (Linux)                              │
│                                                                             │
│  ┌──────────────┐   ┌──────────────────────────────────────────────────┐    │
│  │  Stockfish   │   │              Agent Core                          │    │
│  │  (UCI)       │◄──│  get_position_context()                          │    │
│  │              │   │  ├── detect_opening()       (FEN lookup table)   │    │
│  │  Depth 15    │   │  ├── deep_analyze()         (multipv=3, d=15)    │    │
│  │  MultiPV     │   │  ├── analyze_position_features()                 │    │
│  │              │   │  └── _analyze_last_move()   (delta scoring)      │    │
│  └──────────────┘   │                                                  │    │
│                     │  build_llm_messages()                            │    │
│                     │  ├── SYSTEM_PROMPT (Socratic coaching persona)   │    │
│                     │  ├── position_context (grounding document)       │    │
│                     │  └── session['messages']  (conversation memory)  │    │
│                     └──────────────────────────────────────────────────┘    │
│                                        │                                    │
│                     ┌──────────────────▼─────────────────────────────┐      │
│                     │           OpenRouter API                       │      │
│                     │   claude-opus-4.6  (temperature=0.15)          │      │
│                     │   Streaming token delivery (SSE)               │      │
│                     └────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────────┘
```

The architecture contains four logically distinct subsystems: the **engine layer** (Stockfish, UCI protocol), the **position context builder**, the **LLM coaching agent**, and the **streaming client interface**. Each is described in detail below.

---

## 3. Engine Layer: Calibrated Strength Emulation

### 3.1 The Problem With Raw Engine Strength

A Stockfish instance running at its maximum capability (Elo ~3500) is pedagogically useless as an opponent for a 1200-rated player. The moves it plays are strategically coherent at a level that provides no learning signal — the player simply loses in ways they cannot understand. The key requirement is an engine that plays at a target Elo, making the *type* of mistakes a human at that level would make: hanging pieces occasionally, missing deep combinations, mishandling pawn endgames.

### 3.2 Elo Profile Architecture

The engine layer maps a target Elo to a structured profile that controls six independent parameters simultaneously:

```python
def get_engine_profile(elo):
    n = clamp_elo(elo)
    # Returns: uci_elo, skill_level, search_depth, time_limit,
    #          multipv_count, exploration_weight, max_score_gap
    if n < 800:
        return {'uci_elo': 1320, 'skill': 0, 'depth': 4,
                'time': 0.03, 'multipv': 5,
                'exploration': 0.95, 'max_score_gap': 350}
    if n < 1600:
        return {'uci_elo': 1600, 'skill': 6, 'depth': 9,
                'time': 0.12, 'multipv': 4,
                'exploration': 0.32, 'max_score_gap': 130}
    # ... continues to 2300+ (exploration=0.0, skill=20)
```

The parameters interact as follows:

- **`UCI_Elo` / `UCI_LimitStrength`**: Hardware-level engine handicapping. Causes Stockfish to introduce evaluation noise proportional to the target Elo gap from master strength.
- **`Skill Level` (0–20)**: Controls the probability of choosing a suboptimal move. At skill 0, approximately 50% of moves may be suboptimal.
- **`depth`**: Hard cap on search tree depth. A depth 4 search misses most tactical sequences longer than two moves.
- **`time`**: Per-move thinking time. At 0.03 seconds, the engine cannot conduct meaningful search even when depth would allow it.
- **`multipv`**: The number of candidate moves evaluated. This is critical for the weighted sampling layer.
- **`exploration` / `max_score_gap`**: Custom parameters controlling the stochastic move selection layer described in §3.3.

### 3.3 Weighted Stochastic Move Selection

Rather than asking Stockfish to play the "best move at Elo X" — which produces mechanical play even at low skill levels — a weighted sampling layer was designed over the multi-PV output:

```python
def pick_weighted_engine_move(analysis, legal_moves, profile):
    candidates = sorted([(move, score)], reverse=True)
    best_score = candidates[0][1]

    weights = []
    for i, (move, score) in enumerate(candidates):
        gap = best_score - score         # centipawn gap from best
        if gap > profile['max_score_gap']:
            continue                      # discard clearly inferior moves
        # weight = positional weight × exploration decay
        w = (1.0 if i == 0 else profile['exploration'] / (i + 1))
        w *= max(0.15, 1 - gap / profile['max_score_gap'])
        weights.append(w)

    return random.choices(moves, weights=weights, k=1)[0]
```

At low Elo (exploration=0.95, max_score_gap=350), the engine will happily sample a move that loses 300 centipawns. At high Elo (exploration=0.0), it plays the engine's top choice deterministically. The gap threshold prevents it from choosing nonsensical suicidal moves, maintaining the illusion of a human opponent who blunders *plausibly*.

### 3.4 Separation of Gameplay and Analysis Engines

A key architectural decision is that the move-playing engine (the "gameplay engine") is configured differently from the move-analysis engine (the "deep analysis engine"). When computing coaching context, strength limiting is explicitly disabled:

```python
def deep_analyze(board, multipv=3, depth=15, time_limit=0.4):
    # Explicitly disable strength limiting for analysis
    engine.configure({'UCI_LimitStrength': False, 'Skill Level': 20})
    return engine.analyse(board, Limit(depth=depth, time=time_limit), multipv=multipv)
```

This ensures the coaching agent always grounds its explanations in *ground-truth* engine analysis, not in the handicapped engine's distorted view.

---

## 4. Position Context Builder: Structured Grounding for LLM Reasoning

This is the most critical component in the architecture. Instead of passing a raw FEN to the LLM, every request passes through a context builder that produces a structured grounding document. This is the mechanism that prevents LLM hallucination.

### 4.1 Context Document Structure

```
POSITION STATE:
  FEN: r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4
  Turn: White (move 4), Phase: opening
  Material: White 39 / Black 39 (balance +0)
  In check: False
  Opening: **Giuoco Piano**

ENGINE ANALYSIS (Stockfish depth 15):
  1. `c3` (+0.3) line: c3 Nf6 d4 exd4 cxd4 Bb4+
  2. `d3` (+0.1) line: d3 d6 c3 a6 Ba2 Ba7
  3. `O-O` (+0.1) line: O-O d6 d3 a6

POSITION FEATURES:
  - White Bishop on c4 is pinned
  - Black can still castle
  - White passed pawn on e4

LAST MOVE PLAYED:
  Player played `Bb4` ?! -- **inaccuracy**
  Score: -0.4 (best was `Nf6` at +0.2)
  Lost ~60cp. Better: `Nf6` (Nf6 O-O d6 d3 Ba7)
```

Notice what this document contains that a raw FEN does not:
- **Verified candidate moves** with centipawn scores and 5-move principal variation lines — all Stockfish-computed
- **Quality classification** of the last move, with delta scoring and the missed alternative
- **Structural features** computed via board analysis: pins, hanging pieces, passed pawns, open files
- **Game phase** (opening/middlegame/endgame) and **material balance**
- **Opening name** from a 32-entry FEN lookup table covering major opening families

The LLM receives this document prepended to the system prompt on every request. It is grounded before the conversation begins.

### 4.2 Move Quality Scoring

Move quality is computed by comparing the evaluated score of the played move against the engine's best candidate *before the move was made*:

```python
def _analyze_last_move(last_move, current_candidates):
    # Re-analyze the position BEFORE the move was played
    before_board = chess.Board(last_move['beforeFen'])
    before_candidates = deep_analyze(before_board, multipv=4, depth=15)
    
    best_score = before_candidates[0]['score']
    played_score = score_of(last_move['uci'], before_candidates)
    delta = played_score - best_score   # negative = suboptimal

    quality = get_quality_label(delta)
    # brilliant: delta >= -10
    # strong:    delta >= -40
    # good:      delta >= -80
    # inaccuracy: delta >= -150
    # mistake:   delta >= -300
    # blunder:   delta < -300
```

This forces two Stockfish analyses — one of the pre-move position, one of the post-move position — to compute a mathematically grounded quality label. The LLM never subjectively assesses move quality; it receives a label computed from verified arithmetic.

### 4.3 Position Feature Extraction

Beyond engine scores, the context builder performs structured board analysis to extract human-readable tactical and structural features:

```python
def analyze_position_features(board):
    features = []
    
    # 1. Hanging pieces: attacked by opponent, insufficiently defended
    for sq in chess.SQUARES:
        piece = board.piece_at(sq)
        if piece and piece.color == turn:
            attackers = board.attackers(opponent, sq)
            defenders = board.attackers(turn, sq)
            if attackers and len(defenders) < len(attackers):
                features.append(f'{color} {piece_name} on {sq} is hanging')

    # 2. Pins: removing the piece exposes the king
    for sq in chess.SQUARES:
        piece = board.piece_at(sq)
        if piece and piece.color == turn:
            test_board = board.copy()
            test_board.remove_piece_at(sq)
            if test_board.is_attacked_by(opponent, king_sq):
                features.append(f'{piece_name} on {sq} is pinned')

    # 3. Passed pawns, open file rooks, castling rights
    # ...

    return features[:6]  # Top 6 most relevant features
```

These features ground the LLM's explanation in verifiable positional facts. When the LLM says "your bishop is pinned," it is because the board analysis code confirmed it, not because the LLM pattern-matched from its training data.

---

## 5. The LLM Coaching Agent

### 5.1 Agent Architecture: Grounded Coaching Persona

The LLM is instantiated via the OpenAI-compatible OpenRouter API, using `anthropic/claude-opus-4.6` as the reasoning model. The system prompt defines four distinct behaviors that the agent must exhibit:

**Behavior 1: Move Explanation** — When asked about a specific move, reference the last-move analysis data. Report quality, score delta, explain strategically, and show the better alternative from the engine's principal variation.

**Behavior 2: Candidate Move Generation** — Present the top 3 Stockfish candidates with practical reasoning. Never invent moves. Every move presented must have been evaluated in the grounding document.

**Behavior 3: Strategic Planning** — Discuss pawn structure, piece activity, king safety, and long-term plans. Ground claims in the material balance and position features from the context.

**Behavior 4: Proactive Socratic Coaching** — The most pedagogically sophisticated behavior. See §5.2.

Key constraints in the system prompt:
```
NEVER fabricate lines. Only reference moves from the analysis data.
Format moves in `backticks`, concepts in **bold**.
Be concise: 80-150 words unless deep analysis is requested.
Temperature is set to 0.15 to minimize creative deviation from the grounded context.
```

The low temperature (0.15) is critical. It ensures the LLM tightly follows the grounding document rather than injecting creative interpretations.

### 5.2 Proactive Socratic Coaching

The most distinctive feature of the coaching agent is that it fires *automatically* after every move, without the player asking anything. This bidirectional proactive loop is central to the learning experience:

- After a **player move**: The agent analyzes move quality and responds. If the move was good, it briefly praises the idea. If the move was bad, it employs Socratic questioning — asking guiding questions rather than revealing the best move:
  
  > *"Do you see what threat your opponent now has? Notice which piece has become undefended after this move. Think about what a discovered attack might mean for your queen's position."*
  
  This mirrors the methodology of elite human coaches: guide discovery, don't give answers.

- After an **AI move**: The agent explains the strategic logic behind the move — what threat it creates, what plan it serves, what weakness it exploits — and ends with a Socratic question to guide the player's response:
  
  > *"This move opens the f-file and eyes your castle. What piece of yours might be in danger now?"*

The technical implementation requires careful sequencing: the player analysis must complete before the AI move analysis begins, since the AI panel shows both analyses in sequence:

```javascript
// Client-side sequencing
if (isPlayer) {
    this._playerAnalysisPromise = doWork();  // start immediately
    await this._playerAnalysisPromise;
} else {
    await this._playerAnalysisPromise;  // wait for player analysis first
    await doWork();                      // then stream AI move reasoning
}
```

The panel renders both analyses in a visually separated layout, giving the player immediate context for both what they just played and what the AI is doing.

### 5.3 Session Memory Architecture

Each game session maintains a rolling conversation window that is injected into every LLM request:

```python
sessions[session_id] = {
    'messages': [],      # conversation turns: [{role, content}, ...]
    'created': time.time()
}
MAX_SESSION_HISTORY = 12   # last 12 turns kept in context
SESSION_TTL = 7200         # 2-hour TTL, then GC'd
```

This allows the coaching agent to reference earlier parts of the conversation:
- "You had a similar mistake with your knight on move 14..."
- "As I mentioned, your king safety concern from earlier has now materialized..."

The rolling window (12 turns) prevents unbounded context growth while preserving enough history for meaningful continuity. Expired sessions are pruned lazily on each request via `prune_sessions()`.

---

## 6. Streaming Architecture

### 6.1 Server-Sent Events for Token-Level Streaming

All coaching responses use Server-Sent Events (SSE) for real-time token streaming, giving users the experience of watching the coach think in real time:

```python
def call_llm_stream(messages, max_tokens=400):
    stream = openai_client.chat.completions.create(
        model="anthropic/claude-opus-4.6",
        messages=messages,
        max_tokens=max_tokens,
        temperature=0.15,
        stream=True
    )
    full = ""
    for chunk in stream:
        delta = chunk.choices[0].delta
        if delta.content:
            full += delta.content
            yield f"data: {json.dumps({'content': delta.content})}\n\n"
    yield f"data: {json.dumps({'done': True, 'full': full})}\n\n"
```

The Flask response uses a generator to stream SSE events directly from the LLM token stream:

```python
return Response(
    generate(),
    mimetype='text/event-stream',
    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'}
)
```

### 6.2 Abort-Aware Client Stream Reader

The client implements a readable stream reader over the SSE connection with support for AbortController signals. This is important because the proactive analysis for a player move may be superseded if the player moves again before the stream finishes:

```javascript
const doWork = async () => {
    const resp = await fetch('/api/analyze-move', {
        body: JSON.stringify(...),
        signal: this._analysisAbort.signal  // abortable
    });
    const reader = resp.body.getReader();
    let buffer = '';
    while (true) {
        if (signal.aborted) { reader.cancel(); return; }
        const { done, value } = await reader.read();
        // parse SSE lines, update UI incrementally
    }
};
```

When a new move is played, the previous analysis stream is aborted via `this._analysisAbort.abort()`, and a fresh analysis of the new position begins. This ensures the coaching panel is always current.

---

## 7. Infrastructure and Deployment

### 7.1 Azure App Service Deployment

The system runs as a single-process Flask application under Gunicorn on Azure App Service (Linux, Python 3.11):

```bash
gunicorn -w 1 --timeout 120 -b 0.0.0.0:8000 chess_api:app
```

A single worker is used intentionally. Stockfish is a subprocess; multiple workers would spawn multiple engine instances, increasing memory pressure significantly on the B1 tier (1.75 GB RAM). The Gunicorn timeout of 120 seconds accommodates deep analysis requests.

### 7.2 Stockfish Binary and glibc Compatibility

A non-trivial production challenge was the mismatch between the Stockfish binary (compiled for Ubuntu 22.04, requiring `GLIBC_2.33`+) and the Azure container runtime (Debian Bullseye, `GLIBC_2.31`). The startup script implements a three-path resolution:

```bash
_sf_verify() { echo "quit" | timeout 5 "$1" > /dev/null 2>&1; }

if [ -f "$SF_BIN" ] && _sf_verify "$SF_BIN"; then
    echo "[startup] Cached binary OK, skipping update"
elif [ -f ./stockfish-linux ] && _sf_verify ./stockfish-linux; then
    cp ./stockfish-linux "$SF_BIN"   # bundled binary works
else
    apt-get install -y stockfish     # fall back to apt (glibc-compatible)
    cp /usr/games/stockfish "$SF_BIN"
fi
```

The resolved binary is stored under `/home/site/bin/` — Azure's persistent storage — so subsequent restarts skip the apt-install step entirely.

### 7.3 Game Persistence

Game states (FEN, PGN, player color, Elo) are persisted to `/home/games/{session_id}.json`. This directory survives restarts and redeployments. Session IDs are UUID v4 values, validated against a regex before filesystem access to prevent path traversal:

```python
VALID_SESSION_RE = re.compile(r'^[a-f0-9\-]{1,64}$', re.IGNORECASE)
```

---

## 8. Security Design

Several explicit security measures were applied:

- **Path traversal prevention**: All session file access validates the session ID against a strict regex before constructing file paths.
- **Input sanitization on the client**: User-entered chat text is always escaped via `div.textContent` before being inserted into the DOM, preventing XSS.
- **API key isolation**: API keys (`OPENROUTER_API_KEY`, `OPENAI_API_KEY`) live exclusively in Azure App Settings environment variables. The `.env` file is explicitly excluded from deployment zips.
- **No arbitrary command execution routes**: The debug installation endpoint used during a production incident was removed immediately after use.
- **CORS scope**: Flask-CORS is active but production deployments should restrict `origins` to the apex and www domain.

---

## 9. Evaluation and Observations

### 9.1 Coaching Quality

The grounding-first architecture largely eliminates the hallucination problem. In manual testing across hundreds of positions, the LLM has not once recommended an illegal move or cited a line that Stockfish did not compute. The structured context document effectively acts as a retrieved knowledge base that the LLM can only synthesize, not contradict.

The Socratic coaching mode is qualitatively effective for the target audience. Rather than immediately revealing "you should have played `Nf6`," the agent asks "notice that your knight on e4 no longer has any defenders — what could your opponent do with the piece on d5?" This prompts genuine engagement rather than passive consumption.

### 9.2 Latency Profile

| Operation | Typical Latency |
|-----------|----------------|
| Stockfish move (depth 9, 0.12s) | 150–250ms |
| Context build (includes 2x Stockfish depth-15 analysis) | 800ms–1.5s |
| LLM first token | 600ms–1.2s |
| LLM full response (streaming, 100 words) | 2–4s total |

The context build is the latency bottleneck. It runs two Stockfish analyses at depth 15 (pre-move and post-move position). These are executed sequentially because they share the single engine process. Future optimization could parallelize these with a pool of engine workers.

### 9.3 Elo Emulation Fidelity

The weighted stochastic move selection produces recognizably human play patterns at low Elo levels. At 800 Elo, the engine occasionally drops pieces and misses simple tactics, consistent with the target profile. At 1500, the play is positionally reasonable with occasional tactical oversights. The transition from exploration-heavy sampling at low Elo to deterministic best-move selection above 2300 produces qualitatively correct behavior across the full range.

---

## 10. Roadmap: Toward a Full Agentic Coaching Loop

The current architecture is a strong foundation but is fundamentally reactive: it explains what happened after a move. The next architectural evolution targets a fully agentic coaching loop:

### 10.1 Game Review Agent

Post-game analysis agent that processes a full PGN, identifies recurring mistake patterns (e.g., "you consistently blunder when you have an isolated queen's pawn"), assigns thematic labels per mistake, and generates a personalized improvement report. This requires a structured analysis pipeline over the full move sequence rather than single-move analysis.

### 10.2 Memory-Augmented Coaching

Currently, session memory lasts only for the game in progress. A persistent memory layer (backed by a vector store) would track a player's historical mistakes, opening choices, and tactical blind spots across multiple games. The system prompt context would include a "player profile" block: "This player frequently misses back-rank threats and tends to over-extend with pawns in the middlegame."

### 10.3 Drill Generation Agent

Given a mistake, generate a set of training positions that practice the exact pattern the player missed. For example, if the player failed to see a discovered attack, synthesize 3–5 similar positions at equivalent complexity for them to solve. This closes the coaching loop from diagnosis to deliberate practice.

### 10.4 Multi-Modal Position Input

Allow users to photograph a board from a physical game or tournament and submit it as a PNG. A vision model would extract the FEN, pass it through the existing coaching pipeline, and respond to questions about the position. This opens the product to over-the-board players.

### 10.5 Tool-Use Agent Architecture

The most significant architectural evolution would replace the current sequential pipeline with a tool-use agent architecture. Instead of a fixed context-build → LLM-call chain, the LLM would have access to tools it can invoke on demand:

```
tools = [
    analyze_position(fen, depth, multipv),    # Stockfish analysis
    get_opening_name(fen),                     # opening book lookup
    search_similar_positions(fen),             # vector retrieval
    get_player_history(player_id),             # persistent memory
    generate_drill(pattern, difficulty),       # drill synthesis
]
```

This enables the LLM to decide which analyses are needed for a given query, rather than always computing all analyses regardless of what was asked. A question about king safety does not need a deep endgame pawn evaluation; a question about the best move in a forcing sequence needs full multi-PV analysis. The agent selects tools contextually.

---

## 11. Related Work

**Stockfish + Lichess**: The dominant platform for free online chess uses Stockfish for analysis but presents moves as raw engine lines with centipawn evaluations. No natural-language explanation layer exists.

**Chess.com Game Review**: Uses Stockfish for post-game analysis with basic quality labels (brilliant/blunder) but limited natural-language coaching. The explanations are template-based rather than LLM-generated.

**Maia Chess (McIlroy-Young et al., 2020)**: A neural network trained on human games at specific Elo levels to predict human-like moves rather than optimal moves. This is conceptually complementary to the stochastic selection layer described in §3.3. Integrating Maia as the gameplay engine while retaining Stockfish for coaching analysis is a natural future direction.

**GPT-4 Chess Analysis (OpenAI, various)**: Informal experiments show GPT-4 can discuss chess positions but frequently hallucinates move sequences and evaluations when not given structured context from an external engine. The architecture described in this paper was specifically designed to address this failure mode.

---

## 12. Conclusion

AskChessGPT demonstrates that the combination of classical search (Stockfish) and modern LLMs (Claude) produces a qualitatively superior chess coaching experience compared to either in isolation. The key design principles are:

1. **Ground truth lives in the engine.** The LLM never evaluates positions independently.
2. **The context builder is the interface between engine and LLM.** Its quality determines coaching quality.
3. **Proactive, bidirectional analysis is more valuable than on-demand answers.** Players learn more when the coach speaks unprompted after every move.
4. **Socratic pedagogy beats answer delivery.** Withholding the optimal move and guiding discovery produces deeper understanding.
5. **Streaming matters for experience.** Watching the coach "think" in real time is more engaging than waiting for a complete response.

The system is live at [askchessgpt.com](https://askchessgpt.com), deployed on Azure App Service, and serves real users across the 700–1800 Elo target audience.

---

## Appendix A: API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/move` | POST | Get Stockfish move for given FEN and Elo |
| `/api/chat` | POST | Chat with coaching agent (streaming or batch) |
| `/api/analyze-move` | POST | Proactive analysis of last move (streaming) |
| `/api/session/save` | POST | Persist game state to /home storage |
| `/api/session/{id}` | GET | Load persisted game state |
| `/api/health` | GET | Service status: Stockfish + LLM availability |
| `/api/debug/stockfish` | GET | Engine diagnostics: paths, ldd, errors |

---

## Appendix B: Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `flask` | 2.3.3 | HTTP server and routing |
| `flask-cors` | 4.0.0 | CORS headers for browser requests |
| `python-chess` | 1.999 | Chess logic, FEN parsing, UCI bridge |
| `openai` | ≥1.12.0 | LLM API client (OpenAI-compatible) |
| `gunicorn` | ≥21.2.0 | WSGI production server |
| `python-dotenv` | ≥1.0.0 | Environment variable management |
| Stockfish 12/16 | — | Chess engine, UCI protocol |
| Claude Opus 4.6 | — | LLM coaching generation (via OpenRouter) |
| Chessboard.js | 1.0.0 | Board rendering (client) |
| chess.js | 1.0.0 | Legal move validation (client) |

---

*AskChessGPT — Built for players who want to understand chess, not just play it.*
