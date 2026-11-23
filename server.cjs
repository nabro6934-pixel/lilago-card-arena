const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { resolveRound, starter } = require('./engine.cjs');

const allowedOrigin = process.env.FRONTEND_ORIGIN || 'https://lilago-card-arena.onrender.com';
const dataPath = process.env.DATA_FILE || path.join(__dirname, 'arena-data.json');
const deadlineMs = 60_000;
const rooms = new Map();
const queue = new Map();
const registrations = new Map();
const state = fs.existsSync(dataPath)
  ? JSON.parse(fs.readFileSync(dataPath, 'utf8'))
  : { players: {}, requests: [] };
const hash = token => crypto.createHash('sha256').update(token).digest('hex');
const publicPlayer = ({ id, name, icon, frame, wins, losses, rating }) => ({ id, name, icon, frame, wins, losses, rating });
const error = (status, message) => Object.assign(new Error(message), { status });

function persist() {
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  fs.writeFileSync(dataPath + '.tmp', JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(dataPath + '.tmp', dataPath);
}

function finish(room, winner) {
  room.winner = winner;
  room.ended = Date.now();
  room.deadline = null;
  if (winner === -1) return;
  const won = state.players[room.ids[winner]];
  const lost = state.players[room.ids[1 - winner]];
  const delta = Math.max(8, Math.round(27 / (1 + Math.pow(10, (won.rating - lost.rating) / 400))));
  won.wins++;
  lost.losses++;
  won.rating += delta;
  lost.rating = Math.max(0, lost.rating - delta);
  persist();
}

function activeRoom(id) {
  return [...rooms.values()].find(room => room.ids.includes(id) && room.winner === null);
}

function view(room, id) {
  if (!room) return null;
  const side = room.ids.indexOf(id);
  return {
    id: room.id, side, turn: room.turn, deadline: room.deadline,
    opponent: publicPlayer(state.players[room.ids[1 - side]]),
    hands: room.hands[side], teams: room.teams,
    submitted: !!room.moves[side], winner: room.winner, last: room.last
  };
}

function clean() {
  const now = Date.now();
  for (const [id, expires] of queue) if (expires < now) queue.delete(id);
  for (const [id, expires] of registrations) if (expires < now) registrations.delete(id);
  for (const room of rooms.values()) {
    if (room.ended && now - room.ended > 300_000) rooms.delete(room.id);
    else if (room.winner === null && now > room.deadline) {
      const winner = room.moves[0] ? 0 : room.moves[1] ? 1 : -1;
      finish(room, winner);
    }
  }
}
setInterval(clean, 2000).unref();

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size <= 4096) chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > 4096) return reject(error(413, '입력값이 너무 길어.'));
      try { resolve(size ? JSON.parse(Buffer.concat(chunks)) : {}); }
      catch { reject(error(400, '요청 형식을 확인해줘.')); }
    });
    req.on('error', reject);
  });
}
function text(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}
function playerFor(req) {
  const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) throw error(401, '온라인 프로필 연결이 필요해.');
  const key = hash(token);
  const player = Object.values(state.players).find(p => p.key === key);
  if (!player) throw error(401, '온라인 프로필을 다시 연결해줘.');
  return player;
}

const handlers = new Map([
  ['POST /profile/new', (req, body) => {
    const name = text(body.name, 20);
    if (!name || /[\x00-\x1f]/.test(name)) throw error(400, '닉네임을 입력해줘.');
    const origin = req.socket.remoteAddress;
    if (registrations.has(origin)) throw error(429, '잠시 뒤 다시 시도해줘.');
    registrations.set(origin, Date.now() + 4000);
    const token = crypto.randomBytes(32).toString('hex');
    const id = crypto.randomBytes(4).toString('hex').toUpperCase();
    const player = { id, key: hash(token), name, frame: 'mint', icon: 0, wins: 0, losses: 0, rating: 1000, friends: [] };
    state.players[id] = player;
    persist();
    return { token, player: publicPlayer(player) };
  }],
  ['POST /profile', (req, body, p) => {
    const name = text(body.name, 20);
    if (!name || !['mint','violet','amber'].includes(body.frame) || !Number.isInteger(body.icon) || body.icon < 0 || body.icon > 5) {
      throw error(400, '프로필 설정을 확인해줘.');
    }
    Object.assign(p, { name, frame: body.frame, icon: body.icon });
    persist();
    return publicPlayer(p);
  }],
  ['GET /profile', (req, body, p) => publicPlayer(p)],
  ['GET /leaderboard', () => Object.values(state.players)
    .map(publicPlayer).sort((a,b) => b.rating - a.rating || b.wins - a.wins || a.id.localeCompare(b.id)).slice(0,50)],
  ['GET /friends', (req, body, p) => p.friends.map(id => publicPlayer(state.players[id]))],
  ['POST /friends', (req, body, p) => {
    const id = text(body.id, 8).toUpperCase();
    if (!state.players[id] || id === p.id) throw error(404, '친구 코드를 확인해줘.');
    if (!p.friends.includes(id)) {
      if (p.friends.length >= 100) throw error(409, '친구 목록이 가득 찼어.');
      p.friends.push(id);
      persist();
    }
    return p.friends.map(id => publicPlayer(state.players[id]));
  }],
  ['POST /requests', (req, body, p) => {
    const name = text(body.name, 60), idea = text(body.idea, 400);
    if (!name || !idea) throw error(400, '카드 이름과 아이디어를 입력해줘.');
    if (state.requests.filter(r => r.player === p.id).length >= 20) throw error(409, '요청은 프로필당 20개까지 보낼 수 있어.');
    state.requests.push({ player: p.id, name, idea, date: Date.now() });
    persist();
    return { ok: true };
  }],
  ['GET /requests', (req, body, p) => state.requests.filter(r => r.player === p.id).reverse()],
  ['POST /queue', (req, body, p) => {
    clean();
    const active = activeRoom(p.id);
    if (active) return { room: view(active, p.id), queued: false };
    const rival = [...queue.keys()].find(id => id !== p.id && !activeRoom(id));
    if (!rival) { queue.set(p.id, Date.now() + 120_000); return { queued: true }; }
    queue.delete(p.id);
    queue.delete(rival);
    const room = { id: crypto.randomUUID(), ids: [rival,p.id], teams: [[],[]], hands: [[...starter],[...starter]], moves: [null,null], turn: 1, deadline: Date.now() + deadlineMs, winner: null, last: null };
    rooms.set(room.id, room);
    return { room: view(room,p.id), queued: false };
  }],
  ['DELETE /queue', (req, body, p) => { queue.delete(p.id); return { ok:true }; }],
  ['GET /queue', (req, body, p) => ({ queued: queue.has(p.id), room: view(activeRoom(p.id),p.id) })],
  ['GET /match', (req, body, p, url) => {
    clean();
    const room = rooms.get(url.searchParams.get('id'));
    if (!room || !room.ids.includes(p.id)) throw error(404, '대전을 찾을 수 없어.');
    return view(room,p.id);
  }],
  ['POST /match', (req, body, p) => {
    clean();
    const room = rooms.get(body.id);
    if (!room || !room.ids.includes(p.id)) throw error(404, '대전을 찾을 수 없어.');
    const side = room.ids.indexOf(p.id);
    if (room.winner !== null || room.turn !== body.turn || room.moves[side]) return view(room,p.id);
    if (!room.hands[side].includes(body.card) || ![0,1,2].includes(body.lane)) throw error(400, '낼 카드와 구역을 확인해줘.');
    room.moves[side] = { id: body.card, lane: body.lane };
    if (room.moves.every(Boolean)) {
      room.last = resolveRound(room);
      room.moves = [null,null];
      if (room.turn === 5) finish(room,room.last.winner);
      else { room.turn++;room.deadline=Date.now()+deadlineMs; }
    }
    return view(room,p.id);
  }]
]);

http.createServer(async (req,res) => {
  const origin=req.headers.origin;
  if (origin === allowedOrigin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');
  res.setHeader('Cache-Control','no-store');
  if (req.method==='OPTIONS') {res.writeHead(204);res.end();return;}
  res.setHeader('Content-Type','application/json; charset=utf-8');
  try {
    const url=new URL(req.url,'http://localhost');
    if (url.pathname==='/health') {res.end('{"ok":true}');return;}
    const key=req.method+' '+url.pathname;
    const handler=handlers.get(key);
    if (!handler) throw error(404,'지원하지 않는 경로야.');
    if (origin && origin!==allowedOrigin) throw error(403,'허용되지 않은 게임 주소야.');
    const player=key==='POST /profile/new'||key==='GET /leaderboard'?null:playerFor(req);
    const body=req.method==='POST'?await readBody(req):{};
    if (!body || typeof body!=='object' || Array.isArray(body)) throw error(400,'요청 형식을 확인해줘.');
    res.end(JSON.stringify(handler(req,body,player,url)));
  } catch (e) {
    if(!e.status)console.error(e);
    res.writeHead(e.status||500);
    res.end(JSON.stringify({error:e.status?e.message:'서버에서 요청을 처리하지 못했어.'}));
  }
}).listen(Number(process.env.PORT)||3000);
