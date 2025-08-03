# Chess Game with Backend AI

## Setup Instructions

### 1. Install Python Dependencies
```bash
pip install -r requirements.txt
```

### 2. Start the Backend API
```bash
python chess_api.py
```
The API will run on `http://localhost:5000`

### 3. Start the Frontend
```bash
python3 -m http.server 8000
```
Then open `http://localhost:8000` in your browser

## API Endpoints

- `POST /api/move` - Get AI move for a given position
- `GET /api/health` - Health check

## Current Implementation

- **Frontend**: Clean React-like chess interface with click-to-select
- **Backend**: Flask API with random moves (ready for Stockfish integration)
- **AI**: Currently makes random legal moves, easily upgradeable to Stockfish

## Next Steps (for later)

1. Install Stockfish engine: `pip install stockfish`
2. Update `chess_api.py` to use Stockfish instead of random moves
3. Add proper Elo-based difficulty scaling

## Removed

- All complex Stockfish worker code
- Browser WebAssembly dependencies
- Network/CORS issues
- Duplicate AI implementations
