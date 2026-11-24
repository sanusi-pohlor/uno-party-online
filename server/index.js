'use strict';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { UnoRoom } = require('./gameEngine');

const PORT = Number(process.env.PORT) || 3000;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 20000,
  pingTimeout: 25000
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', rooms: rooms.size, uptime: process.uptime() });
});

const rooms = new Map(); // code -> UnoRoom
const socketToSession = new Map(); // socketId -> { roomCode, playerId }
const botTimers = new Map(); // roomCode -> Timeout

function generateRoomCode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return crypto.randomBytes(2).toString('hex').toUpperCase();
}

function generatePlayerId() {
  return 'p_' + crypto.randomBytes(6).toString('hex');
}

function clearBotTimer(roomCode) {
  const timer = botTimers.get(roomCode);
  if (timer) {
    clearTimeout(timer);
    botTimers.delete(roomCode);
  }
}

function broadcastRoom(room) {
  for (const player of room.players) {
    if (!player.isBot && player.socketId && player.connected) {
      io.to(player.socketId).emit('room:state', room.getStateForPlayer(player.id));
    }
  }
  scheduleBotIfNeeded(room);
}

function scheduleBotIfNeeded(room) {
  clearBotTimer(room.code);
  if (room.status !== 'playing') return;

  const current = room.getCurrentPlayer();
  if (!current || !current.isBot) return;

  const delay = 850 + Math.floor(Math.random() * 650);
  const timer = setTimeout(() => {
    botTimers.delete(room.code);
    if (!rooms.has(room.code) || room.status !== 'playing') return;
    const nowCurrent = room.getCurrentPlayer();
    if (!nowCurrent || nowCurrent.id !== current.id) return;

    const decision = room.chooseBotAction(current.id);
    if (!decision) return;

    if (decision.action === 'play') {
      if (decision.shoutUno) {
        room.shoutUno(current.id);
      }
      room.playCard(current.id, decision.cardId, decision.chosenColor);
    } else if (decision.action === 'draw') {
      room.drawCard(current.id);
    } else if (decision.action === 'pass') {
      room.passTurn(current.id);
    }

    broadcastRoom(room);
  }, delay);

  botTimers.set(room.code, timer);
}

function cleanupRoomIfEmpty(room) {
  const hasHumans = room.players.some((p) => !p.isBot);
  if (!hasHumans) {
    clearBotTimer(room.code);
    rooms.delete(room.code);
  }
}

// Periodically purge stale idle rooms (> 3 hours old)
setInterval(() => {
  const cutoff = Date.now() - 3 * 60 * 60 * 1000;
  for (const [code, room] of rooms.entries()) {
    if (room.updatedAt < cutoff) {
      clearBotTimer(code);
      rooms.delete(code);
    }
  }
}, 15 * 60 * 1000).unref();

io.on('connection', (socket) => {
  socket.on('room:create', ({ name } = {}, ack) => {
    const code = generateRoomCode();
    const room = new UnoRoom(code);
    const playerId = generatePlayerId();
    const res = room.addPlayer({ id: playerId, socketId: socket.id, name: name || 'ผู้เล่น 1' });
    if (!res.ok) {
      if (ack) ack({ ok: false, error: res.error });
      return;
    }

    rooms.set(code, room);
    socketToSession.set(socket.id, { roomCode: code, playerId });
    socket.join(code);

    if (ack) ack({ ok: true, code, playerId, state: room.getStateForPlayer(playerId) });
    broadcastRoom(room);
  });

  socket.on('room:join', ({ code, name, playerId: resumePlayerId } = {}, ack) => {
    const cleanCode = String(code || '').trim().toUpperCase();
    const room = rooms.get(cleanCode);
    if (!room) {
      if (ack) ack({ ok: false, error: `ไม่พบห้องรหัส "${cleanCode}"` });
      return;
    }

    // Allow reconnecting if the player already belongs to this room
    if (resumePlayerId) {
      const existing = room.getPlayer(resumePlayerId);
      if (existing && !existing.isBot) {
        existing.socketId = socket.id;
        existing.connected = true;
        socketToSession.set(socket.id, { roomCode: cleanCode, playerId: existing.id });
        socket.join(cleanCode);
        if (ack) ack({ ok: true, code: cleanCode, playerId: existing.id, state: room.getStateForPlayer(existing.id) });
        broadcastRoom(room);
        return;
      }
    }

    const playerId = generatePlayerId();
    const res = room.addPlayer({ id: playerId, socketId: socket.id, name: name || 'ผู้เล่น' });
    if (!res.ok) {
      if (ack) ack({ ok: false, error: res.error });
      return;
    }

    socketToSession.set(socket.id, { roomCode: cleanCode, playerId });
    socket.join(cleanCode);

    if (ack) ack({ ok: true, code: cleanCode, playerId, state: room.getStateForPlayer(playerId) });
    broadcastRoom(room);
  });

  socket.on('room:addBot', (_payload, ack) => {
    const session = socketToSession.get(socket.id);
    if (!session) return ack && ack({ ok: false, error: 'ไม่ได้อยู่ในห้อง' });
    const room = rooms.get(session.roomCode);
    if (!room) return ack && ack({ ok: false, error: 'ไม่พบห้อง' });

    const res = room.addBot(session.playerId);
    if (ack) ack({ ok: res.ok, error: res.error });
    if (res.ok) broadcastRoom(room);
  });

  socket.on('room:removePlayer', ({ targetId } = {}, ack) => {
    const session = socketToSession.get(socket.id);
    if (!session) return ack && ack({ ok: false, error: 'ไม่ได้อยู่ในห้อง' });
    const room = rooms.get(session.roomCode);
    if (!room) return ack && ack({ ok: false, error: 'ไม่พบห้อง' });

    const target = room.getPlayer(targetId);
    const res = room.removePlayer(targetId, session.playerId);
    if (ack) ack({ ok: res.ok, error: res.error });
    if (res.ok) {
      if (target && target.socketId && target.socketId !== socket.id) {
        io.to(target.socketId).emit('room:kicked', { message: 'คุณถูกนำออกจากห้อง' });
        socketToSession.delete(target.socketId);
      }
      cleanupRoomIfEmpty(room);
      if (rooms.has(room.code)) broadcastRoom(room);
    }
  });

  socket.on('room:settings', (patch = {}, ack) => {
    const session = socketToSession.get(socket.id);
    if (!session) return ack && ack({ ok: false, error: 'ไม่ได้อยู่ในห้อง' });
    const room = rooms.get(session.roomCode);
    if (!room) return ack && ack({ ok: false, error: 'ไม่พบห้อง' });

    const res = room.updateSettings(session.playerId, patch);
    if (ack) ack(res);
    if (res.ok) broadcastRoom(room);
  });

  socket.on('game:start', (_payload, ack) => {
    const session = socketToSession.get(socket.id);
    if (!session) return ack && ack({ ok: false, error: 'ไม่ได้อยู่ในห้อง' });
    const room = rooms.get(session.roomCode);
    if (!room) return ack && ack({ ok: false, error: 'ไม่พบห้อง' });

    const res = room.startGame(session.playerId);
    if (ack) ack(res);
    if (res.ok) broadcastRoom(room);
  });

  socket.on('game:returnLobby', (_payload, ack) => {
    const session = socketToSession.get(socket.id);
    if (!session) return ack && ack({ ok: false, error: 'ไม่ได้อยู่ในห้อง' });
    const room = rooms.get(session.roomCode);
    if (!room) return ack && ack({ ok: false, error: 'ไม่พบห้อง' });

    const res = room.returnToLobby(session.playerId);
    if (ack) ack(res);
    if (res.ok) broadcastRoom(room);
  });

  socket.on('game:play', ({ cardId, chosenColor } = {}, ack) => {
    const session = socketToSession.get(socket.id);
    if (!session) return ack && ack({ ok: false, error: 'ไม่ได้อยู่ในห้อง' });
    const room = rooms.get(session.roomCode);
    if (!room) return ack && ack({ ok: false, error: 'ไม่พบห้อง' });

    const res = room.playCard(session.playerId, cardId, chosenColor);
    if (ack) ack({ ok: res.ok, error: res.error });
    if (res.ok) broadcastRoom(room);
  });

  socket.on('game:draw', (_payload, ack) => {
    const session = socketToSession.get(socket.id);
    if (!session) return ack && ack({ ok: false, error: 'ไม่ได้อยู่ในห้อง' });
    const room = rooms.get(session.roomCode);
    if (!room) return ack && ack({ ok: false, error: 'ไม่พบห้อง' });

    const res = room.drawCard(session.playerId);
    if (ack) ack({ ok: res.ok, error: res.error, mustPassOrPlay: res.mustPassOrPlay });
    if (res.ok) broadcastRoom(room);
  });

  socket.on('game:pass', (_payload, ack) => {
    const session = socketToSession.get(socket.id);
    if (!session) return ack && ack({ ok: false, error: 'ไม่ได้อยู่ในห้อง' });
    const room = rooms.get(session.roomCode);
    if (!room) return ack && ack({ ok: false, error: 'ไม่พบห้อง' });

    const res = room.passTurn(session.playerId);
    if (ack) ack(res);
    if (res.ok) broadcastRoom(room);
  });

  socket.on('game:uno', (_payload, ack) => {
    const session = socketToSession.get(socket.id);
    if (!session) return ack && ack({ ok: false, error: 'ไม่ได้อยู่ในห้อง' });
    const room = rooms.get(session.roomCode);
    if (!room) return ack && ack({ ok: false, error: 'ไม่พบห้อง' });

    const res = room.shoutUno(session.playerId);
    if (ack) ack(res);
    if (res.ok) broadcastRoom(room);
  });

  socket.on('game:catchUno', ({ targetId } = {}, ack) => {
    const session = socketToSession.get(socket.id);
    if (!session) return ack && ack({ ok: false, error: 'ไม่ได้อยู่ในห้อง' });
    const room = rooms.get(session.roomCode);
    if (!room) return ack && ack({ ok: false, error: 'ไม่พบห้อง' });

    const res = room.catchUno(session.playerId, targetId);
    if (ack) ack(res);
    if (res.ok) broadcastRoom(room);
  });

  socket.on('room:chat', ({ text } = {}) => {
    const session = socketToSession.get(socket.id);
    if (!session) return;
    const room = rooms.get(session.roomCode);
    if (!room) return;
    const msg = room.addChatMessage(session.playerId, text);
    if (msg) {
      io.to(room.code).emit('room:chatMessage', msg);
    }
  });

  socket.on('room:emote', ({ emoji } = {}) => {
    const session = socketToSession.get(socket.id);
    if (!session) return;
    const room = rooms.get(session.roomCode);
    if (!room) return;
    const player = room.getPlayer(session.playerId);
    if (!player) return;
    const allowed = ['😂', '🔥', '😱', '👏', '😈', '😭'];
    if (!allowed.includes(emoji)) return;
    io.to(room.code).emit('room:emoteBroadcast', {
      playerId: player.id,
      name: player.name,
      emoji
    });
  });

  socket.on('room:leave', () => {
    handleLeave(socket, true);
  });

  socket.on('disconnect', () => {
    handleLeave(socket, false);
  });
});

function handleLeave(socket, immediate) {
  const session = socketToSession.get(socket.id);
  if (!session) return;
  socketToSession.delete(socket.id);

  const room = rooms.get(session.roomCode);
  if (!room) return;
  const player = room.getPlayer(session.playerId);
  if (!player) return;

  if (immediate || room.status === 'lobby') {
    room.removePlayer(player.id);
    cleanupRoomIfEmpty(room);
    if (rooms.has(room.code)) broadcastRoom(room);
    return;
  }

  // During active game: mark disconnected with 45s grace period to reconnect
  player.connected = false;
  broadcastRoom(room);

  setTimeout(() => {
    const currentRoom = rooms.get(session.roomCode);
    if (!currentRoom) return;
    const currentPlayer = currentRoom.getPlayer(session.playerId);
    if (currentPlayer && !currentPlayer.connected) {
      currentRoom.removePlayer(currentPlayer.id);
      cleanupRoomIfEmpty(currentRoom);
      if (rooms.has(currentRoom.code)) broadcastRoom(currentRoom);
    }
  }, 45000);
}

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`UNO Party Online listening on port ${PORT}`);
  });
}

module.exports = server;
