import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import type {
  ClientWsMessage,
  RoomPlayer,
  RoomState,
  RoomSummary,
  ServerWsMessage,
  TrackDefinition,
} from './src/types/sim';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ClientSession {
  id: string;
  ws: WebSocket;
  roomCode: string | null;
}

interface ServerRoom extends RoomState {
  countdownTimer?: NodeJS.Timeout;
  raceStartTs?: number;
}

const rooms = new Map<string, ServerRoom>();
const clients = new Map<string, ClientSession>();

function generateId(len = 8): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

function sanitizeRoomState(room: ServerRoom): RoomState {
  return {
    code: room.code,
    name: room.name,
    hostId: room.hostId,
    status: room.status,
    countdownSec: room.countdownSec,
    track: room.track,
    environment: room.environment,
    players: room.players,
    createdAt: room.createdAt,
  };
}

function sendTo(ws: WebSocket, msg: ServerWsMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastToRoom(room: ServerRoom, msg: ServerWsMessage, excludeId?: string) {
  const payload = JSON.stringify(msg);
  for (const player of room.players) {
    if (excludeId && player.id === excludeId) continue;
    const session = clients.get(player.id);
    if (session && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(payload);
    }
  }
}

function validateTrack(track: TrackDefinition): boolean {
  return (
    Boolean(track) &&
    typeof track.name === 'string' &&
    Array.isArray(track.nodes) &&
    track.nodes.length >= 6 &&
    track.nodes.length <= 40 &&
    typeof track.width === 'number' &&
    track.width >= 8 &&
    track.width <= 30
  );
}

function leaveCurrentRoom(session: ClientSession) {
  if (!session.roomCode) return;
  const room = rooms.get(session.roomCode);
  session.roomCode = null;
  if (!room) return;

  room.players = room.players.filter((p) => p.id !== session.id);
  broadcastToRoom(room, { type: 'player:disconnected', playerId: session.id });

  if (room.players.length === 0) {
    if (room.countdownTimer) clearInterval(room.countdownTimer);
    rooms.delete(room.code);
    return;
  }

  if (room.hostId === session.id) {
    room.hostId = room.players[0].id;
  }
  broadcastToRoom(room, { type: 'room:state', room: sanitizeRoomState(room) });
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, rooms: rooms.size });
  });

  app.get('/api/rooms', (_req, res) => {
    const summaries: RoomSummary[] = [];
    for (const room of rooms.values()) {
      summaries.push({
        code: room.code,
        name: room.name,
        playerCount: room.players.length,
        trackName: room.track.name,
        status: room.status,
      });
    }
    summaries.sort((a, b) => b.playerCount - a.playerCount);
    res.json({ rooms: summaries });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const playerId = generateId(10);
    const session: ClientSession = { id: playerId, ws, roomCode: null };
    clients.set(playerId, session);
    sendTo(ws, { type: 'ws:welcome', playerId });

    ws.on('message', (raw) => {
      let msg: ClientWsMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientWsMessage;
      } catch {
        return;
      }

      if (msg.type === 'room:create') {
        if (!validateTrack(msg.track)) {
          sendTo(ws, { type: 'room:error', message: 'Invalid track configuration.' });
          return;
        }
        leaveCurrentRoom(session);
        const code = generateRoomCode();
        const player: RoomPlayer = {
          id: playerId,
          name: (msg.playerName || 'Driver').slice(0, 18),
          color: msg.color || '#ef4444',
          carSpec: msg.carSpec || 'gt-coupe',
          ready: true,
          lap: 1,
          bestLapMs: null,
          lastLapMs: null,
          finished: false,
          finishTimeMs: null,
          progress: 0,
        };
        const room: ServerRoom = {
          code,
          name: (msg.roomName || `${player.name}'s Grid`).slice(0, 28),
          hostId: playerId,
          status: 'lobby',
          countdownSec: 0,
          track: msg.track,
          environment: msg.environment || {
            weather: 'clear',
            timeOfDay: 'midday',
            dynamicCycle: false,
          },
          players: [player],
          createdAt: Date.now(),
        };
        rooms.set(code, room);
        session.roomCode = code;
        sendTo(ws, { type: 'room:joined', playerId, room: sanitizeRoomState(room) });
        return;
      }

      if (msg.type === 'room:join') {
        const code = (msg.code || '').trim().toUpperCase();
        const room = rooms.get(code);
        if (!room) {
          sendTo(ws, { type: 'room:error', message: `Room "${code}" not found.` });
          return;
        }
        if (room.players.length >= 8 && !room.players.some((p) => p.id === playerId)) {
          sendTo(ws, { type: 'room:error', message: 'Room is full (max 8 drivers).' });
          return;
        }
        if (session.roomCode && session.roomCode !== code) {
          leaveCurrentRoom(session);
        }
        session.roomCode = code;
        const existing = room.players.find((p) => p.id === playerId);
        if (!existing) {
          room.players.push({
            id: playerId,
            name: (msg.playerName || 'Driver').slice(0, 18),
            color: msg.color || '#06b6d4',
            carSpec: msg.carSpec || 'gt-coupe',
            ready: false,
            lap: 1,
            bestLapMs: null,
            lastLapMs: null,
            finished: false,
            finishTimeMs: null,
            progress: 0,
          });
        }
        sendTo(ws, { type: 'room:joined', playerId, room: sanitizeRoomState(room) });
        broadcastToRoom(room, { type: 'room:state', room: sanitizeRoomState(room) }, playerId);
        return;
      }

      if (msg.type === 'room:leave') {
        leaveCurrentRoom(session);
        sendTo(ws, { type: 'room:left' });
        return;
      }

      const room = session.roomCode ? rooms.get(session.roomCode) : undefined;
      if (!room) return;

      if (msg.type === 'room:updateTrack') {
        if (room.hostId !== playerId || room.status !== 'lobby') return;
        if (!validateTrack(msg.track)) return;
        room.track = msg.track;
        broadcastToRoom(room, { type: 'room:state', room: sanitizeRoomState(room) });
        return;
      }

      if (msg.type === 'room:updateEnvironment') {
        if (room.hostId !== playerId) return;
        room.environment = msg.environment;
        broadcastToRoom(room, { type: 'room:state', room: sanitizeRoomState(room) });
        return;
      }

      if (msg.type === 'room:updatePlayer') {
        const player = room.players.find((p) => p.id === playerId);
        if (!player) return;
        if (typeof msg.playerName === 'string' && msg.playerName.trim()) {
          player.name = msg.playerName.trim().slice(0, 18);
        }
        if (typeof msg.color === 'string') {
          player.color = msg.color;
        }
        if (msg.carSpec) {
          player.carSpec = msg.carSpec;
        }
        if (typeof msg.ready === 'boolean') {
          player.ready = msg.ready;
        }
        broadcastToRoom(room, { type: 'room:state', room: sanitizeRoomState(room) });
        return;
      }

      if (msg.type === 'room:startRace') {
        if (room.hostId !== playerId || room.status !== 'lobby') return;
        if (room.countdownTimer) clearInterval(room.countdownTimer);
        room.status = 'countdown';
        room.countdownSec = 3;
        for (const p of room.players) {
          p.lap = 1;
          p.bestLapMs = null;
          p.lastLapMs = null;
          p.finished = false;
          p.finishTimeMs = null;
          p.progress = 0;
        }
        broadcastToRoom(room, { type: 'room:state', room: sanitizeRoomState(room) });

        room.countdownTimer = setInterval(() => {
          room.countdownSec -= 1;
          if (room.countdownSec <= 0) {
            if (room.countdownTimer) clearInterval(room.countdownTimer);
            room.countdownTimer = undefined;
            room.status = 'racing';
            room.countdownSec = 0;
            room.raceStartTs = Date.now();
          }
          broadcastToRoom(room, { type: 'room:state', room: sanitizeRoomState(room) });
        }, 1000);
        return;
      }

      if (msg.type === 'room:resetLobby') {
        if (room.hostId !== playerId) return;
        if (room.countdownTimer) clearInterval(room.countdownTimer);
        room.countdownTimer = undefined;
        room.status = 'lobby';
        room.countdownSec = 0;
        for (const p of room.players) {
          p.lap = 1;
          p.finished = false;
          p.finishTimeMs = null;
          p.progress = 0;
        }
        broadcastToRoom(room, { type: 'room:state', room: sanitizeRoomState(room) });
        return;
      }

      if (msg.type === 'player:telemetry') {
        const player = room.players.find((p) => p.id === playerId);
        if (player) {
          player.progress = msg.progress;
        }
        broadcastToRoom(
          room,
          {
            type: 'player:telemetry',
            telemetry: {
              ...msg.telemetry,
              id: playerId,
              ts: Date.now(),
            },
          },
          playerId,
        );
        return;
      }

      if (msg.type === 'player:lap') {
        const player = room.players.find((p) => p.id === playerId);
        if (!player || room.status !== 'racing') return;
        if (msg.lapTimeMs < 5000) return; // Anti-cheat sanity floor
        player.lastLapMs = Math.round(msg.lapTimeMs);
        if (player.bestLapMs === null || player.lastLapMs < player.bestLapMs) {
          player.bestLapMs = player.lastLapMs;
        }
        player.lap = msg.lap;
        if (msg.lap > room.track.totalLaps && !player.finished) {
          player.finished = true;
          player.finishTimeMs = room.raceStartTs ? Date.now() - room.raceStartTs : msg.lapTimeMs;
          if (room.players.every((p) => p.finished)) {
            room.status = 'finished';
          }
        }
        broadcastToRoom(room, { type: 'room:state', room: sanitizeRoomState(room) });
      }
    });

    ws.on('close', () => {
      leaveCurrentRoom(session);
      clients.delete(playerId);
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Apex Clutch server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
