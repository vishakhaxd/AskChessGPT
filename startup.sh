#!/bin/bash
chmod +x ./stockfish-linux
gunicorn -w 1 --timeout 120 -b 0.0.0.0:8000 chess_api:app
