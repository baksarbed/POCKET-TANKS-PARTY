'use strict';

const ELEMENTS = {
  water: { label: 'Water', color: '#28d4ff', glyph: '◉', signature: 'tidal_surge' },
  earth: { label: 'Earth', color: '#8df36e', glyph: '⬖', signature: 'seismic_fissure' },
  fire: { label: 'Fire', color: '#ff6547', glyph: '✷', signature: 'solar_flare' },
  air: { label: 'Air', color: '#ffd65c', glyph: '⟲', signature: 'cyclone' }
};
const WEAPONS = {
  standard: { label: 'Standard', radius: 92, speed: 1 },
  heavy: { label: 'Heavy', radius: 138, speed: .82 },
  cluster: { label: 'Cluster', radius: 68, speed: 1.08 },
  napalm: { label: 'Napalm', radius: 102, speed: .9 },
  terraformer: { label: 'Dirt mover', radius: 128, speed: .9 },
  rocket: { label: 'Rocket', radius: 58, speed: 1.38 },
  tidal_surge: { label: 'Tidal Surge', radius: 112, speed: 1.02, element: 'water' },
  seismic_fissure: { label: 'Seismic Fissure', radius: 104, speed: .88, element: 'earth' },
  solar_flare: { label: 'Solar Flare', radius: 94, speed: .96, element: 'fire' },
  cyclone: { label: 'Cyclone', radius: 116, speed: 1.2, element: 'air' }
};
const WEAPON_TIPS = {
  standard: 'Balanced shell · dependable blast radius and damage.',
  heavy: 'Heavy bomb · slower flight, bigger boom, wider crater.',
  cluster: 'Cluster · splits near impact into three smaller blasts.',
  napalm: 'Napalm · leaves a burning zone that keeps hurting tanks.',
  terraformer: 'Dirt mover · raises a mound and reshapes the ground.',
  rocket: 'Rocket · very fast and precise, but with a tighter blast.',
  tidal_surge: 'WATER SIGNATURE · a rolling surge reshapes the soil and wraps hit tanks in water for 2.6 seconds.',
  seismic_fissure: 'EARTH SIGNATURE · a chain of ground ruptures adds impact damage and leaves lasting cracks in hit armor.',
  solar_flare: 'FIRE SIGNATURE · a hot starburst scorches the soil and sets damaged tanks ablaze for 2.6 seconds.',
  cyclone: 'AIR SIGNATURE · a vortex raises the ground, spins hit tanks 2.6 times, and resets their aim.'
};
const TUTORIAL_STEPS = [
  { kind: 'goal', icon: '✦', title: 'Know the mission.', body: 'You are commanding one tank in a free-for-all. Every tank starts with 100 HP. Damage your rivals, protect your own tank, and try to be the last one standing — or finish with the most points after round 8.', tip: 'Two to eight players can join the same match using a six-character room code.' },
  { kind: 'turns', icon: '↻', title: 'Wait for your turn.', body: 'This is classic turn-based artillery: the active player takes one shot, then the turn passes to the next living player. When it is not your turn, watch the battlefield and plan your next move.', tip: 'The gold turn indicator and “YOUR TURN” label show when you can control the tank.' },
  { kind: 'aim', icon: '⌁', title: 'Aim, then set your power.', body: 'Use Cannon Angle to choose a low or high arc. Set Firing Power to control how far the shell travels. The dotted preview estimates the path, and wind can bend the real shot.', tip: 'Start around 45° and 60% power. Adjust after watching where your shell lands.' },
  { kind: 'move', icon: '↔', title: 'Reposition before firing.', body: 'On your turn, move your tank up to three short steps left or right. Use the on-screen arrow buttons on touch devices, or press ← / → (A / D also works) on a keyboard. Movement does not use your shot.', tip: 'Move to improve your angle, avoid a crater, or get away from a nearby opponent. You cannot drive through another tank or off the battlefield.' },
  { kind: 'weapons', icon: '✹', title: 'Pick the right weapon.', body: 'Six shared weapons are available to everyone, plus the one signature weapon for your own element. Other elements’ signature weapons are hidden from your arsenal.', tip: 'Signature weapons also affect tanks: Water splashes, Earth leaves armor cracks, Fire sets tanks briefly ablaze, and Air spins tanks while resetting their aim.' },
  { kind: 'score', icon: '★', title: 'Score big. Stay alive.', body: 'Earn +1 point for each point of damage, +10 for a direct hit, and +20 for eliminating an opponent. Self-inflicted damage costs 1 point per damage. The match ends when one tank remains or after round 8.', tip: 'If the match reaches round 8, ties are broken by opponent damage, then remaining HP.' }
];
const $ = id => document.getElementById(id);
const screens = ['lobby-screen', 'room-screen', 'game-screen'];
let socket;
let connected = false;
let selectedElement = 'water';
let selectedWeapon = 'standard';
let playerId = null;
let roomState = null;
let lastRenderedShot = 0;
let shotAnimation = null;
let tutorialStep = 0;
let shouldReconnect = true;
let reconnectTimer = null;
let availableRooms = [];
let roomListInitialized = false;
let knownRoomCodes = new Set();
let freshRoomCodes = new Set();
let guideStep = 0;
let activeShotFx = null;
let localAim = { angle: 42, power: 62 };
let errorTimer;

function setScreen(id) {
  screens.forEach(s => $(s).classList.toggle('hidden', s !== id));
  $('match-result').classList.add('hidden');
}
function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); } catch { /* Storage may be unavailable. */ } }
function storageRemove(key) { try { localStorage.removeItem(key); } catch { /* Storage may be unavailable. */ } }
function setError(message) {
  $('lobby-error').textContent = message || '';
  clearTimeout(errorTimer);
  if (message) errorTimer = setTimeout(() => $('lobby-error').textContent = '', 6500);
}
function send(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    setError('Not connected to the game server yet.');
    return;
  }
  socket.send(JSON.stringify(message));
}
function connect() {
  shouldReconnect = true;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}`);
  socket.addEventListener('open', () => {
    connected = true;
    $('connection-label').textContent = 'SERVER ONLINE';
    $('connection-label').previousElementSibling.style.background = 'var(--earth)';
    const savedPlayer = storageGet('ptp-player');
    const savedRoom = storageGet('ptp-room');
    if (savedPlayer && savedRoom) {
      send({ type: 'resume_room', playerId: savedPlayer, code: savedRoom });
    } else {
      send({ type: 'list_rooms' });
    }
  });
  socket.addEventListener('close', () => {
    connected = false;
    $('connection-label').textContent = 'RECONNECTING';
    $('connection-label').previousElementSibling.style.background = 'var(--fire)';
    if (shouldReconnect) {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 1600);
    }
  });
  socket.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'error') setError(message.message);
    if (message.type === 'joined') {
      playerId = message.playerId;
      storageSet('ptp-player', playerId);
      storageSet('ptp-room', message.code);
      $('rejoin-room').classList.add('hidden');
      $('room-code-display').textContent = message.code;
      $('game-room-code').textContent = message.code;
      setScreen('room-screen');
      setError('');
    }
    if (message.type === 'resume_failed') {
      storageRemove('ptp-player');
      storageRemove('ptp-room');
      $('rejoin-room').classList.add('hidden');
      playerId = null; roomState = null;
      setScreen('lobby-screen');
      setError(message.message || 'Could not return to your previous room.');
      send({ type: 'list_rooms' });
    }
    if (message.type === 'left_room') {
      playerId = null; roomState = null;
      send({ type: 'list_rooms' });
      renderRoomList(availableRooms);
    }
    if (message.type === 'room_list') {
      availableRooms = message.rooms || [];
      const incomingCodes = new Set(availableRooms.map(room => room.code));
      if (roomListInitialized) {
        for (const room of availableRooms) {
          if (!knownRoomCodes.has(room.code)) {
            freshRoomCodes.add(room.code);
            setTimeout(() => { freshRoomCodes.delete(room.code); renderRoomList(availableRooms); }, 12000);
          }
        }
      }
      knownRoomCodes = incomingCodes;
      roomListInitialized = true;
      renderRoomList(availableRooms);
    }
    if (message.type === 'state') {
      roomState = message.state;
      renderState();
    }
  });
}

function playerName() {
  return $('player-name').value.trim().slice(0, 18) || 'Captain';
}
function renderRoomList(rooms) {
  const list = $('room-browser-list');
  if (!list) return;
  list.innerHTML = '';
  if (!rooms.length) {
    const empty = document.createElement('div');
    empty.className = 'room-browser-empty';
    empty.textContent = 'No open rooms yet. Create one or enter a room code.';
    list.appendChild(empty);
    return;
  }
  rooms.slice(0, 8).forEach(room => {
    const button = document.createElement('button');
    button.type = 'button';
    const isNew = freshRoomCodes.has(room.code);
    button.className = `room-browser-item${isNew ? ' new-room-flash' : ''}`;
    const left = document.createElement('span'); left.className = 'room-browser-meta';
    const strong = document.createElement('b'); strong.textContent = `${room.hostName}'s room`;
    const small = document.createElement('small'); small.textContent = `${room.playerCount}/${room.maxPlayers} PLAYERS · ${room.code}`;
    left.append(strong, small);
    const join = document.createElement('span'); join.className = 'room-browser-join'; join.textContent = isNew ? 'NEW · JOIN →' : 'JOIN →';
    button.append(left, join);
    button.addEventListener('click', () => {
      $('room-code').value = room.code;
      freshRoomCodes.delete(room.code);
      renderRoomList(availableRooms);
      joinRoom();
    });
    list.appendChild(button);
  });
}
function createRoom() {
  if (!connected) return setError('Connecting to the server… try again in a moment.');
  send({ type: 'create_room', name: playerName(), element: selectedElement });
}
function joinRoom() {
  if (!connected) return setError('Connecting to the server… try again in a moment.');
  const code = $('room-code').value.trim().toUpperCase();
  if (code.length !== 6) return setError('Enter the 6-character room code.');
  send({ type: 'join_room', code, name: playerName(), element: selectedElement });
}
function renderState() {
  if (!roomState) return;
  $('room-code-display').textContent = roomState.code;
  $('game-room-code').textContent = roomState.code;
  $('player-count').textContent = roomState.players.length;
  renderPlayers();
  const onlineCount = roomState.players.filter(p => p.online !== false).length;
  const me = roomState.players.find(p => p.id === playerId);
  const iAmInArena = roomState.phase === 'lobby' && !!me?.readyForMatch;
  const readyCount = roomState.players.filter(p => p.online !== false && p.readyForMatch).length;
  const waiting = $('room-waiting');
  waiting.classList.toggle('is-ready', roomState.phase === 'lobby' && readyCount >= 1);
  $('waiting-title').textContent = roomState.phase === 'finished' ? 'MATCH COMPLETE' : readyCount ? `${readyCount} PLAYER${readyCount === 1 ? '' : 'S'} READY` : onlineCount >= 2 ? 'YOUR CREW IS ASSEMBLING' : 'YOUR ROOM IS OPEN';
  $('waiting-copy').textContent = roomState.phase === 'finished' ? 'The room creator can reopen this room for another match.' : readyCount ? 'Press START THE MATCH to enter the arena. The match begins when two players are ready.' : 'Waiting for another tank to join… share the room code!';
  waiting.classList.toggle('hidden', roomState.phase !== 'lobby' && roomState.phase !== 'finished');
  $('pre-match-waiting').classList.toggle('hidden', !iAmInArena);
  $('pre-match-code').textContent = roomState.code;
  $('pre-match-message').textContent = `${readyCount} of ${onlineCount} connected player${onlineCount === 1 ? '' : 's'} ready · waiting for another player to press START THE MATCH…`;
  if (roomState.phase === 'lobby') {
    setScreen(iAmInArena ? 'game-screen' : 'room-screen');
    if (iAmInArena) renderGame();
  }
  if (roomState.phase === 'playing' || roomState.phase === 'finished') {
    setScreen('game-screen');
    $('pre-match-waiting').classList.add('hidden');
    renderGame();
  }
  if (roomState.lastShot && roomState.lastShot.timestamp !== lastRenderedShot) {
    lastRenderedShot = roomState.lastShot.timestamp;
    const airReset = (roomState.lastShot.tankEffects || []).some(effect => effect.id === playerId && effect.type === 'air');
    if (airReset) {
      localAim = { angle: 42, power: 62 };
      selectedWeapon = 'standard';
      $('angle').value = 42; $('angle-value').textContent = '42';
      $('power').value = 62; $('power-value').textContent = '62';
      renderGame();
    }
    startShotAnimation(roomState.lastShot);
  }
  if (roomState.phase === 'finished' && !activeShotFx) showResult();
}
function renderPlayers() {
  const onlineCount = roomState.players.filter(p => p.online !== false).length;
  const isHost = roomState.players.some(p => p.id === playerId) && roomState.hostId === playerId;
  const list = $('player-list');
  list.innerHTML = '';
  roomState.players.forEach((p, i) => {
    const element = ELEMENTS[p.element] || ELEMENTS.water;
    const card = document.createElement('div');
    card.className = 'player-card';
    const playerStatus = p.online === false ? 'OFFLINE' : p.readyForMatch ? 'IN ARENA · READY' : 'IN ROOM';
    card.innerHTML = `<span class="player-sigil" style="background:${element.color}20;color:${element.color}"><img src="/icons/${p.element}.svg" alt="${element.label} emblem" /></span><span class="player-meta"><b></b><small>${element.label.toUpperCase()} ELEMENT · ${playerStatus}</small></span>${p.id === roomState.hostId ? '<span class="host-tag">HOST</span>' : ''}`;
    card.querySelector('.player-meta b').textContent = p.name;
    list.appendChild(card);
  });
  for (let i = roomState.players.length; i < 8; i++) {
    const empty = document.createElement('div');
    empty.className = 'empty-slot';
    empty.textContent = '+ OPEN SLOT';
    list.appendChild(empty);
  }
  const me = roomState.players.find(p => p.id === playerId);
  const isReady = !!me?.readyForMatch;
  const canReopen = roomState.phase === 'finished' && isHost;
  const canEnterArena = roomState.phase === 'lobby' && !!me && !isReady;
  $('start-match').disabled = !(canReopen || canEnterArena);
  $('start-match').querySelector('span:first-child').textContent = roomState.phase === 'finished'
    ? (isHost ? 'REOPEN ROOM' : 'WAITING FOR CREATOR')
    : isReady ? 'YOU ARE READY' : 'START THE MATCH';
  $('host-hint').textContent = roomState.phase === 'finished'
    ? (isHost ? 'ROOM CREATOR · OPEN THIS ROOM FOR A NEW MATCH' : 'WAITING FOR THE ROOM CREATOR TO REOPEN')
    : roomState.phase !== 'lobby' ? 'MATCH IN PROGRESS'
      : isReady ? 'YOU ARE IN THE ARENA · WAITING FOR ONE MORE PLAYER TO PRESS START'
        : 'PRESS START TO ENTER THE ARENA · THE MATCH BEGINS WHEN 2 PLAYERS ARE READY';
  $('host-hint').classList.toggle('ready-hint', isReady);
}
function renderGame() {
  const me = roomState.players.find(p => p.id === playerId);
  const turn = roomState.players.find(p => p.id === roomState.turnPlayerId);
  const myTurn = !!me && !!turn && me.id === turn.id && me.alive && roomState.phase === 'playing';
  $('round-number').textContent = Math.min(roomState.round, roomState.maxRounds);
  const waitingToStart = roomState.phase === 'lobby';
  $('turn-name').textContent = waitingToStart ? 'WAITING FOR CREW' : turn ? turn.name.toUpperCase() : 'MATCH COMPLETE';
  $('turn-label').textContent = waitingToStart ? 'PRE-MATCH' : myTurn ? 'YOUR TURN' : 'CURRENT TURN';
  $('turn-subtitle').textContent = waitingToStart ? 'READY CHECK · TWO PLAYERS REQUIRED' : myTurn ? 'LINE UP YOUR SHOT' : (turn ? 'WAITING FOR THE SHOT' : 'THE MATCH IS OVER');
  $('control-lock').textContent = waitingToStart ? 'READY · WAITING FOR PLAYER' : myTurn ? '● YOUR TURN' : (me && !me.alive ? 'TANK ELIMINATED' : 'WAITING FOR TURN');
  $('control-lock').classList.toggle('ready', myTurn);
  const animationBusy = !!activeShotFx;
  $('fire-button').disabled = !myTurn || animationBusy;
  $('angle').disabled = !myTurn || animationBusy;
  $('power').disabled = !myTurn || animationBusy;
  const moves = me?.movesRemaining ?? 3;
  $('moves-value').textContent = `${moves} ${moves === 1 ? 'STEP' : 'STEPS'}`;
  $('move-left').disabled = !myTurn || animationBusy || moves <= 0;
  $('move-right').disabled = !myTurn || animationBusy || moves <= 0;
  const weaponOwner = me || turn;
  $('weapon-list').querySelectorAll('button').forEach(b => {
    const unavailable = b.dataset.element && b.dataset.element !== weaponOwner?.element;
    b.classList.toggle('hidden', !!unavailable);
    b.disabled = !myTurn || animationBusy;
    b.classList.remove('locked');
    b.title = WEAPON_TIPS[b.dataset.weapon] || 'Select weapon';
  });
  if (myTurn && WEAPONS[selectedWeapon]?.element && WEAPONS[selectedWeapon].element !== me.element) selectedWeapon = 'standard';
  if (turn) {
    $('angle').value = myTurn ? localAim.angle : turn.angle;
    $('power').value = myTurn ? localAim.power : turn.power;
    $('angle-value').textContent = $('angle').value;
    $('power-value').textContent = $('power').value;
    if (!myTurn) selectedWeapon = WEAPONS[turn.weapon]?.element && WEAPONS[turn.weapon].element !== me?.element ? 'standard' : turn.weapon;
    $('weapon-list').querySelectorAll('button').forEach(b => b.classList.toggle('selected', b.dataset.weapon === selectedWeapon));
  }
  $('wind-value').textContent = roomState.wind === 0 ? 'CALM' : `${roomState.wind > 0 ? '→' : '←'} ${Math.abs(roomState.wind)}`;
  $('game-surrender').classList.toggle('hidden', roomState.phase !== 'playing');
  $('round-progress-fill').style.width = `${Math.min(100, roomState.round / roomState.maxRounds * 100)}%`;
  renderScores();
  renderFeed();
  renderWeaponTip();
  drawArena();
}
function renderScores() {
  const list = $('score-list');
  list.innerHTML = '';
  const ordered = [...roomState.players].sort((a, b) => b.score - a.score);
  ordered.forEach(p => {
    const el = ELEMENTS[p.element] || ELEMENTS.water;
    const item = document.createElement('div');
    const active = p.id === roomState.turnPlayerId;
    item.className = `score-item ${active ? 'active' : ''} ${!p.alive ? 'dead' : ''}`;
    item.innerHTML = `<div class="score-head"><span class="score-name"><i class="score-dot" style="background:${p.color}"></i><b></b></span><span class="score-points">${p.score > 0 ? '+' : ''}${p.score}</span></div><div class="health-track"><div class="health-fill" style="width:${p.hp}%;background:${p.hp < 30 ? 'var(--fire)' : 'var(--earth)'}"></div></div><div class="score-sub"><span>${p.alive ? `${p.hp} HP` : 'ELIMINATED'}</span><span>${p.id === playerId ? 'YOU' : el.label.toUpperCase()}</span></div>`;
    item.querySelector('.score-name b').textContent = p.name;
    list.appendChild(item);
  });
}
function renderFeed() {
  const list = $('event-list');
  list.innerHTML = '';
  (roomState.log || []).slice(0, 7).forEach((entry, i) => {
    const item = document.createElement('div');
    item.className = 'event-item';
    item.innerHTML = `<span class="event-time">${i === 0 ? 'LATEST EVENT' : `FIELD LOG 0${i + 1}`}</span>`;
    const txt = document.createElement('span');
    txt.textContent = entry;
    item.appendChild(txt);
    list.appendChild(item);
  });
}

const canvas = $('arena');
const ctx = canvas.getContext('2d');
const ELEMENT_CRESTS = {};
for (const element of ['water', 'earth', 'fire', 'air']) {
  const img = new Image();
  img.src = `/icons/${element}.svg`;
  img.onload = () => drawArena();
  ELEMENT_CRESTS[element] = img;
}
function renderedTerrain() {
  const finalTerrain = roomState?.terrain || [];
  const fx = activeShotFx;
  if (!fx?.shot?.terrainBefore || !fx?.shot?.terrainAfter) return finalTerrain;
  const elapsed = performance.now() - fx.started;
  if (elapsed <= fx.flightDuration) return fx.shot.terrainBefore;
  const t = Math.max(0, Math.min(1, (elapsed - fx.flightDuration) / fx.impactDuration));
  const eased = t * t * (3 - 2 * t);
  const before = fx.shot.terrainBefore, after = fx.shot.terrainAfter;
  return before.map((v, i) => v + ((after[i] ?? v) - v) * eased);
}
function drawArena() {
  if (!roomState) return;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#32a9d0'); sky.addColorStop(.43, '#83d4d1'); sky.addColorStop(.72, '#f7cf91'); sky.addColorStop(1, '#ffad78');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  // Soft atmospheric sun and a few layered clouds.
  const sunGlow = ctx.createRadialGradient(795,108,5,795,108,88); sunGlow.addColorStop(0,'rgba(255,250,199,.98)'); sunGlow.addColorStop(.24,'rgba(255,225,126,.68)'); sunGlow.addColorStop(1,'rgba(255,185,91,0)'); ctx.fillStyle=sunGlow; ctx.beginPath(); ctx.arc(795,108,88,0,Math.PI*2); ctx.fill(); ctx.fillStyle = 'rgba(255,246,190,.95)'; ctx.beginPath(); ctx.arc(795, 108, 25, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 5; i++) {
    const x = 105 + i * 182, y = 76 + (i % 2) * 40;
    ctx.fillStyle = 'rgba(241,246,235,.28)'; ctx.beginPath(); ctx.ellipse(x, y, 52, 8, 0, 0, Math.PI * 2); ctx.fill();
  }
  // Distant ridges.
  drawRidge('#5caaa0', 0.48, 0, 60, 18);
  drawRidge('#397e79', 0.57, 0, 44, 31);
  // Tiny drifting motes.
  for (let i = 0; i < 26; i++) {
    const x = (i * 137 + 33) % w, y = (i * 59 + 28) % 230;
    ctx.fillStyle = 'rgba(255,244,210,.23)'; ctx.fillRect(x, y, 2, 2);
  }
  // Terrain path.
  const terrain = renderedTerrain();
  ctx.beginPath(); ctx.moveTo(0, h);
  for (let x = 0; x < terrain.length; x++) ctx.lineTo(x, terrain[x]);
  ctx.lineTo(w, h); ctx.closePath();
  const ground = ctx.createLinearGradient(0, 300, 0, h);
  ground.addColorStop(0, '#8dd66b'); ground.addColorStop(.2, '#4eaa70'); ground.addColorStop(.58, '#277b68'); ground.addColorStop(1, '#123e48');
  ctx.fillStyle = ground; ctx.fill();
  (roomState.fireZones || []).forEach(zone => {
    ctx.save();
    const flame = ctx.createRadialGradient(zone.x, zone.y, 2, zone.x, zone.y, zone.radius);
    flame.addColorStop(0, 'rgba(255,132,77,.34)'); flame.addColorStop(1, 'rgba(255,132,77,0)');
    ctx.fillStyle = flame; ctx.beginPath(); ctx.ellipse(zone.x, zone.y + 14, zone.radius, 20, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });
  ctx.beginPath();
  for (let x = 0; x < terrain.length; x++) { if (x === 0) ctx.moveTo(x, terrain[x]); else ctx.lineTo(x, terrain[x]); }
  ctx.strokeStyle = '#d8ff9a'; ctx.lineWidth = 4; ctx.shadowColor = 'rgba(185,255,129,.65)'; ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;
  // Ground texture.
  for (let i = 0; i < 90; i++) {
    const x = (i * 97 + 19) % w, y = terrain[x] + 20 + (i % 5) * 17;
    ctx.fillStyle = i % 2 ? 'rgba(255,231,151,.22)' : 'rgba(3,42,43,.23)';
    ctx.fillRect(x, y, 12 + (i % 3) * 5, 2);
  }
  // Aim preview for the active player.
  const me = roomState.players.find(p => p.id === playerId);
  const turn = roomState.players.find(p => p.id === roomState.turnPlayerId);
  if (me && turn && me.id === turn.id && me.alive) drawAimPreview(me);
  roomState.players.forEach(p => drawTank(p));
  if (roomState.lastShot) drawShotImpact(roomState.lastShot);
}
function drawRidge(color, baseY, phase, amp, drift) {
  ctx.beginPath(); ctx.moveTo(0, canvas.height);
  for (let x = 0; x <= canvas.width; x += 8) {
    const y = canvas.height * baseY - Math.sin(x * .006 + phase) * amp - Math.sin(x * .019 + phase) * drift;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(canvas.width, canvas.height); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
}
function drawTank(p) {
  const terrain = renderedTerrain();
  const groundY = terrain[Math.max(0, Math.min(1000, Math.round(p.x)))];
  const x = p.x, y = groundY - 10;
  ctx.save();
  const fx = activeShotFx;
  const hitEffect = fx?.shot?.tankEffects?.find(effect => effect.id === p.id) || null;
  const effectStart = fx ? fx.flightDuration + fx.impactDuration : 0;
  const effectElapsed = fx ? performance.now() - fx.started - effectStart : -1;
  const effectDuration = fx?.shot?.statusDuration || hitEffect?.durationMs || 2600;
  const effectActive = !!hitEffect && effectElapsed >= 0 && effectElapsed < effectDuration && p.alive;
  const effectProgress = effectActive ? Math.max(0, Math.min(1, effectElapsed / effectDuration)) : 0;
  const defeatedHit = fx?.shot?.hits?.find(hit => hit.id === p.id && hit.eliminated);
  if (defeatedHit) {
    const elapsed = performance.now() - fx.started;
    const breakStart = fx.flightDuration + fx.impactDuration;
    if (elapsed >= breakStart) {
      drawDefeatedTank(p, Math.min(1, (elapsed - breakStart) / fx.breakDuration));
      ctx.restore();
      return;
    }
  }
  if (!p.alive && !defeatedHit) { ctx.globalAlpha = .25; }
  // Ground shadow.
  ctx.fillStyle = 'rgba(10,23,26,.3)'; ctx.beginPath(); ctx.ellipse(x, groundY + 2, 27, 6, 0, 0, Math.PI * 2); ctx.fill();
  // Tracks and armored hull. Air attacks spin only the tank assembly, not its nameplate.
  ctx.save();
  if (effectActive && hitEffect.type === 'air') {
    ctx.translate(x, y - 10);
    ctx.rotate(effectProgress * Math.PI * 2 * 2.6);
    ctx.translate(-x, -(y - 10));
  }
  ctx.fillStyle = '#25343a'; roundedRect(ctx, x - 21, y - 5, 42, 12, 5); ctx.fill();
  ctx.fillStyle = '#78877b';
  for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(x - 14 + i * 7, y + 1, 2.3, 0, Math.PI * 2); ctx.fill(); }
  // Body and turret.
  const bodyGlow = ctx.createLinearGradient(x - 15, y - 16, x + 12, y - 2); bodyGlow.addColorStop(0, '#ffffff'); bodyGlow.addColorStop(.16, p.color); bodyGlow.addColorStop(.68, p.color); bodyGlow.addColorStop(1, shadeColor(p.color, -38)); ctx.fillStyle = bodyGlow; roundedRect(ctx, x - 17, y - 15, 34, 13, 4); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.62)'; ctx.lineWidth = 1; roundedRect(ctx, x - 16.5, y - 14.5, 33, 12, 3.5); ctx.stroke();
  ctx.fillStyle = shadeColor(p.color, -22); ctx.beginPath(); ctx.arc(x, y - 16, 8, Math.PI, Math.PI * 2); ctx.fill();
  const aim = p.angle || 42;
  const sign = p.x < 500 ? 1 : -1;
  const a = (p.id === playerId && roomState.turnPlayerId === playerId) ? localAim.angle : aim;
  const rad = a * Math.PI / 180;
  ctx.strokeStyle = shadeColor(p.color, -18); ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.shadowColor = p.color; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.moveTo(x, y - 16); ctx.lineTo(x + sign * Math.cos(rad) * 21, y - 16 - Math.sin(rad) * 21); ctx.stroke(); ctx.shadowBlur = 0;
  // Element glint and the tank's original elemental crest.
  ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 7; ctx.beginPath(); ctx.ellipse(x - 7, y - 12, 5, 1.5, -.18, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
  const crest = ELEMENTS[p.element] || ELEMENTS.water;
  const crestImage = ELEMENT_CRESTS[p.element];
  if (crestImage?.complete && crestImage.naturalWidth) {
    ctx.save(); ctx.shadowColor = crest.color; ctx.shadowBlur = 8;
    ctx.drawImage(crestImage, x - 6, y - 15, 12, 12); ctx.restore();
  }
  // Earth attacks leave lasting armor scars even after the temporary stone coating fades.
  if ((p.armorCracks || 0) > 0) {
    ctx.save(); ctx.strokeStyle = 'rgba(35,30,24,.82)'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    const cracks = Math.min(4, p.armorCracks || 0);
    for (let i = 0; i < cracks; i++) { const cx = x - 12 + (i * 7); ctx.beginPath(); ctx.moveTo(cx, y - 14); ctx.lineTo(cx - 2, y - 10); ctx.lineTo(cx + 1, y - 7); ctx.lineTo(cx - 1, y - 4); ctx.stroke(); }
    ctx.restore();
  }
  ctx.restore(); // End rotating tank assembly.
  if (effectActive) drawTankStatusEffect(p, hitEffect.type, effectProgress, x, y);
  // Nameplate.
  ctx.font = '600 11px Manrope, sans-serif'; ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(13,24,34,.62)'; roundedRect(ctx, x - 35, y - 46, 70, 17, 5); ctx.fill();
  ctx.fillStyle = '#f5f1e5'; ctx.fillText(p.name.slice(0, 11), x, y - 34);
  // HP bar.
  ctx.fillStyle = 'rgba(12,21,29,.7)'; roundedRect(ctx, x - 22, y - 25, 44, 4, 2); ctx.fill();
  ctx.fillStyle = p.hp < 30 ? '#ff6547' : '#9bd29a'; roundedRect(ctx, x - 22, y - 25, 44 * p.hp / 100, 4, 2); ctx.fill();
  if (!p.alive && !defeatedHit) { ctx.strokeStyle = 'rgba(255,120,100,.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 13, y - 26); ctx.lineTo(x + 13, y - 4); ctx.moveTo(x + 13, y - 26); ctx.lineTo(x - 13, y - 4); ctx.stroke(); }
  ctx.restore();
}
function drawTankStatusEffect(p, type, progress, x, y) {
  const now = performance.now();
  ctx.save();
  if (type === 'fire') {
    const glow = ctx.createRadialGradient(x, y - 10, 2, x, y - 10, 33);
    glow.addColorStop(0, 'rgba(255,225,120,.32)'); glow.addColorStop(1, 'rgba(255,65,30,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.ellipse(x, y - 9, 34, 27, 0, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI * 2 / 8 + Math.sin(now / 115 + i) * .12;
      const flick = .7 + Math.sin(now / 90 + i * 1.8) * .25;
      const px = x + Math.cos(a) * (16 + (i % 2) * 4), py = y - 12 + Math.sin(a) * 11;
      ctx.globalAlpha = flick * (1 - progress * .2);
      ctx.fillStyle = i % 2 ? '#ff633c' : '#ffd05f';
      ctx.beginPath(); ctx.moveTo(px - 4, py + 7); ctx.quadraticCurveTo(px - 8, py - 3, px, py - 12 - (i % 3) * 3); ctx.quadraticCurveTo(px + 8, py - 1, px + 4, py + 7); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (type === 'water') {
    ctx.fillStyle = 'rgba(53,202,255,.23)'; ctx.strokeStyle = 'rgba(191,249,255,.9)'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.ellipse(x, y - 15, 28, 27, 0, Math.PI, Math.PI * 2); ctx.fill(); ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const r = 15 + i * 7 + Math.sin(now / 180 + i) * 2;
      ctx.strokeStyle = `rgba(119,235,255,${.8 - i * .16})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y - 7, r, 5 + i, 0, 0, Math.PI * 2); ctx.stroke();
    }
    for (let i = 0; i < 5; i++) {
      const dx = Math.sin(now / 240 + i * 1.7) * 27;
      const dy = (now / 5 + i * 17) % 30;
      ctx.fillStyle = 'rgba(180,247,255,.9)'; ctx.beginPath(); ctx.arc(x + dx, y - 35 + dy, 2 + (i % 2), 0, Math.PI * 2); ctx.fill();
    }
  } else if (type === 'earth') {
    ctx.fillStyle = 'rgba(139,112,76,.28)'; ctx.strokeStyle = 'rgba(224,198,143,.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 25, y - 8); ctx.lineTo(x - 20, y - 27); ctx.lineTo(x - 8, y - 23); ctx.lineTo(x + 1, y - 31); ctx.lineTo(x + 15, y - 23); ctx.lineTo(x + 24, y - 12); ctx.lineTo(x + 21, y + 1); ctx.lineTo(x - 18, y + 1); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(47,39,28,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 8, y - 25); ctx.lineTo(x - 3, y - 15); ctx.lineTo(x - 9, y - 9); ctx.moveTo(x + 7, y - 22); ctx.lineTo(x + 3, y - 12); ctx.lineTo(x + 11, y - 7); ctx.stroke();
    for (let i = 0; i < 6; i++) { const a = now / 500 + i * Math.PI / 3; const r = 27 + Math.sin(now / 160 + i) * 3; ctx.fillStyle = i % 2 ? '#a88658' : '#e2c58e'; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r, y - 12 + Math.sin(a) * r * .5); ctx.lineTo(x + Math.cos(a + .2) * (r + 5), y - 12 + Math.sin(a + .2) * (r + 5) * .5); ctx.lineTo(x + Math.cos(a + .5) * (r - 2), y - 12 + Math.sin(a + .5) * (r - 2) * .5); ctx.closePath(); ctx.fill(); }
  } else if (type === 'air') {
    ctx.strokeStyle = 'rgba(229,250,255,.88)'; ctx.lineWidth = 2.5; ctx.shadowColor = '#9cecff'; ctx.shadowBlur = 12;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.ellipse(x, y - 12, 26 + i * 7, 8 + i * 4, -0.3 + i * .3 + progress * 2, now / 500 + i, now / 500 + i + Math.PI * 1.4); ctx.stroke();
    }
    ctx.shadowBlur = 0;
    for (let i = 0; i < 5; i++) { const dx = ((now / 10 + i * 29) % 68) - 34; ctx.strokeStyle = 'rgba(220,249,255,.7)'; ctx.beginPath(); ctx.moveTo(x + dx, y - 27 - (i % 2) * 8); ctx.lineTo(x + dx + 9, y - 31 - (i % 2) * 8); ctx.stroke(); }
  }
  ctx.restore();
}

function drawDefeatedTank(p, progress) {
  const terrain = renderedTerrain();
  const groundY = terrain[Math.max(0, Math.min(1000, Math.round(p.x)))];
  const x = p.x, y = groundY - 10;
  const fade = Math.max(0, 1 - progress * .82);
  ctx.save(); ctx.globalAlpha = fade;
  // Two tumbling hull fragments, smoke puffs and hot sparks make the final hit readable.
  for (let half = -1; half <= 1; half += 2) {
    const lift = Math.sin(progress * Math.PI) * 25 + progress * 26;
    ctx.save(); ctx.translate(x + half * progress * 24, y - 8 - lift);
    ctx.rotate(half * progress * 1.6);
    const g = ctx.createLinearGradient(-12, -7, 10, 7); g.addColorStop(0, '#fff'); g.addColorStop(.2, p.color); g.addColorStop(1, '#263746');
    ctx.fillStyle = g; roundedRect(ctx, -12, -7, 24, 14, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
  }
  for (let i = 0; i < 9; i++) {
    const angle = i * Math.PI * 2 / 9 + progress * 1.5;
    const distance = 8 + progress * (26 + (i % 3) * 8);
    drawSpark(x + Math.cos(angle) * distance, y - 12 + Math.sin(angle) * distance, angle, 8 * (1 - progress) + 2, i % 2 ? '#ffb84d' : '#bcecff', fade);
  }
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = `rgba(62,71,78,${.22 * fade})`;
    ctx.beginPath(); ctx.arc(x - 8 + i * 7, y - 28 - progress * (38 + i * 8), 7 + progress * 5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawAimPreview(p) {
  const terrain = renderedTerrain();
  const x = p.x, y = terrain[Math.round(p.x)] - 18;
  const sign = p.x < 500 ? 1 : -1;
  const angle = localAim.angle * Math.PI / 180;
  const speed = localAim.power * 5.4 * (WEAPONS[selectedWeapon]?.speed || 1);
  let vx = sign * speed * Math.cos(angle), vy = -speed * Math.sin(angle), px = x + sign * 22, py = y;
  ctx.save(); ctx.setLineDash([4, 7]); ctx.strokeStyle = 'rgba(255,255,218,.9)'; ctx.shadowColor = '#fff1a8'; ctx.shadowBlur = 7; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(px, py);
  for (let i = 0; i < 130; i++) {
    const dt = .045; vx += (roomState.wind || 0) * 3.5 * dt; px += vx * dt; py += vy * dt; vy += 230 * dt;
    if (px < 0 || px > 1000 || py > terrain[Math.max(0, Math.min(1000, Math.round(px)))]) break;
    ctx.lineTo(px, py);
  }
  ctx.stroke(); ctx.restore();
}
function drawShotImpact(shot) {
  if (!shot.impact) return;
  // Persistent, subtle scorch mark. The animated weapon effect is drawn separately.
  ctx.save();
  const mark = ctx.createRadialGradient(shot.impact.x, shot.impact.y + 5, 2, shot.impact.x, shot.impact.y + 5, shot.radius * .34);
  mark.addColorStop(0, 'rgba(16,35,35,.35)'); mark.addColorStop(1, 'rgba(16,35,35,0)');
  ctx.fillStyle = mark; ctx.beginPath(); ctx.ellipse(shot.impact.x, shot.impact.y + 7, shot.radius * .34, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function drawGlow(x, y, radius, inner, outer) {
  const g = ctx.createRadialGradient(x, y, 1, x, y, radius);
  g.addColorStop(0, inner); g.addColorStop(.28, inner); g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
}
function drawSpark(x, y, angle, length, color, alpha = 1) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length); ctx.stroke(); ctx.restore();
}
function drawWeaponProjectile(shot, point, previous, progress) {
  const weapon = shot.weapon || 'standard';
  const dx = point.x - previous.x, dy = point.y - previous.y;
  const angle = Math.atan2(dy, dx);
  const colors = { standard: '#fff2a8', heavy: '#ffca62', cluster: '#c9f9ff', napalm: '#ff693d', terraformer: '#b9f17a', rocket: '#8ef5ff', tidal_surge: '#35dcff', seismic_fissure: '#a9f37a', solar_flare: '#ff8b38', cyclone: '#d4f8ff' };
  const color = colors[weapon] || colors.standard;
  const trailCount = ['rocket','cyclone','tidal_surge'].includes(weapon) ? 13 : weapon === 'napalm' || weapon === 'solar_flare' ? 10 : 7;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // Coloured, tapered trail unique to each projectile.
  ctx.globalAlpha = .34; ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = weapon === 'rocket' ? 19 : 12;
  ctx.lineWidth = weapon === 'heavy' ? 8 : weapon === 'rocket' ? 5 : 4;
  ctx.beginPath();
  const pts = shot.points || [];
  for (let i = Math.max(0, Math.floor(progress * (pts.length - 1)) - trailCount); i <= Math.floor(progress * (pts.length - 1)); i++) {
    const p = pts[i]; if (!p) continue; if (i === Math.max(0, Math.floor(progress * (pts.length - 1)) - trailCount)) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke(); ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  if (weapon === 'tidal_surge') {
    drawGlow(point.x, point.y, 23, 'rgba(222,255,255,.98)', 'rgba(24,177,255,0)');
    ctx.fillStyle = '#4ce8ff'; ctx.strokeStyle = '#e6ffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(point.x, point.y - 11); ctx.bezierCurveTo(point.x + 12, point.y + 1, point.x + 8, point.y + 10, point.x, point.y + 11); ctx.bezierCurveTo(point.x - 10, point.y + 9, point.x - 12, point.y + 1, point.x, point.y - 11); ctx.fill(); ctx.stroke();
    for (let i = 0; i < 4; i++) { const a = progress * 8 + i * Math.PI / 2; drawSpark(point.x + Math.cos(a) * 12, point.y + Math.sin(a) * 8, a, 8, '#a9f7ff', .8); }
    ctx.restore(); return;
  }
  if (weapon === 'seismic_fissure') {
    ctx.translate(point.x, point.y); ctx.rotate(progress * 4);
    ctx.fillStyle = '#9d704b'; ctx.strokeStyle = '#d8ff9c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(10, -3); ctx.lineTo(5, 10); ctx.lineTo(-8, 8); ctx.lineTo(-12, -3); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#f2ffd0'; ctx.beginPath(); ctx.moveTo(-6, -2); ctx.lineTo(0, 3); ctx.lineTo(-2, 8); ctx.stroke(); ctx.restore(); return;
  }
  if (weapon === 'solar_flare') {
    drawGlow(point.x, point.y, 26, 'rgba(255,255,216,.98)', 'rgba(255,79,23,0)');
    ctx.save(); ctx.translate(point.x, point.y); ctx.rotate(progress * 14); ctx.fillStyle = '#fff4a1'; ctx.strokeStyle = '#ff653b'; ctx.lineWidth = 2;
    ctx.beginPath(); for (let i=0;i<16;i++){ const r=i%2?7:14; const a=i*Math.PI/8; const xx=Math.cos(a)*r, yy=Math.sin(a)*r; if(!i)ctx.moveTo(xx,yy);else ctx.lineTo(xx,yy);} ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); ctx.restore(); return;
  }
  if (weapon === 'cyclone') {
    ctx.save(); ctx.translate(point.x, point.y); ctx.rotate(progress * 18);
    for(let i=0;i<3;i++){ ctx.strokeStyle=['#e4ffff','#70e6ff','#b2c7ff'][i]; ctx.lineWidth=3; ctx.beginPath(); ctx.ellipse(0,0,7+i*4,15+i*3,i*.75,0,Math.PI*1.55); ctx.stroke(); }
    drawGlow(0,0,9,'rgba(255,255,255,.9)','rgba(80,190,255,0)'); ctx.restore(); ctx.restore(); return;
  }
  if (weapon === 'rocket') {
    ctx.translate(point.x, point.y); ctx.rotate(angle);
    drawGlow(-13, 0, 17, 'rgba(93,245,255,.9)', 'rgba(31,177,255,0)');
    const flame = ctx.createLinearGradient(-25, 0, -7, 0); flame.addColorStop(0, 'rgba(255,91,47,0)'); flame.addColorStop(.55, '#ff7942'); flame.addColorStop(1, '#fff2a8');
    ctx.fillStyle = flame; ctx.beginPath(); ctx.moveTo(-25, 0); ctx.lineTo(-7, -5); ctx.lineTo(-7, 5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d9fbff'; ctx.strokeStyle = '#267b9b'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(-10, -5); ctx.lineTo(-8, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#64cfe9'; ctx.beginPath(); ctx.moveTo(-7, -3); ctx.lineTo(-14, -10); ctx.lineTo(-12, -2); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(-7, 3); ctx.lineTo(-14, 10); ctx.lineTo(-12, 2); ctx.closePath(); ctx.fill();
    ctx.restore(); return;
  }
  if (weapon === 'napalm') {
    for (let i = 0; i < 4; i++) {
      const a = progress * 24 + i * 2.1;
      ctx.globalAlpha = .5 - i * .08; ctx.fillStyle = i % 2 ? '#ffb33d' : '#ff6239';
      ctx.beginPath(); ctx.ellipse(point.x - Math.cos(angle) * (i * 8 + 5), point.y - Math.sin(angle) * (i * 8 + 5), 4 + i, 3 + i * .5, a, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1; drawGlow(point.x, point.y, 15, '#fff3a1', 'rgba(255,74,38,0)');
    ctx.fillStyle = '#fff4bc'; ctx.beginPath(); ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return;
  }
  if (weapon === 'terraformer') {
    ctx.translate(point.x, point.y); ctx.rotate(progress * 9);
    ctx.fillStyle = '#7b4b31'; ctx.strokeStyle = '#e2c17d'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(10, -2); ctx.lineTo(6, 8); ctx.lineTo(-5, 9); ctx.lineTo(-10, -1); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(197,255,130,.75)'; ctx.beginPath(); ctx.arc(-3, -3, 2, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return;
  }
  if (weapon === 'heavy') {
    drawGlow(point.x, point.y, 20, 'rgba(255,220,130,.9)', 'rgba(255,111,40,0)');
    ctx.translate(point.x, point.y); ctx.rotate(progress * 8);
    ctx.fillStyle = '#6d4938'; ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,246,194,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 4, -.5, 2.6); ctx.stroke(); ctx.restore(); return;
  }
  if (weapon === 'cluster') {
    if (progress > .72) {
      const split = (progress - .72) / .28;
      for (let i = 0; i < 3; i++) {
        const offset = (i - 1) * 11 * split;
        const x = point.x + offset, y = point.y + (i - 1) * 10 * split;
        drawGlow(x, y, 11, 'rgba(216,255,255,.95)', 'rgba(50,190,255,0)');
        ctx.fillStyle = ['#b8ffef', '#fff0a3', '#c5c3ff'][i]; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore(); return;
    }
  }
  // Standard shell or the unsplit cluster core.
  drawGlow(point.x, point.y, weapon === 'standard' ? 17 : 14, 'rgba(255,255,225,.98)', `${color}00`);
  ctx.fillStyle = weapon === 'standard' ? '#fff8cf' : '#c9f8ff'; ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(point.x, point.y, weapon === 'standard' ? 5 : 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
}
function drawWeaponImpact(shot, progress) {
  const x = shot.impact.x, y = shot.impact.y;
  const fade = Math.max(0, 1 - progress);
  const radius = Math.max(5, shot.radius || 70);
  ctx.save(); ctx.globalAlpha = fade;
  if (shot.weapon === 'tidal_surge') {
    drawGlow(x, y + 8, radius * (1 + progress * .15), 'rgba(194,250,255,.8)', 'rgba(18,171,255,0)');
    for(let i=0;i<4;i++) { const r=radius*(.18+progress*.92)+i*7; ctx.strokeStyle=`rgba(90,239,255,${.8-i*.13})`; ctx.lineWidth=4-i*.5; ctx.beginPath(); ctx.ellipse(x,y+7,r,12+progress*9,i*.12,Math.PI,Math.PI*2); ctx.stroke(); }
    for(let i=0;i<14;i++){ const a=i*Math.PI*2/14, d=progress*radius*.8; drawSpark(x+Math.cos(a)*d,y+Math.sin(a)*d,a-Math.PI/2,12*(1-progress)+3,'#bafaff',fade); }
  } else if (shot.weapon === 'seismic_fissure') {
    drawGlow(x,y,radius*.9,'rgba(224,255,173,.65)','rgba(114,82,46,0)');
    ctx.strokeStyle='#352f29'; ctx.lineWidth=5; ctx.lineCap='round';
    for(let j=-2;j<=2;j++){ const sx=x+j*26, reach=progress*(48+Math.abs(j)*12); ctx.beginPath(); ctx.moveTo(sx-reach,y+5); ctx.lineTo(sx-reach*.35,y+15); ctx.lineTo(sx+reach*.1,y+23); ctx.lineTo(sx+reach*.55,y+13); ctx.lineTo(sx+reach,y+27); ctx.stroke(); }
    for(let i=0;i<18;i++){const a=i*Math.PI*2/18,d=progress*radius*.78;drawSpark(x+Math.cos(a)*d,y+Math.sin(a)*d,a,9*fade+2,'#baff83',fade);}
  } else if (shot.weapon === 'solar_flare') {
    drawGlow(x,y,radius*1.2,'rgba(255,255,220,.98)','rgba(255,66,24,0)');
    ctx.strokeStyle='#fff0a5';ctx.lineWidth=5*(1-progress)+1;ctx.shadowColor='#ff7137';ctx.shadowBlur=22;
    for(let i=0;i<20;i++){const a=i*Math.PI*2/20+progress*.15;const r1=radius*(.12+progress*.18),r2=radius*(.35+progress*.72);ctx.beginPath();ctx.moveTo(x+Math.cos(a)*r1,y+Math.sin(a)*r1);ctx.lineTo(x+Math.cos(a)*r2,y+Math.sin(a)*r2);ctx.stroke();}
    ctx.shadowBlur=0;
  } else if (shot.weapon === 'cyclone') {
    drawGlow(x,y,radius,'rgba(239,255,255,.88)','rgba(66,167,255,0)');
    ctx.strokeStyle='#d9fbff';ctx.lineWidth=4;ctx.shadowColor='#68dfff';ctx.shadowBlur=16;
    for(let i=0;i<4;i++){ctx.beginPath();ctx.ellipse(x,y,16+progress*radius*(.45+i*.12),9+progress*radius*(.2+i*.06),progress*4+i*.7,0,Math.PI*1.7);ctx.stroke();}
    for(let i=0;i<12;i++){const a=i*Math.PI*2/12+progress*3,d=progress*radius*.8;drawSpark(x+Math.cos(a)*d,y+Math.sin(a)*d,a+Math.PI/2,12*fade+2,'#c8f8ff',fade);}
    ctx.shadowBlur=0;
  } else if (shot.weapon === 'heavy') {
    drawGlow(x, y, radius * (1.05 + progress * .32), 'rgba(255,244,190,.95)', 'rgba(255,76,25,0)');
    ctx.strokeStyle = '#ffe39a'; ctx.lineWidth = 7 * (1 - progress) + 1; ctx.shadowColor = '#ff9d42'; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.arc(x, y, radius * (0.18 + progress * 1.03), 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 18; i++) { const a = i * Math.PI * 2 / 18 + .2, d = radius * (.22 + progress * .72); drawSpark(x + Math.cos(a) * d, y + Math.sin(a) * d, a, 17 * (1 - progress) + 4, '#ffda78', fade); }
  } else if (shot.weapon === 'cluster') {
    for (let i = 0; i < 3; i++) {
      const cx = x + (i - 1) * 34, cy = y + (i === 1 ? -7 : 5);
      drawGlow(cx, cy, 38 * (1 + progress * .4), 'rgba(225,255,255,.94)', 'rgba(65,170,255,0)');
      ctx.strokeStyle = ['#baffee', '#ffe99c', '#d6c7ff'][i]; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, 8 + progress * 30, 0, Math.PI * 2); ctx.stroke();
    }
  } else if (shot.weapon === 'napalm') {
    drawGlow(x, y + 5, radius * .9, 'rgba(255,207,91,.8)', 'rgba(255,65,29,0)');
    for (let i = 0; i < 11; i++) {
      const px = x + Math.sin(i * 2.4) * (18 + progress * 42), py = y + 10 + Math.cos(i * 1.7) * 7;
      const flicker = .65 + Math.sin(progress * 28 + i * 2) * .2;
      ctx.fillStyle = i % 2 ? `rgba(255,93,37,${flicker})` : `rgba(255,210,91,${flicker})`;
      ctx.beginPath(); ctx.ellipse(px, py - progress * (12 + (i % 4) * 4), 5 + (i % 3) * 2, 11 + (i % 4) * 2, Math.sin(i) * .35, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,202,92,.8)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(x, y + 12, radius * (.24 + progress * .6), 8 + progress * 8, 0, 0, Math.PI * 2); ctx.stroke();
  } else if (shot.weapon === 'terraformer') {
    drawGlow(x, y + 8, radius * (1 + progress * .2), 'rgba(216,255,136,.54)', 'rgba(105,91,54,0)');
    ctx.fillStyle = `rgba(123,81,47,${.46 * fade})`; ctx.beginPath(); ctx.ellipse(x, y + 12, radius * (.2 + progress * .8), 9 + progress * 18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(208,255,146,.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 10 + progress * radius, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 14; i++) { const a = i * Math.PI * 2 / 14, d = progress * radius * .9; const sx = x + Math.cos(a) * d, sy = y + Math.sin(a) * d; ctx.fillStyle = i % 2 ? '#9b7048' : '#d5ba7d'; ctx.save(); ctx.translate(sx, sy); ctx.rotate(a + progress * 5); ctx.fillRect(-3, -3, 7, 6); ctx.restore(); }
  } else if (shot.weapon === 'rocket') {
    drawGlow(x, y, radius * 1.25, 'rgba(238,255,255,.98)', 'rgba(31,177,255,0)');
    ctx.strokeStyle = '#c9faff'; ctx.lineWidth = 4; ctx.shadowColor = '#55e9ff'; ctx.shadowBlur = 20;
    for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; ctx.beginPath(); ctx.arc(x, y, 12 + progress * (radius * .8), a, a + 1.25); ctx.stroke(); }
    for (let i = 0; i < 16; i++) { const a = i * Math.PI * 2 / 16; drawSpark(x + Math.cos(a) * progress * radius, y + Math.sin(a) * progress * radius, a, 12 * fade + 2, '#8df5ff', fade); }
  } else {
    drawGlow(x, y, radius * (1 + progress * .32), 'rgba(255,249,198,.98)', 'rgba(255,80,44,0)');
    ctx.strokeStyle = '#fff0a3'; ctx.lineWidth = 4 * fade + 1; ctx.shadowColor = '#ffae53'; ctx.shadowBlur = 15;
    ctx.beginPath(); ctx.arc(x, y, 9 + progress * radius * .8, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 12; i++) { const a = i * Math.PI * 2 / 12; drawSpark(x + Math.cos(a) * progress * radius * .7, y + Math.sin(a) * progress * radius * .7, a, 10 * fade + 2, '#ffe8a0', fade); }
  }
  ctx.restore();
}

function roundedRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function shadeColor(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (num & 255) + amount));
  return `rgb(${r},${g},${b})`;
}
function startShotAnimation(shot) {
  const started = performance.now();
  const flightDuration = 1350;
  const impactDuration = ['napalm','solar_flare'].includes(shot.weapon) ? 1250 : 950;
  const breakDuration = (shot.hits || []).some(hit => hit.eliminated) ? 1100 : 0;
  const statusDuration = (shot.tankEffects || []).length ? (shot.statusDuration || 2600) : 0;
  const totalDuration = flightDuration + impactDuration + Math.max(breakDuration, statusDuration);
  activeShotFx = { shot, started, flightDuration, impactDuration, breakDuration, statusDuration, totalDuration };
  if (shotAnimation) cancelAnimationFrame(shotAnimation);
  renderGame(); // Lock the next player's controls until the flight, impact and elemental reaction finish.
  const points = shot.points && shot.points.length ? shot.points : [shot.impact];
  const animate = now => {
    if (!roomState || !activeShotFx) { shotAnimation = null; return; }
    const elapsed = now - started;
    drawArena();
    if (elapsed < flightDuration) {
      const t = Math.max(0, Math.min(1, elapsed / flightDuration));
      const index = Math.min(points.length - 1, Math.floor(t * Math.max(1, points.length - 1)));
      const pt = points[index] || shot.impact;
      const previous = points[Math.max(0, index - 2)] || points[0] || pt;
      drawWeaponProjectile(shot, pt, previous, t);
    } else if (elapsed < flightDuration + impactDuration) {
      const impactT = Math.min(1, (elapsed - flightDuration) / impactDuration);
      drawWeaponImpact(shot, impactT);
    }
    if (elapsed < totalDuration) shotAnimation = requestAnimationFrame(animate);
    else {
      activeShotFx = null; shotAnimation = null;
      renderGame();
      if (roomState.phase === 'finished') showResult();
    }
  };
  shotAnimation = requestAnimationFrame(animate);
}

function showResult() {
  const winner = roomState.players.find(p => p.id === roomState.winnerId);
  $('winner-title').textContent = winner ? `${winner.name.toUpperCase()} WINS!` : 'DRAW GAME';
  $('winner-copy').textContent = winner ? 'A legendary shot. A legendary finish.' : 'The battlefield had other plans.';
  $('final-score').innerHTML = '';
  [...roomState.players].sort((a, b) => b.score - a.score).forEach((p, i) => {
    const row = document.createElement('div'); row.className = 'final-score-row';
    const name = document.createElement('span'); name.textContent = `${i + 1}. ${p.name}`;
    const score = document.createElement('b'); score.textContent = `${p.score} PTS`;
    row.append(name, score); $('final-score').appendChild(row);
  });
  $('match-result').classList.remove('hidden');
}

function renderWeaponTip() {
  $('fire-tip-text').textContent = WEAPON_TIPS[selectedWeapon] || WEAPON_TIPS.standard;
}
function renderTutorial() {
  const step = TUTORIAL_STEPS[tutorialStep];
  $('tutorial-step-label').textContent = `STEP ${String(tutorialStep + 1).padStart(2, '0')} / ${String(TUTORIAL_STEPS.length).padStart(2, '0')}`;
  $('tutorial-title').textContent = step.title;
  $('tutorial-description').textContent = step.body;
  $('tutorial-tip').textContent = step.tip;
  $('tutorial-visual').dataset.kind = step.kind;
  $('tutorial-visual').querySelector('strong').textContent = step.icon;
  $('tutorial-progress').innerHTML = TUTORIAL_STEPS.map((_, i) => `<i class="${i <= tutorialStep ? 'active' : ''}"></i>`).join('');
  $('tutorial-back').disabled = tutorialStep === 0;
  $('tutorial-next').querySelector('span:first-child').textContent = tutorialStep === TUTORIAL_STEPS.length - 1 ? 'LET’S PLAY' : 'NEXT';
  $('tutorial-next').querySelector('span:last-child').textContent = tutorialStep === TUTORIAL_STEPS.length - 1 ? '↗' : '→';
}
function openTutorial() {
  tutorialStep = 0;
  renderTutorial();
  $('tutorial-overlay').classList.remove('hidden');
  $('tutorial-overlay').setAttribute('aria-hidden', 'false');
  document.body.classList.add('tutorial-open');
  $('tutorial-next').focus();
}
function closeTutorial() {
  $('tutorial-overlay').classList.add('hidden');
  $('tutorial-overlay').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('tutorial-open');
  storageSet('ptp-tutorial-seen', '1');
}
function advanceTutorial(direction) {
  const next = tutorialStep + direction;
  if (next < 0) return;
  if (next >= TUTORIAL_STEPS.length) return closeTutorial();
  tutorialStep = next;
  renderTutorial();
}

const GUIDE_STEPS = [
  { selector: '#angle-control', title: 'Cannon angle', body: 'Drag this slider to change the barrel angle. Lower angles make flatter shots; higher angles create taller arcs.', hint: 'Try 35° for a flatter shot or 60° to clear a hill.' },
  { selector: '#power-control', title: 'Firing power', body: 'Drag this slider to control launch strength. More power sends the shell farther; less power helps with nearby targets.', hint: 'Use the dotted arc in the arena as a rough trajectory preview.' },
  { selector: '#movement-control', title: 'Move your tank', body: 'Use the left and right arrow buttons, or keyboard ← / → (A / D). You get three small moves each turn before you fire.', hint: 'Movement is optional and does not spend your shot. Other tanks and the battlefield edge block your path.' },
  { selector: '#weapon-control', title: 'Choose a weapon', body: 'Select one of the six shared weapons or your own element signature weapon. Other nations’ signature weapons are hidden, so the arsenal only shows choices you can use.', hint: 'Water: Tidal Surge · Earth: Seismic Fissure · Fire: Solar Flare · Air: Cyclone. Your element emblem appears on your tank.' },
  { selector: '#fire-button', title: 'Fire your shot', body: 'When the controls are ready, press FIRE. Your shell travels, changes the terrain, applies damage, and then the turn passes to the next player.', hint: 'You can still move and adjust your aim until you fire.' }
];
function renderGuide() {
  const step = GUIDE_STEPS[guideStep];
  document.querySelectorAll('.guided-control').forEach(el => el.classList.remove('guided-control'));
  const target = document.querySelector(step.selector);
  if (target) { target.classList.add('guided-control'); target.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  $('guide-step-label').textContent = `CONTROL TOUR · ${String(guideStep + 1).padStart(2, '0')} / ${String(GUIDE_STEPS.length).padStart(2, '0')}`;
  $('guide-title').textContent = step.title;
  $('guide-description').textContent = step.body;
  $('guide-hint').textContent = step.hint;
  $('guide-back').disabled = guideStep === 0;
  $('guide-next').querySelector('span:first-child').textContent = guideStep === GUIDE_STEPS.length - 1 ? 'GOT IT' : 'NEXT';
  $('guide-next').querySelector('span:last-child').textContent = guideStep === GUIDE_STEPS.length - 1 ? '✓' : '→';
}
function openPlayGuide() {
  guideStep = 0; renderGuide();
  $('play-guide').classList.remove('hidden');
  $('play-guide').setAttribute('aria-hidden', 'false');
}
function closePlayGuide() {
  $('play-guide').classList.add('hidden');
  $('play-guide').setAttribute('aria-hidden', 'true');
  document.querySelectorAll('.guided-control').forEach(el => el.classList.remove('guided-control'));
}
function advanceGuide(direction) {
  const next = guideStep + direction;
  if (next < 0) return;
  if (next >= GUIDE_STEPS.length) return closePlayGuide();
  guideStep = next; renderGuide();
}

// Lobby controls.
document.querySelectorAll('.element-choice').forEach(button => {
  button.addEventListener('click', () => {
    selectedElement = button.dataset.element;
    document.querySelectorAll('.element-choice').forEach(b => b.classList.toggle('selected', b === button));
  });
});
$('create-room').addEventListener('click', createRoom);
$('join-room').addEventListener('click', joinRoom);
$('room-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
$('room-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
$('start-match').addEventListener('click', () => send({ type: 'action', action: 'start' }));
function openSurrenderConfirm() {
  $('surrender-confirm').classList.remove('hidden');
  $('surrender-confirm').setAttribute('aria-hidden', 'false');
  $('cancel-surrender').focus();
}
function closeSurrenderConfirm() {
  $('surrender-confirm').classList.add('hidden');
  $('surrender-confirm').setAttribute('aria-hidden', 'true');
}
$('game-surrender').addEventListener('click', openSurrenderConfirm);
$('cancel-surrender').addEventListener('click', closeSurrenderConfirm);
$('confirm-surrender').addEventListener('click', () => {
  closeSurrenderConfirm();
  send({ type: 'action', action: 'surrender' });
});
$('surrender-confirm').addEventListener('click', event => { if (event.target === $('surrender-confirm')) closeSurrenderConfirm(); });
$('leave-lobby').addEventListener('click', () => {
  if (socket && socket.readyState === WebSocket.OPEN && playerId) send({ type: 'action', action: 'leave' });
  storageRemove('ptp-player'); storageRemove('ptp-room');
  try { sessionStorage.removeItem('ptp-player'); sessionStorage.removeItem('ptp-room'); } catch { /* Storage may be unavailable. */ }
  roomState = null; playerId = null; setScreen('lobby-screen');
  $('rejoin-room').classList.add('hidden');
  if (socket?.readyState === WebSocket.OPEN) send({ type: 'list_rooms' });
});
$('refresh-rooms').addEventListener('click', () => send({ type: 'list_rooms' }));
$('move-left').addEventListener('click', () => send({ type: 'action', action: 'move', direction: -1 }));
$('move-right').addEventListener('click', () => send({ type: 'action', action: 'move', direction: 1 }));
$('copy-code').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(roomState.code); $('copy-code').textContent = 'COPIED ✓'; setTimeout(() => $('copy-code').textContent = 'COPY ↗', 1600); }
  catch { $('copy-code').textContent = roomState.code; }
});
function handleAimSliderInput() {
  localAim.angle = Number($('angle').value);
  localAim.power = Number($('power').value);
  $('angle-value').textContent = String(localAim.angle);
  $('power-value').textContent = String(localAim.power);
  drawArena();
}
function commitAimSettings() {
  if (!roomState || roomState.phase !== 'playing' || roomState.turnPlayerId !== playerId) return;
  send({ type: 'action', action: 'aim', angle: localAim.angle, power: localAim.power, weapon: selectedWeapon });
}
['angle', 'power'].forEach(id => {
  const slider = $(id);
  slider.addEventListener('input', handleAimSliderInput);
  slider.addEventListener('change', commitAimSettings);
  slider.addEventListener('pointerup', commitAimSettings);
  slider.addEventListener('keyup', commitAimSettings);
});
$('weapon-list').addEventListener('click', event => {
  const button = event.target.closest('.weapon-choice');
  if (!button || button.disabled) return;
  selectedWeapon = button.dataset.weapon;
  $('weapon-list').querySelectorAll('.weapon-choice').forEach(b => b.classList.toggle('selected', b === button));
  renderWeaponTip(); drawArena(); commitAimSettings();
});
$('open-tutorial').addEventListener('click', openTutorial);
$('tutorial-close').addEventListener('click', closeTutorial);
$('tutorial-skip').addEventListener('click', closeTutorial);
$('tutorial-back').addEventListener('click', () => advanceTutorial(-1));
$('tutorial-next').addEventListener('click', () => advanceTutorial(1));
$('open-play-guide').addEventListener('click', openPlayGuide);
$('guide-close').addEventListener('click', closePlayGuide);
$('guide-back').addEventListener('click', () => advanceGuide(-1));
$('guide-next').addEventListener('click', () => advanceGuide(1));
document.addEventListener('keydown', event => {
  const tag = document.activeElement?.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
  if (!$('surrender-confirm').classList.contains('hidden')) {
    if (event.key === 'Escape') closeSurrenderConfirm();
    return;
  }
  if (!$('tutorial-overlay').classList.contains('hidden')) {
    if (event.key === 'Escape') closeTutorial();
    if (event.key === 'ArrowRight') advanceTutorial(1);
    if (event.key === 'ArrowLeft') advanceTutorial(-1);
    return;
  }
  if (!$('play-guide').classList.contains('hidden')) {
    if (event.key === 'Escape') closePlayGuide();
    if (event.key === 'ArrowRight') advanceGuide(1);
    if (event.key === 'ArrowLeft') advanceGuide(-1);
    return;
  }
  if (typing || !roomState || roomState.phase !== 'playing') return;
  const me = roomState.players.find(p => p.id === playerId);
  if (!me || !me.alive || roomState.turnPlayerId !== playerId) return;
  if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') { event.preventDefault(); send({ type: 'action', action: 'move', direction: -1 }); }
  if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') { event.preventDefault(); send({ type: 'action', action: 'move', direction: 1 }); }
});
renderWeaponTip();
if (!storageGet('ptp-tutorial-seen')) setTimeout(openTutorial, 450);
$('fire-button').addEventListener('click', () => {
  if ($('fire-button').disabled) return;
  $('fire-button').disabled = true;
  send({ type: 'action', action: 'fire', angle: localAim.angle, power: localAim.power, weapon: selectedWeapon });
});
$('back-to-lobby').addEventListener('click', () => {
  setScreen('room-screen');
  if (roomState) renderPlayers();
});

try {
  if (!storageGet('ptp-player') && sessionStorage.getItem('ptp-player')) storageSet('ptp-player', sessionStorage.getItem('ptp-player'));
  if (!storageGet('ptp-room') && sessionStorage.getItem('ptp-room')) storageSet('ptp-room', sessionStorage.getItem('ptp-room'));
} catch { /* Storage may be unavailable in private browsing. */ }
if (storageGet('ptp-player') && storageGet('ptp-room')) $('rejoin-room').classList.remove('hidden');
$('rejoin-room').addEventListener('click', () => {
  if (connected) send({ type: 'resume_room', playerId: storageGet('ptp-player'), code: storageGet('ptp-room') });
  else setError('Reconnecting to your saved room…');
});
connect();
