# AskChessGPT

AskChessGPT is a learning-first chess web app built around one core idea:

Learn chess by asking better questions.

The homepage now leads into an editorial landing page and analysis studio where players can:

- play a position against the engine
- ask why a move works
- ask for plans and candidate ideas
- use the board as a study surface instead of a generic game lobby

## Setup

### 1. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 2. Start the app

```bash
python3 chess_api.py
```

The Flask app serves both the API and the frontend at `http://localhost:5100`.

## Main Endpoints

- `GET /` - Main landing page and learning studio
- `GET /gameplay` - Dedicated gameplay and analysis studio page
- `POST /api/move` - Request an engine move for the current FEN and target Elo
- `POST /api/chat` - Ask a question about the current position
- `GET /api/health` - Health check

## Current Product State

- learning-first homepage with editorial visual direction
- dedicated gameplay page at `/gameplay`
- no login in the main product flow
- no Telegram visit tracking or telemetry plumbing
- Stockfish-backed move generation with softer low-Elo behavior
- fallback coaching responses when the LLM is unavailable

## Notes

- The app will try to use a local Stockfish binary from the repository based on platform.
- If `OPENROUTER_API_KEY` is set, the chat endpoint uses OpenRouter via the OpenAI-compatible client.
- Without an LLM key, the tutor still returns lightweight fallback coaching prompts.

## Product Planning

The detailed product and page strategy is documented in [PRODUCT_PLAN.md](PRODUCT_PLAN.md).
