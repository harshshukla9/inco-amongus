const app = require('express')();
const http = require('http').Server(app);

const DEFAULT_ORIGINS = [
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'https://inco-amongus.onrender.com',
];
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const allowedOrigins = corsOrigins.length ? corsOrigins : DEFAULT_ORIGINS;

const io = require('socket.io')(http, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
  },
});

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'amongjs-server' });
});

const MEETING_DISCUSS_MS = 15000;
const VOTE_DURATION_MS = 20000;

const rooms = new Map();

const getRoom = (roomId) => {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      hostId: null,
      players: new Map(),
      started: false,
      fillBots: true,
      maxPlayers: 7,
      phase: 'lobby',
      roles: {},
      votes: {},
      meetingTimer: null,
      voteTimer: null,
      roleSource: 'server', // 'server' | 'inco'
      incoJoined: new Set(),
      marketAddress: null,
      marketMatchId: null,
      bettingOpen: false,
    });
  }
  return rooms.get(roomId);
};

const serializePlayers = (room, forSocketId = null) =>
  Array.from(room.players.values()).map((player) => ({
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
    isBot: Boolean(player.isBot),
    alive: player.alive !== false,
    walletAddress: player.walletAddress || null,
    // Only tell each client their own role; impostor list sent separately to impostors
    role:
      forSocketId && player.id === forSocketId
        ? player.role
        : forSocketId
          ? undefined
          : player.role,
  }));

const living = (room) =>
  Array.from(room.players.values()).filter((p) => p.alive !== false);

const assignRoles = (room, { botsOnly = false } = {}) => {
  const ids = Array.from(room.players.keys()).filter((id) => {
    if (!botsOnly) return true;
    const p = room.players.get(id);
    return p && p.isBot;
  });
  if (!ids.length) return null;
  const shuffled = ids.slice().sort(() => Math.random() - 0.5);
  const impostorId = shuffled[0];
  if (!botsOnly) room.roles = {};
  ids.forEach((id) => {
    const role = id === impostorId ? 'impostor' : 'crewmate';
    room.roles[id] = role;
    const player = room.players.get(id);
    if (player) {
      player.role = role;
      player.alive = true;
    }
  });
  return impostorId;
};

const clearTimers = (room) => {
  if (room.meetingTimer) {
    clearTimeout(room.meetingTimer);
    room.meetingTimer = null;
  }
  if (room.voteTimer) {
    clearTimeout(room.voteTimer);
    room.voteTimer = null;
  }
};

/// Game over is when the impostor becomes public — the market needs their wallet to settle.
const withImpostorReveal = (room, payload) => {
  const impostor = Array.from(room.players.values()).find((p) => p.role === 'impostor');
  return {
    ...payload,
    impostorId: impostor ? impostor.id : null,
    impostorName: impostor ? impostor.name : null,
    impostorWallet: impostor ? impostor.walletAddress || null : null,
    marketAddress: room.marketAddress || null,
  };
};

const checkWin = (room) => {
  const alive = living(room);
  const imps = alive.filter((p) => p.role === 'impostor');
  const crew = alive.filter((p) => p.role !== 'impostor');
  if (imps.length === 0) {
    return { over: true, winner: 'crewmate', reason: 'Impostor ejected' };
  }
  if (imps.length >= crew.length || crew.length === 0) {
    return { over: true, winner: 'impostor', reason: 'Crew eliminated' };
  }
  return { over: false };
};

const emitLobbyState = (roomId) => {
  const room = getRoom(roomId);
  io.to(roomId).emit('lobbyState', {
    hostId: room.hostId,
    started: room.started,
    players: serializePlayers(room).filter((player) => !player.isBot),
  });
};

const emitGameState = (roomId) => {
  const room = getRoom(roomId);
  room.players.forEach((player) => {
    if (player.isBot) return;
    const socket = io.sockets.sockets.get
      ? io.sockets.sockets.get(player.id)
      : io.sockets.connected[player.id];
    if (!socket) return;
    socket.emit('gameState', {
      hostId: room.hostId,
      phase: room.phase,
      players: Array.from(room.players.values()).map((p) => ({
        id: p.id,
        name: p.name,
        x: p.x,
        y: p.y,
        isBot: Boolean(p.isBot),
        alive: p.alive !== false,
        role: p.id === player.id ? p.role : undefined,
        colorIndex: p.colorIndex,
        walletAddress: p.walletAddress || null,
      })),
      yourRole: player.role,
      roleSource: room.roleSource || 'server',
    });
  });
};

const computeTallies = (room) => {
  const aliveIds = living(room).map((p) => p.id);
  const tallies = { skip: 0 };
  aliveIds.forEach((id) => {
    tallies[id] = 0;
  });
  Object.keys(room.votes || {}).forEach((voterId) => {
    if (!aliveIds.includes(voterId)) return;
    const choice = room.votes[voterId];
    if (!choice || choice === 'skip') {
      tallies.skip += 1;
    } else if (tallies[choice] != null) {
      tallies[choice] += 1;
    }
  });
  return tallies;
};

const emitVoteState = (roomId) => {
  const room = getRoom(roomId);
  io.to(roomId).emit('voteState', {
    votes: { ...(room.votes || {}) },
    tallies: computeTallies(room),
    votedCount: Object.keys(room.votes || {}).length,
    aliveCount: living(room).length,
  });
};

const startVotePhase = (roomId) => {
  const room = getRoom(roomId);
  if (room.phase === 'vote') return;
  room.phase = 'vote';
  room.votes = {};
  // Prediction market closes when voting starts — no betting once the answer is being decided
  if (room.marketAddress && room.bettingOpen) {
    room.bettingOpen = false;
    io.to(roomId).emit('bettingClosed', { marketAddress: room.marketAddress });
  }
  io.to(roomId).emit('votePhase', {
    durationMs: VOTE_DURATION_MS,
    players: living(room).map((p) => ({
      id: p.id,
      name: p.name,
      colorIndex: p.colorIndex,
    })),
  });
  emitVoteState(roomId);

  room.voteTimer = setTimeout(() => resolveMeeting(roomId), VOTE_DURATION_MS);
};

const resolveMeeting = (roomId) => {
  const room = getRoom(roomId);
  if (room.phase !== 'vote' && room.phase !== 'discuss') return;
  clearTimers(room);

  const aliveIds = living(room).map((p) => p.id);
  const tallies = computeTallies(room);

  let best = null;
  let bestCount = -1;
  let tie = false;
  aliveIds.forEach((id) => {
    const count = tallies[id] || 0;
    if (count > bestCount) {
      best = id;
      bestCount = count;
      tie = false;
    } else if (count === bestCount && count > 0) {
      tie = true;
    }
  });

  const skipCount = tallies.skip || 0;
  let ejectedId = null;
  let reason = 'No one was ejected';

  if (bestCount > 0 && bestCount > skipCount && !tie) {
    ejectedId = best;
    const ejected = room.players.get(ejectedId);
    if (ejected) ejected.alive = false;
    reason =
      ejected && ejected.role === 'impostor'
        ? `${ejected.name} was the Impostor`
        : `${ejected ? ejected.name : 'Someone'} was not the Impostor`;
  } else if (tie || bestCount === skipCount) {
    reason = 'Tie vote — no one ejected';
  } else {
    reason = 'Vote skipped — no one ejected';
  }

  room.phase = 'results';
  io.to(roomId).emit('meetingResult', {
    ejectedId,
    reason,
    tallies,
    wasImpostor: ejectedId ? room.roles[ejectedId] === 'impostor' : false,
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive !== false,
      role: p.role,
    })),
  });

  const win = checkWin(room);
  setTimeout(() => {
    if (win.over) {
      room.phase = 'game_over';
      io.to(roomId).emit('gameOver', withImpostorReveal(room, win));
    } else {
      room.phase = 'playing';
      room.votes = {};
      io.to(roomId).emit('resumeGame');
      emitGameState(roomId);
    }
  }, 3500);
};

const beginMeeting = (roomId, reporterId, reason = 'Body reported') => {
  const room = getRoom(roomId);
  if (room.phase !== 'playing') return;
  clearTimers(room);
  room.phase = 'discuss';
  room.votes = {};
  room.chat = [];

  io.to(roomId).emit('meetingStart', {
    reporterId,
    reason,
    discussMs: MEETING_DISCUSS_MS,
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive !== false,
      colorIndex: p.colorIndex,
    })),
  });

  room.meetingTimer = setTimeout(() => startVotePhase(roomId), MEETING_DISCUSS_MS);
};

io.on('connection', (socket) => {
  const roomId = socket.handshake.query.room;
  const name = socket.handshake.query.name || 'Crewmate';
  if (!roomId) {
    socket.disconnect(true);
    return;
  }

  const room = getRoom(roomId);
  socket.join(roomId);

  if (!room.hostId) {
    room.hostId = socket.id;
  }

  const colorIndex = room.players.size % 10;
  room.players.set(socket.id, {
    id: socket.id,
    name,
    x: 330,
    y: 100,
    isBot: false,
    alive: true,
    role: null,
    colorIndex,
    walletAddress: null,
    roleHandle: null,
  });

  console.log(`player connected ${socket.id} -> ${roomId}`);
  emitLobbyState(roomId);
  if (room.started) {
    emitGameState(roomId);
  }

  socket.on('registerWallet', ({ address } = {}) => {
    const player = room.players.get(socket.id);
    if (!player || !address) return;
    player.walletAddress = String(address).toLowerCase();
    emitLobbyState(roomId);
  });

  socket.on('incoMatchOpened', () => {
    if (socket.id !== room.hostId) return;
    room.roleSource = 'inco';
    room.incoJoined = new Set();
  });

  socket.on('incoAskJoin', () => {
    if (socket.id !== room.hostId) return;
    socket.to(roomId).emit('incoJoinRequired');
  });

  socket.on('incoJoined', ({ address } = {}) => {
    const player = room.players.get(socket.id);
    if (player && address) player.walletAddress = String(address).toLowerCase();
    room.incoJoined = room.incoJoined || new Set();
    room.incoJoined.add(socket.id);
  });

  // Client peeks Inco role and claims it for gameplay (kill/win). Not broadcast to others.
  socket.on('claimIncoRole', ({ role, handle } = {}) => {
    if (room.roleSource !== 'inco') return;
    const player = room.players.get(socket.id);
    if (!player || player.isBot) return;
    if (role !== 'impostor' && role !== 'crewmate') return;
    player.role = role;
    room.roles[socket.id] = role;
    player.roleHandle = handle || null;
    socket.emit('incoRoleAck', { role });
  });

  // Host opened the confidential prediction market for this match
  socket.on('marketOpened', ({ address, matchId } = {}) => {
    if (socket.id !== room.hostId) return;
    if (!/^0x[a-fA-F0-9]{40}$/.test(String(address || ''))) return;
    room.marketAddress = address;
    room.marketMatchId = matchId != null ? String(matchId) : null;
    room.bettingOpen = true;
    io.to(roomId).emit('marketState', {
      marketAddress: room.marketAddress,
      matchId: room.marketMatchId,
      bettingOpen: true,
    });
  });

  socket.on('requestMarketState', () => {
    socket.emit('marketState', {
      marketAddress: room.marketAddress || null,
      matchId: room.marketMatchId || null,
      bettingOpen: Boolean(room.bettingOpen),
    });
  });

  socket.on('incoRoleRevealed', ({ playerId, role, wasImpostor } = {}) => {
    if (room.roleSource !== 'inco') return;
    io.to(roomId).emit('incoRoleRevealed', {
      playerId,
      role,
      wasImpostor: Boolean(wasImpostor),
    });
  });

  socket.on('startGame', ({ fillBots = true, maxPlayers = 7, roleSource = 'server', assignTxHash = null } = {}) => {
    if (socket.id !== room.hostId) return;
    // Confidential mode requires a real on-chain assignRoles tx — don't silently fall back
    if (roleSource === 'inco' && !assignTxHash) {
      socket.emit('incoStartRejected', {
        reason: 'Missing assignTxHash. Approve MetaMask assignRoles before starting.',
      });
      return;
    }
    room.started = true;
    room.fillBots = Boolean(fillBots);
    room.maxPlayers = maxPlayers;
    room.roleSource = roleSource === 'inco' ? 'inco' : 'server';
    room.assignTxHash = assignTxHash || null;
    room.phase = 'reveal';
    clearTimers(room);

    Array.from(room.players.keys()).forEach((id) => {
      if (String(id).startsWith('bot-')) room.players.delete(id);
    });

    io.to(roomId).emit('gameStarted', {
      fillBots: room.fillBots,
      roleSource: room.roleSource,
      players: serializePlayers(room),
      marketAddress: room.marketAddress || null,
      bettingOpen: Boolean(room.bettingOpen),
    });
  });

  socket.on('registerRoster', ({ players = [] } = {}) => {
    // Host sends full roster including bots for role assignment
    if (socket.id !== room.hostId && room.hostId) return;

    players.forEach((p, index) => {
      if (!room.players.has(p.id)) {
        room.players.set(p.id, {
          id: p.id,
          name: p.name,
          x: p.x || 330,
          y: p.y || 100,
          isBot: Boolean(p.isBot),
          alive: true,
          role: null,
          colorIndex: p.colorIndex != null ? p.colorIndex : index,
          walletAddress: null,
          roleHandle: null,
        });
      } else {
        const existing = room.players.get(p.id);
        existing.name = p.name || existing.name;
        existing.isBot = Boolean(p.isBot);
        existing.colorIndex =
          p.colorIndex != null ? p.colorIndex : existing.colorIndex;
      }
    });

    let impostorId = null;
    if (room.roleSource === 'inco') {
      // Humans get roles via on-chain peek + claimIncoRole; bots assigned here
      impostorId = assignRoles(room, { botsOnly: true });
      // Ensure humans start without server-assigned roles
      room.players.forEach((player) => {
        if (!player.isBot) {
          player.role = player.role || null;
          player.alive = true;
        }
      });
    } else {
      impostorId = assignRoles(room);
    }

    room.phase = 'reveal';
    room.started = true;

    room.players.forEach((player) => {
      if (player.isBot) return;
      const target = io.sockets.sockets.get
        ? io.sockets.sockets.get(player.id)
        : io.sockets.connected[player.id];
      if (!target) return;
      target.emit('rolesAssigned', {
        roleSource: room.roleSource,
        yourRole: room.roleSource === 'inco' ? null : player.role,
        impostorId:
          room.roleSource === 'inco'
            ? null
            : player.role === 'impostor'
              ? impostorId
              : null,
        allRoles:
          room.roleSource === 'server' && player.id === room.hostId
            ? room.roles
            : room.roleSource === 'inco' && player.id === room.hostId
              ? Object.fromEntries(
                  Object.entries(room.roles).filter(([id]) => {
                    const p = room.players.get(id);
                    return p && p.isBot;
                  }),
                )
              : null,
        players: Array.from(room.players.values()).map((p) => ({
          id: p.id,
          name: p.name,
          alive: true,
          isBot: Boolean(p.isBot),
          colorIndex: p.colorIndex,
          walletAddress: p.walletAddress || null,
          role:
            room.roleSource === 'inco'
              ? p.isBot && player.id === room.hostId
                ? p.role
                : undefined
              : p.id === player.id
                ? p.role
                : undefined,
          x: p.x,
          y: p.y,
        })),
      });
    });

    setTimeout(() => {
      if (room.phase === 'reveal') {
        room.phase = 'playing';
        io.to(roomId).emit('gamePhase', { phase: 'playing' });
      }
    }, 2500);
  });

  socket.on('requestGameState', ({ fillBots = true, maxPlayers = 7 } = {}) => {
    room.fillBots = Boolean(fillBots);
    room.maxPlayers = maxPlayers;
    room.started = true;
    emitGameState(roomId);
  });

  socket.on('move', ({ x, y }) => {
    const player = room.players.get(socket.id);
    if (!player || player.alive === false || room.phase !== 'playing') return;
    player.x = x;
    player.y = y;
    socket.to(roomId).emit('playerMoved', { id: socket.id, x, y });
  });

  socket.on('moveEnd', () => {
    if (room.phase !== 'playing') return;
    socket.to(roomId).emit('playerMoveEnd', { id: socket.id });
  });

  socket.on('kill', ({ targetId, x, y }) => {
    const killer = room.players.get(socket.id);
    const target = room.players.get(targetId);
    if (!killer || !target) return;
    if (killer.alive === false || room.phase !== 'playing') return;
    // Inco rooms: role comes from client claim after on-chain peek (v1)
    if (killer.role !== 'impostor') return;
    if (target.alive === false) return;
    if (target.role === 'impostor') return;

    target.alive = false;
    target.x = x != null ? x : target.x;
    target.y = y != null ? y : target.y;

    io.to(roomId).emit('playerKilled', {
      killerId: socket.id,
      targetId,
      x: target.x,
      y: target.y,
    });

    // User requested: kill triggers alert + meeting
    beginMeeting(roomId, socket.id, 'Dead body reported');
  });

  // Host can relay bot kills
  socket.on('botKill', ({ killerId, targetId, x, y }) => {
    if (socket.id !== room.hostId) return;
    const killer = room.players.get(killerId);
    const target = room.players.get(targetId);
    if (!killer || !target) return;
    if (killer.role !== 'impostor' || target.alive === false) return;
    if (room.phase !== 'playing') return;

    target.alive = false;
    target.x = x != null ? x : target.x;
    target.y = y != null ? y : target.y;

    io.to(roomId).emit('playerKilled', {
      killerId,
      targetId,
      x: target.x,
      y: target.y,
    });
    beginMeeting(roomId, killerId, 'Dead body reported');
  });

  socket.on('meetingChat', ({ text }) => {
    const room = getRoom(roomId);
    if (room.phase !== 'discuss') return;
    const player = room.players.get(socket.id);
    if (!player || player.alive === false) return;
    const clean = String(text || '')
      .trim()
      .slice(0, 60);
    if (!clean) return;
    const message = {
      id: `${Date.now()}-${socket.id}`,
      name: player.name,
      text: clean,
      system: false,
      senderId: socket.id,
    };
    room.chat = room.chat || [];
    room.chat.push(message);
    io.to(roomId).emit('meetingChat', message);
  });

  socket.on('botMeetingChat', ({ name, text }) => {
    const room = getRoom(roomId);
    if (socket.id !== room.hostId) return;
    if (room.phase !== 'discuss') return;
    const message = {
      id: `bot-${Date.now()}`,
      name: name || 'Bot',
      text: String(text || '').slice(0, 60),
      system: false,
      senderId: 'bot',
    };
    room.chat = room.chat || [];
    room.chat.push(message);
    io.to(roomId).emit('meetingChat', message);
  });

  socket.on('castVote', ({ targetId }) => {
    const voter = room.players.get(socket.id);
    if (!voter || voter.alive === false) return;
    if (room.phase !== 'vote') return;
    room.votes[socket.id] = targetId || 'skip';
    emitVoteState(roomId);

    const aliveAll = living(room);
    if (Object.keys(room.votes).length >= aliveAll.length) {
      resolveMeeting(roomId);
    }
  });

  socket.on('botVotes', ({ votes }) => {
    if (socket.id !== room.hostId) return;
    if (room.phase !== 'vote') return;
    Object.keys(votes || {}).forEach((id) => {
      const player = room.players.get(id);
      if (player && player.isBot && player.alive !== false) {
        room.votes[id] = votes[id];
      }
    });
    emitVoteState(roomId);
    if (Object.keys(room.votes).length >= living(room).length) {
      resolveMeeting(roomId);
    }
  });

  socket.on('startVote', () => {
    if (socket.id !== room.hostId) return;
    if (room.phase !== 'discuss') return;
    startVotePhase(roomId);
  });

  socket.on('resolveMeeting', () => {
    if (socket.id !== room.hostId) return;
    if (room.phase !== 'vote') return;
    resolveMeeting(roomId);
  });

  socket.on('disconnect', () => {
    console.log(`player disconnected ${socket.id}`);
    room.players.delete(socket.id);

    if (room.hostId === socket.id) {
      const nextHuman = Array.from(room.players.values()).find((player) => !player.isBot);
      room.hostId = nextHuman ? nextHuman.id : null;
    }

    socket.to(roomId).emit('playerLeft', { id: socket.id });
    emitLobbyState(roomId);

    if (room.players.size === 0) {
      clearTimers(room);
      rooms.delete(roomId);
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`server listening on port ${PORT}`);
  console.log('cors origins:', allowedOrigins.join(', '));
});
