'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('./websocket');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const WORLD_W = 1000;
const WORLD_H = 540;
const MAX_PLAYERS = 8;
const MAX_ROUNDS = 8;
const rooms = new Map();
const allSockets = new Set();

const ELEMENTS = {
  water: { color: '#28d4ff', label: 'Water' },
  earth: { color: '#8df36e', label: 'Earth' },
  fire: { color: '#ff6547', label: 'Fire' },
  air: { color: '#ffd65c', label: 'Air' },
};

const WEAPONS = {
  standard: { name: 'Standard Shell', radius: 92, damage: 58, speed: 1, terrain: 1 },
  heavy: { name: 'Heavy Bomb', radius: 138, damage: 76, speed: 0.82, terrain: 1.35 },
  cluster: { name: 'Cluster', radius: 68, damage: 43, speed: 1.08, terrain: 0.7 },
  napalm: { name: 'Napalm', radius: 102, damage: 48, speed: 0.9, terrain: 0.55 },
  terraformer: { name: 'Dirt Mover', radius: 128, damage: 0, speed: 0.9, terrain: 1.8 },
  rocket: { name: 'Rocket', radius: 58, damage: 82, speed: 1.38, terrain: 0.65 },
  tidal_surge: { name: 'Tidal Surge', radius: 112, damage: 62, speed: 1.02, terrain: 1.05, element: 'water' },
  seismic_fissure: { name: 'Seismic Fissure', radius: 104, damage: 68, speed: 0.88, terrain: 1.7, element: 'earth' },
  solar_flare: { name: 'Solar Flare', radius: 94, damage: 54, speed: 0.96, terrain: 0.7, element: 'fire' },
  cyclone: { name: 'Cyclone', radius: 116, damage: 46, speed: 1.2, terrain: 0.9, element: 'air' }
};

const ELEMENT_SIGNATURES = {
  water: 'tidal_surge', earth: 'seismic_fissure', fire: 'solar_flare', air: 'cyclone'
};

function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[crypto.randomInt(alphabet.length)];
  return code;
}

function makeTerrain(seed = Math.random()) {
  const terrain = [];
  for (let x = 0; x <= WORLD_W; x++) {
    const y = 365
      + Math.sin(x * 0.008 + seed * 9) * 39
      + Math.sin(x * 0.022 + seed * 17) * 17
      + Math.sin(x * 0.0037 + seed * 30) * 28
      + Math.sin(x * 0.047 + seed * 12) * 5;
    terrain.push(Math.max(260, Math.min(465, y)));
  }
  return terrain;
}

function terrainAt(room, x) {
  const ix = Math.max(0, Math.min(WORLD_W, Math.round(x)));
  return room.terrain[ix];
}

function deformTerrain(room, x, radius, strength, style = 'crater') {
  const from = Math.max(0, Math.floor(x - radius));
  const to = Math.min(WORLD_W, Math.ceil(x + radius));
  for (let px = from; px <= to; px++) {
    const distance = Math.abs(px - x);
    const t = Math.max(0, 1 - distance / radius);
    if (t <= 0) continue;
    const envelope = Math.sin(t * Math.PI / 2);
    let delta = envelope * strength; // Positive moves soil down, carving a crater.
    if (style === 'mound') {
      delta = -envelope * strength;
      const rim = Math.max(0, 1 - Math.abs(distance - radius * 0.78) / (radius * 0.18));
      delta -= rim * strength * 0.24;
    } else if (style === 'wash') {
      delta = envelope * strength * 0.75;
      const bank = Math.max(0, 1 - Math.abs(distance - radius * 0.72) / (radius * 0.2));
      delta -= bank * strength * 0.16;
    } else if (style === 'cluster') {
      delta = envelope * strength * 0.8;
    } else if (style === 'scorch') {
      delta = envelope * strength * 0.42;
    } else {
      const rim = Math.max(0, 1 - Math.abs(distance - radius * 0.82) / (radius * 0.16));
      delta -= rim * strength * 0.2;
    }
    room.terrain[px] = Math.max(220, Math.min(WORLD_H - 24, room.terrain[px] + delta));
  }
}

function applyWeaponTerrain(room, weapon, impact) {
  switch (weapon) {
    case 'heavy':
      deformTerrain(room, impact.x, 112, 38, 'crater');
      break;
    case 'cluster':
      [-34, 0, 34].forEach(offset => deformTerrain(room, impact.x + offset, 36, 14, 'cluster'));
      break;
    case 'napalm':
      deformTerrain(room, impact.x, 76, 10, 'scorch');
      break;
    case 'terraformer':
      // Dirt Mover throws up a raised mound instead of carving another crater.
      deformTerrain(room, impact.x, 132, 34, 'mound');
      break;
    case 'rocket':
      deformTerrain(room, impact.x, 52, 23, 'crater');
      break;
    case 'tidal_surge':
      deformTerrain(room, impact.x, 118, 18, 'wash');
      deformTerrain(room, impact.x - 44, 42, 5, 'wash');
      deformTerrain(room, impact.x + 44, 42, 5, 'wash');
      break;
    case 'seismic_fissure':
      [-104, -52, 0, 52, 104].forEach((offset, i) => {
        deformTerrain(room, impact.x + offset, 26 + (i === 2 ? 12 : 0), 21 + (i === 2 ? 10 : 0), 'crater');
      });
      break;
    case 'solar_flare':
      deformTerrain(room, impact.x, 82, 14, 'scorch');
      break;
    case 'cyclone':
      deformTerrain(room, impact.x, 96, 15, 'mound');
      break;
    default:
      deformTerrain(room, impact.x, 82, 22, 'crater');
      break;
  }
}

function livingPlayers(room) {
  return room.players.filter(p => p.alive);
}

function currentPlayer(room) {
  const player = room.players[room.turnIndex] || null;
  return player && player.alive && player.online ? player : null;
}

function normalizeTurn(room) {
  if (room.phase !== 'playing') return;
  const alive = livingPlayers(room);
  if (alive.length <= 1) {
    finishRoom(room, alive[0] || null);
    return;
  }
  let checked = 0;
  while (checked < room.players.length && (!room.players[room.turnIndex]?.alive || !room.players[room.turnIndex]?.online)) {
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    if (room.turnIndex === 0) room.round += 1;
    checked++;
  }
  if (room.round > MAX_ROUNDS) {
    const winner = [...room.players].sort((a, b) => b.score - a.score || b.totalDamage - a.totalDamage || b.hp - a.hp)[0] || null;
    finishRoom(room, winner);
  }
}

function finishRoom(room, winner) {
  room.phase = 'finished';
  room.winnerId = winner?.id || null;
  room.log.unshift(winner ? `${winner.name} wins the match!` : 'The match ended in a draw.');
  room.log = room.log.slice(0, 8);
}

function snapshot(room) {
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    maxRounds: MAX_ROUNDS,
    hostId: room.hostId,
    turnPlayerId: currentPlayer(room)?.id || null,
    winnerId: room.winnerId,
    terrain: room.terrain,
    players: room.players.map(p => ({
      id: p.id, name: p.name, color: p.color, element: p.element,
      hp: p.hp, score: p.score, totalDamage: p.totalDamage, alive: p.alive, x: p.x, armorCracks: p.armorCracks || 0,
      angle: p.angle, power: p.power, weapon: p.weapon, movesRemaining: p.movesRemaining ?? 3, online: p.online, readyForMatch: !!p.readyForMatch
    })),
    log: room.log,
    lastShot: room.lastShot,
    fireZones: room.fireZones,
    wind: room.wind
  };
}

function broadcast(room) {
  const payload = JSON.stringify({ type: 'state', state: snapshot(room) });
  for (const socket of room.clients) {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload);
  }
}

function sendError(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'error', message }));
}

function addLog(room, message) {
  room.log.unshift(message);
  room.log = room.log.slice(0, 8);
}

function positionPlayers(room) {
  const count = room.players.length;
  room.players.forEach((p, i) => {
    const x = count === 1 ? 500 : 75 + (850 * i) / (count - 1);
    p.x = x;
  });
}

function publicRoomList() {
  return [...rooms.values()]
    .filter(room => room.phase === 'lobby' && room.players.length < MAX_PLAYERS)
    .sort((a, b) => b.players.length - a.players.length)
    .map(room => ({
      code: room.code,
      playerCount: room.players.length,
      maxPlayers: MAX_PLAYERS,
      hostName: room.players.find(p => p.id === room.hostId)?.name || 'Room host',
      players: room.players.map(p => p.name)
    }));
}

function sendRoomList(socket) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'room_list', rooms: publicRoomList() }));
  }
}

function broadcastRoomList() {
  const payload = JSON.stringify({ type: 'room_list', rooms: publicRoomList() });
  for (const socket of allSockets) {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload);
  }
}

function createPlayer(id, name, color, element) {
  const valid = ELEMENTS[element] ? element : 'water';
  return {
    id,
    name: String(name || 'Player').trim().slice(0, 18) || 'Player',
    color: ELEMENTS[valid].color,
    element: valid,
    hp: 100,
    score: 0,
    totalDamage: 0,
    alive: true,
    online: true,
    x: 100,
    angle: 42,
    power: 62,
    weapon: 'standard',
    movesRemaining: 3,
    armorCracks: 0,
    readyForMatch: false
  };
}

function createRoom(socket, data) {
  let code;
  do { code = roomCode(); } while (rooms.has(code));
  const id = crypto.randomUUID();
  const player = createPlayer(id, data.name, null, data.element);
  const room = {
    code,
    hostId: id,
    players: [player],
    clients: new Set([socket]),
    phase: 'lobby',
    round: 1,
    turnIndex: 0,
    winnerId: null,
    terrain: makeTerrain(),
    log: ['Room created. Invite your friends!'],
    lastShot: null,
    fireZones: [],
    wind: Math.round(Math.random() * 13 - 6)
  };
  positionPlayers(room);
  rooms.set(code, room);
  socket.roomCode = code;
  socket.playerId = id;
  socket.send(JSON.stringify({ type: 'joined', playerId: id, code }));
  broadcast(room);
  broadcastRoomList();
}

function joinRoom(socket, data) {
  const code = String(data.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const room = rooms.get(code);
  if (!room) return sendError(socket, 'Room not found. Check the code and try again.');
  if (room.phase !== 'lobby') return sendError(socket, 'This match has already started.');
  if (room.players.length >= MAX_PLAYERS) return sendError(socket, 'This room is full (8 players maximum).');
  const id = crypto.randomUUID();
  const player = createPlayer(id, data.name, null, data.element);
  room.players.push(player);
  positionPlayers(room);
  room.clients.add(socket);
  socket.roomCode = code;
  socket.playerId = id;
  addLog(room, `${player.name} joined the room.`);
  socket.send(JSON.stringify({ type: 'joined', playerId: id, code }));
  broadcast(room);
  broadcastRoomList();
}

function resumeRoom(socket, data) {
  const code = String(data.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const room = rooms.get(code);
  const player = room?.players.find(p => p.id === data.playerId);
  if (!room || !player) {
    socket.send(JSON.stringify({ type: 'resume_failed', message: 'Your previous room is no longer available. Join an open room or create a new one.' }));
    return;
  }

  // A refreshed tab may leave its old socket briefly alive. Replace that connection
  // without marking the player offline as the old socket closes.
  for (const previous of [...room.clients]) {
    if (previous !== socket && previous.playerId === player.id) {
      previous.roomCode = null;
      previous.playerId = null;
      room.clients.delete(previous);
      previous.close();
    }
  }

  player.online = true;
  if (room.phase === 'playing' && !currentPlayer(room)) {
    const resumedTurn = room.players.findIndex(p => p.alive && p.online);
    if (resumedTurn >= 0) { room.turnIndex = resumedTurn; room.players[resumedTurn].movesRemaining = 3; }
  }
  room.clients.add(socket);
  socket.roomCode = room.code;
  socket.playerId = player.id;
  socket.send(JSON.stringify({ type: 'joined', playerId: player.id, code: room.code, resumed: true }));
  broadcast(room);
}

function applyFireZones(room) {
  const remaining = [];
  for (const zone of room.fireZones || []) {
    for (const victim of room.players) {
      if (!victim.alive) continue;
      const tankY = terrainAt(room, victim.x) - 13;
      if (Math.hypot(victim.x - zone.x, tankY - zone.y) > zone.radius) continue;
      const damage = Math.min(victim.hp, zone.damage);
      if (damage <= 0) continue;
      victim.hp -= damage;
      victim.alive = victim.hp > 0;
      const owner = room.players.find(p => p.id === zone.ownerId);
      if (owner) {
        if (victim.id === owner.id) owner.score -= damage;
        else { owner.score += damage; owner.totalDamage += damage; }
        if (!victim.alive && victim.id !== owner.id) owner.score += 20;
      }
      addLog(room, `${victim.name} took ${damage} lingering flame damage.`);
    }
    zone.turnsLeft -= 1;
    if (zone.turnsLeft > 0) remaining.push(zone);
  }
  room.fireZones = remaining;
}

function simulateShot(room, shooter) {
  applyFireZones(room);
  const terrainBefore = room.terrain.slice();
  if (!shooter.alive) {
    addLog(room, `${shooter.name} was knocked out by lingering flames before firing.`);
    return;
  }
  const weapon = WEAPONS[shooter.weapon] || WEAPONS.standard;
  const targetX = shooter.x < WORLD_W / 2 ? Math.max(...room.players.filter(p => p.id !== shooter.id && p.alive).map(p => p.x), WORLD_W / 2) : Math.min(...room.players.filter(p => p.id !== shooter.id && p.alive).map(p => p.x), WORLD_W / 2);
  const direction = targetX >= shooter.x ? 1 : -1;
  const angleRad = shooter.angle * Math.PI / 180;
  const speed = shooter.power * 5.4 * weapon.speed;
  let x = shooter.x + direction * 22;
  let y = terrainAt(room, shooter.x) - 18;
  let vx = direction * speed * Math.cos(angleRad);
  let vy = -speed * Math.sin(angleRad);
  const points = [];
  let impact = { x, y };
  let impacted = false;
  const gravity = 230;

  for (let i = 0; i < 240; i++) {
    points.push({ x, y });
    const dt = 0.045;
    vx += room.wind * 3.5 * dt;
    x += vx * dt;
    y += vy * dt;
    vy += gravity * dt;
    if (x < 0 || x > WORLD_W || y > WORLD_H) {
      impact = { x: Math.max(0, Math.min(WORLD_W, x)), y: Math.min(WORLD_H, y) };
      impacted = true;
      break;
    }
    if (y >= terrainAt(room, x)) {
      impact = { x, y: terrainAt(room, x) };
      impacted = true;
      break;
    }
    const hit = room.players.find(p => p.alive && p.id !== shooter.id && Math.hypot(p.x - x, (terrainAt(room, p.x) - 13) - y) < 13);
    if (hit) {
      impact = { x, y };
      impacted = true;
      break;
    }
  }

  if (!impacted) impact = { x: Math.max(0, Math.min(WORLD_W, x)), y: Math.min(WORLD_H, y) };
  const blastRadius = weapon.radius;
  const hitResults = [];
  let directHit = false;
  const blastCenters = shooter.weapon === 'cluster'
    ? [
        { x: impact.x - 28, y: impact.y + 4, radius: 48, damage: 29 },
        { x: impact.x, y: impact.y - 4, radius: 48, damage: 29 },
        { x: impact.x + 28, y: impact.y + 4, radius: 48, damage: 29 }
      ]
    : [{ x: impact.x, y: impact.y, radius: blastRadius, damage: weapon.damage }];

  if (shooter.weapon !== 'terraformer') {
    for (const victim of room.players) {
      if (!victim.alive) continue;
      const tankY = terrainAt(room, victim.x) - 13;
      let damage = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const center of blastCenters) {
        const distance = Math.hypot(victim.x - center.x, tankY - center.y);
        nearestDistance = Math.min(nearestDistance, distance);
        if (distance < center.radius) damage += Math.max(0, Math.round(center.damage * (1 - distance / center.radius)));
      }
      if (shooter.weapon === 'seismic_fissure' && damage > 0) { damage += 6; victim.armorCracks = Math.min(4, (victim.armorCracks || 0) + 1); }
      damage = Math.min(victim.hp, damage);
      if (damage <= 0) continue;
      const wasAlive = victim.alive;
      victim.hp = Math.max(0, victim.hp - damage);
      victim.alive = victim.hp > 0;
      if (victim.id === shooter.id) shooter.score -= damage;
      else { shooter.score += damage; shooter.totalDamage += damage; }
      if (nearestDistance < 20 && victim.id !== shooter.id) directHit = true;
      if (wasAlive && !victim.alive && victim.id !== shooter.id) shooter.score += 20;
      // Cyclone's signature effect pushes surviving tanks away from the vortex.
      if (shooter.weapon === 'cyclone' && victim.id !== shooter.id) {
        // A cyclone throws the tank off balance and clears its stored aim setup.
        victim.angle = 42; victim.power = 62; victim.weapon = 'standard';
        if (victim.alive) { const push = victim.x < impact.x ? -38 : 38; victim.x = Math.max(28, Math.min(WORLD_W - 28, victim.x + push)); }
      }
      hitResults.push({ id: victim.id, damage, hp: victim.hp, eliminated: !victim.alive });
    }
  }
  if (directHit) shooter.score += 10;

  applyWeaponTerrain(room, shooter.weapon, impact);
  const terrainAfter = room.terrain.slice();
  if (shooter.weapon === 'napalm' || shooter.weapon === 'solar_flare') {
    room.fireZones.push({ x: impact.x, y: impact.y, radius: shooter.weapon === 'solar_flare' ? 70 : 78, damage: shooter.weapon === 'solar_flare' ? 8 : 7, turnsLeft: 2, ownerId: shooter.id });
  }
  room.lastShot = {
    shooterId: shooter.id, weapon: shooter.weapon, points,
    impact, radius: blastRadius, hits: hitResults, directHit,
    terrainBefore, terrainAfter,
    terrainStyle: shooter.weapon === 'terraformer' || shooter.weapon === 'cyclone' ? 'mound' : shooter.weapon === 'tidal_surge' ? 'wash' : shooter.weapon === 'seismic_fissure' ? 'fissure' : shooter.weapon === 'solar_flare' || shooter.weapon === 'napalm' ? 'scorch' : 'crater',
    shooterElement: shooter.element,
    tankEffects: hitResults.map(hit => ({ id: hit.id, type: shooter.weapon === 'solar_flare' || shooter.weapon === 'napalm' ? 'fire' : shooter.weapon === 'tidal_surge' ? 'water' : shooter.weapon === 'seismic_fissure' ? 'earth' : shooter.weapon === 'cyclone' ? 'air' : null, durationMs: 2600 })).filter(effect => effect.type),
    statusDuration: 2600,
    timestamp: Date.now()
  };

  const totalDamage = hitResults.reduce((s, h) => s + h.damage, 0);
  addLog(room, `${shooter.name} fired ${weapon.name}${totalDamage ? ` · ${totalDamage} damage` : ''}${directHit ? ' · DIRECT HIT +10' : ''}.`);
  for (const result of hitResults) {
    const victim = room.players.find(p => p.id === result.id);
    if (result.eliminated) addLog(room, `${victim?.name || 'A tank'} was eliminated!`);
  }
}

function handleAction(socket, data) {
  const room = rooms.get(socket.roomCode);
  if (!room) return sendError(socket, 'You are not in a room.');
  const player = room.players.find(p => p.id === socket.playerId);
  if (!player) return sendError(socket, 'Player session not found.');

  if (data.action === 'start') {
    // Only the room creator can reopen a completed match. Reopening resets the
    // room to a fresh lobby; every player must then press START THE MATCH.
    if (room.phase === 'finished') {
      if (player.id !== room.hostId) return sendError(socket, 'Only the room creator can reopen this room.');
      room.players = room.players.filter(p => p.online);
      room.players.forEach(p => {
        p.hp = 100; p.score = 0; p.totalDamage = 0; p.alive = true; p.movesRemaining = 3;
        p.angle = 42; p.power = 62; p.weapon = 'standard'; p.armorCracks = 0;
        p.readyForMatch = false;
      });
      positionPlayers(room);
      room.terrain = makeTerrain(); room.fireZones = []; room.lastShot = null; room.winnerId = null;
      room.round = 1; room.turnIndex = 0; room.wind = Math.round(Math.random() * 13 - 6);
      room.phase = 'lobby';
      addLog(room, 'Room reopened. Everyone can press START THE MATCH to enter the arena.');
      broadcast(room);
      broadcastRoomList();
      return;
    }
    if (room.phase !== 'lobby') return sendError(socket, 'This match is already in progress.');
    if (!player.online) return sendError(socket, 'Reconnect before entering the arena.');
    if (player.readyForMatch) return;

    // Each player enters the battlefield independently. The first player sees
    // a waiting screen; the match starts when a second connected player also
    // presses START THE MATCH. This removes the host-only start bottleneck.
    player.readyForMatch = true;
    addLog(room, `${player.name} is ready for battle.`);
    const readyCount = room.players.filter(p => p.online && p.readyForMatch).length;
    if (readyCount >= 2) {
      room.phase = 'playing';
      room.round = 1;
      room.turnIndex = room.players.findIndex(p => p.alive && p.online);
      room.players.forEach(p => p.movesRemaining = 3);
      addLog(room, 'Two tanks are ready. The match is on!');
      broadcast(room);
      broadcastRoomList();
      return;
    }
    broadcast(room);
    broadcastRoomList();
    return;
  }

  if (data.action === 'move') {
    if (room.phase !== 'playing') return sendError(socket, 'Movement is only available during a match.');
    if (currentPlayer(room)?.id !== player.id) return sendError(socket, 'It is not your turn.');
    if (!player.alive) return sendError(socket, 'Your tank has been eliminated.');
    if (player.movesRemaining <= 0) return sendError(socket, 'No movement steps remain this turn.');
    const direction = Number(data.direction) < 0 ? -1 : 1;
    let targetX = Math.max(28, Math.min(WORLD_W - 28, player.x + direction * 28));
    for (const other of room.players) {
      if (!other.alive || other.id === player.id) continue;
      if (direction < 0 && other.x < player.x) targetX = Math.max(targetX, other.x + 40);
      if (direction > 0 && other.x > player.x) targetX = Math.min(targetX, other.x - 40);
    }
    const moved = Math.abs(targetX - player.x) > 1;
    if (!moved) return sendError(socket, 'Another tank or the battlefield edge blocks that way.');
    player.x = targetX;
    player.movesRemaining -= 1;
    addLog(room, `${player.name} repositioned ${direction < 0 ? 'left' : 'right'}.`);
    broadcast(room);
    return;
  }

  if (data.action === 'aim') {
    if (room.phase !== 'playing') return;
    if (currentPlayer(room)?.id !== player.id) return sendError(socket, 'It is not your turn.');
    player.angle = Math.max(10, Math.min(80, Number(data.angle) || 42));
    player.power = Math.max(15, Math.min(100, Number(data.power) || 62));
    if (WEAPONS[data.weapon]) {
      const signature = WEAPONS[data.weapon].element;
      if (signature && signature !== player.element) return sendError(socket, `The ${signature} signature weapon is locked to that element.`);
      player.weapon = data.weapon;
    }
    broadcast(room);
    return;
  }

  if (data.action === 'fire') {
    if (room.phase !== 'playing') return;
    if (currentPlayer(room)?.id !== player.id) return sendError(socket, 'It is not your turn.');
    if (!player.alive) return sendError(socket, 'Your tank has been eliminated.');
    if (Number.isFinite(Number(data.angle))) player.angle = Math.max(10, Math.min(80, Number(data.angle)));
    if (Number.isFinite(Number(data.power))) player.power = Math.max(15, Math.min(100, Number(data.power)));
    if (WEAPONS[data.weapon]) {
      const signature = WEAPONS[data.weapon].element;
      if (signature && signature !== player.element) return sendError(socket, `The ${signature} signature weapon is locked to that element.`);
      player.weapon = data.weapon;
    }
    simulateShot(room, player);
    const oldIndex = room.turnIndex;
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    if (room.turnIndex <= oldIndex) {
      room.round += 1;
      room.wind = Math.round(Math.random() * 15 - 7);
      addLog(room, `Round ${Math.min(room.round, MAX_ROUNDS)} begins. Wind: ${room.wind > 0 ? '+' : ''}${room.wind}.`);
    }
    normalizeTurn(room);
    if (room.phase === 'playing') {
      const next = room.players[room.turnIndex];
      if (next?.alive) next.movesRemaining = 3;
    }
    broadcast(room);
    return;
  }

  if (data.action === 'surrender') {
    if (room.phase !== 'playing') return sendError(socket, 'You can only surrender during a match.');
    if (!player.alive) return sendError(socket, 'Your tank has already been eliminated.');
    const wasCurrent = currentPlayer(room)?.id === player.id;
    player.hp = 0; player.alive = false; player.movesRemaining = 0;
    addLog(room, `${player.name} surrendered and left the battlefield.`);
    if (wasCurrent) {
      const oldIndex = room.turnIndex;
      room.turnIndex = (room.turnIndex + 1) % room.players.length;
      if (room.turnIndex <= oldIndex) {
        room.round += 1;
        room.wind = Math.round(Math.random() * 15 - 7);
      }
    }
    normalizeTurn(room);
    if (room.phase === 'playing' && room.players[room.turnIndex]?.alive) room.players[room.turnIndex].movesRemaining = 3;
    broadcast(room);
    broadcastRoomList();
    return;
  }

  if (data.action === 'leave') {
    room.players = room.players.filter(p => p.id !== player.id);
    room.clients.delete(socket);
    if (room.players.length === 0) rooms.delete(room.code);
    else {
      if (room.hostId === player.id) room.hostId = room.players.find(p => p.online)?.id || room.players[0].id;
      positionPlayers(room);
      normalizeTurn(room);
      broadcast(room);
    }
    socket.roomCode = null;
    socket.send(JSON.stringify({ type: 'left_room' }));
    broadcastRoomList();
  }
}

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const requested = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(path.join(PUBLIC_DIR, requested));
  const relativePath = path.relative(PUBLIC_DIR, safePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(safePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(safePath);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
wss.on('connection', socket => {
  allSockets.add(socket);
  socket.roomCode = null;
  socket.playerId = null;
  socket.on('message', raw => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return sendError(socket, 'Invalid message.'); }
    if (data.type === 'create_room') return createRoom(socket, data);
    if (data.type === 'join_room') return joinRoom(socket, data);
    if (data.type === 'resume_room') return resumeRoom(socket, data);
    if (data.type === 'list_rooms') return sendRoomList(socket);
    if (data.type === 'action') return handleAction(socket, data);
  });
  socket.on('close', () => {
    allSockets.delete(socket);
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    room.clients.delete(socket);
    const player = room.players.find(p => p.id === socket.playerId);
    if (player) {
      player.online = false;
      if (room.phase === 'lobby' && room.hostId === player.id) room.hostId = room.players.find(p => p.online)?.id || room.hostId;
      if (room.phase === 'playing' && room.players[room.turnIndex]?.id === player.id) {
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        normalizeTurn(room);
      }
      broadcast(room);
    }
    broadcastRoomList();
  });
  sendRoomList(socket);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Pocket Tanks Party running at http://localhost:${PORT}`);
});
