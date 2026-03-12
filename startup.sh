#!/bin/bash
set -e

# Ensure a working Stockfish binary is in /home/site/bin (persistent across restarts).
# 1. If /home/site/bin has a working binary already, skip everything -- fast path.
# 2. If a bundled binary is in the zip, try that first; if glibc-incompatible, fall back to apt.
# 3. If no bundled binary, try apt-get install as the only source.

SF_BIN=/home/site/bin/stockfish-linux
mkdir -p /home/site/bin

_sf_verify() { echo "quit" | timeout 5 "$1" > /dev/null 2>&1; }

_sf_apt_install() {
  echo "[startup] Installing stockfish via apt..."
  apt-get update -qq || true
  apt-get install -y --no-install-recommends stockfish || true
  # Debian installs to /usr/games/stockfish
  local sf_apt=""
  command -v stockfish > /dev/null 2>&1 && sf_apt=$(command -v stockfish)
  [ -z "$sf_apt" ] && [ -f /usr/games/stockfish ] && sf_apt=/usr/games/stockfish
  if [ -n "$sf_apt" ]; then
    cp "$sf_apt" "$SF_BIN" && chmod +x "$SF_BIN"
    echo "[startup] Installed apt stockfish ($sf_apt) -> $SF_BIN"
  else
    echo "[startup] apt stockfish unavailable; engine will run in Random mode"
  fi
}

if [ -f "$SF_BIN" ] && _sf_verify "$SF_BIN"; then
  echo "[startup] Cached stockfish binary verified OK, skipping update"
elif [ -f ./stockfish-linux ]; then
  chmod +x ./stockfish-linux
  if _sf_verify ./stockfish-linux; then
    cp -f ./stockfish-linux "$SF_BIN" && chmod +x "$SF_BIN"
    echo "[startup] Bundled stockfish binary OK, copied to $SF_BIN"
  else
    echo "[startup] Bundled binary glibc-incompatible, trying apt..."
    _sf_apt_install
  fi
else
  if ! [ -f "$SF_BIN" ]; then
    _sf_apt_install
  fi
fi

# Install packages if required by runtime environment.
# Install packages to /home/site/pylibs (persists across container restarts).
export PYTHONPATH="/home/site/pylibs/lib/python$(python -c 'import sys; print("%d.%d"%sys.version_info[:2])')/site-packages:${PYTHONPATH:-}"
if ! python -c "import flask_cors" >/dev/null 2>&1; then
  echo "[startup] Installing packages to /home/site/pylibs..."
  pip install --no-cache-dir --root-user-action=ignore \
    --target /home/site/pylibs/lib/python$(python -c 'import sys; print("%d.%d"%sys.version_info[:2])')/site-packages \
    -r /home/site/wwwroot/requirements.txt
  echo "[startup] Packages installed."
fi

echo "[startup] Starting gunicorn..."
gunicorn -w 1 --timeout 120 -b 0.0.0.0:8000 chess_api:app
