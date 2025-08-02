// Stockfish Web Worker
importScripts('https://lichess1.org/stockfish/stockfish.wasm.js');

let stockfish;
let isReady = false;

// Initialize Stockfish
Stockfish().then((sf) => {
    stockfish = sf;
    
    // Set up message handler
    stockfish.addMessageListener((message) => {
        if (message === 'uciok') {
            stockfish.postMessage('isready');
        } else if (message === 'readyok') {
            isReady = true;
            postMessage({ type: 'ready' });
        } else if (message.startsWith('bestmove')) {
            const parts = message.split(' ');
            const bestMove = parts[1];
            postMessage({ type: 'bestmove', move: bestMove });
        }
    });
    
    // Initialize UCI
    stockfish.postMessage('uci');
});

// Convert Elo to Stockfish skill level (0-20)
function eloToSkillLevel(elo) {
    // Rough mapping: 800 Elo = level 0, 3000 Elo = level 20
    const minElo = 800;
    const maxElo = 3000;
    const minSkill = 0;
    const maxSkill = 20;
    
    const skill = Math.round(((elo - minElo) / (maxElo - minElo)) * (maxSkill - minSkill) + minSkill);
    return Math.max(minSkill, Math.min(maxSkill, skill));
}

// Handle messages from main thread
self.onmessage = function(e) {
    const { type, fen, elo, depth = 15 } = e.data;
    
    if (!isReady || !stockfish) {
        postMessage({ type: 'error', message: 'Stockfish not ready' });
        return;
    }
    
    switch (type) {
        case 'getMove':
            if (!fen) {
                postMessage({ type: 'error', message: 'No FEN provided' });
                return;
            }
            
            // Set skill level based on Elo
            const skillLevel = eloToSkillLevel(elo);
            stockfish.postMessage(`setoption name Skill Level value ${skillLevel}`);
            
            // Set position and get best move
            stockfish.postMessage(`position fen ${fen}`);
            stockfish.postMessage(`go depth ${depth}`);
            break;
            
        case 'stop':
            stockfish.postMessage('stop');
            break;
            
        default:
            postMessage({ type: 'error', message: 'Unknown command' });
    }
};
