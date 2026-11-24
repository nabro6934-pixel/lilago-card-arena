const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { resolveRound, starter, cards } = require('./engine.cjs');

const allowedOrigin = process.env.FRONTEND_ORIGIN || 'https://lilago-card-arena.onrender.com';
const dataPath = process.env.DATA_FILE || path.join(__dirname, 'arena-data-unified.json');
const deadlineMs = 20_000;
const rooms = new Map();
const queue = new Map();
const registrations = new Map();
let state;
let database;
let pendingSave = Promise.resolve();
const ownerId = (process.env.CARD_OWNER_ID || '').replace(/^#/, '').toUpperCase();
const developerBuild = process.env.CARD_DEVELOPER_BUILD;
const developerTickets = new Map();
const canOpenDeveloperBuild = p => Boolean(ownerId && p.id===ownerId);

// Build the isolated developer game from the current production frontend.
const developerEdits = [["function storeMusic(){try{localStorage.setItem('lilago-music-settings',JSON.stringify({on:musicOn,track:trackIndex,volume:musicVolume}));}catch{}}\n", "function storeMusic(){try{localStorage.setItem('lilago-dev-music-settings',JSON.stringify({on:musicOn,track:trackIndex,volume:musicVolume}));}catch{}}\n"], ["  const settings=JSON.parse(localStorage.getItem('lilago-music-settings')||'{}');\n", "  const settings=JSON.parse(localStorage.getItem('lilago-dev-music-settings')||'{}');\n"], ["      try{localStorage.setItem('lilago-online-token',token);}catch{}\n", "      try{localStorage.setItem('lilago-dev-online-token',token);}catch{}\n"], ["    token='';onlineProfile=null;updateHeader();\n    try{localStorage.removeItem('lilago-online-token');}catch{}\n", "    token='';onlineProfile=null;\n    try{localStorage.removeItem('lilago-dev-online-token');}catch{}\n"], ["try{token=localStorage.getItem('lilago-online-token')||'';}catch{}\n", "try{token=localStorage.getItem('lilago-dev-online-token')||'';}catch{}\n"], ["const onlineBase = 'https://lilago-card-arena-market-api.onrender.com';\n", "const onlineBase = '';\n"], ["  if(b.id==='audio-toggle'){soundOn=!soundOn;try{localStorage.setItem('lilago-card-audio',soundOn?'on':'off');}catch{}updateHeader();if(soundOn)playSound('deploy');}\n", "  if(b.id==='audio-toggle'){soundOn=!soundOn;try{localStorage.setItem('lilago-dev-card-audio',soundOn?'on':'off');}catch{}updateHeader();if(soundOn)playSound('deploy');}\n"], ["      try{localStorage.setItem('lilago-featured-card',JSON.stringify({card:featuredId,copy:featuredCopy}));}catch{}\n", "      try{localStorage.setItem('lilago-dev-featured-card',JSON.stringify({card:featuredId,copy:featuredCopy}));}catch{}\n"], ["  if(b.id==='developer-tab'){void openDeveloperBuild(b);return;}\n", ""], ["async function openDeveloperBuild(button){\n  if(onlineProfile?.canOpenDeveloperBuild!==true)return;\n  const page=window.open('about:blank','_blank');\n  if(!page){button.title='브라우저에서 새 탭 열기를 허용해 줘.';return;}\n  page.opener=null;\n  page.document.body.textContent='개발자 서버에 연결 중…';\n  button.disabled=true;\n  try{\n    const {ticket}=await onlineFetch('/developer/ticket','POST');\n    const url=new URL('/developer/play',onlineBase);\n    url.searchParams.set('ticket',ticket);\n    page.location.replace(url.href);\n  }catch(error){\n    if(!page.closed)page.document.body.textContent=error.message;\n  }finally{button.disabled=false;}\n}\n", ""], ["    <div class=\"home-play\"><label>대전 모드<select id=\"home-mode\" aria-label=\"대전 모드\"><option value=\"ai\" ${homeMode==='ai'?'selected':''}>연습 대전</option><option value=\"online\" ${homeMode==='online'?'selected':''}>온라인 1대1</option></select></label><button id=\"play-selected\" ${queued||queueStarting?'disabled':''}>${queueStarting?'연결 중…':'플레이 ▸'}</button></div>\n", "    <div class=\"home-play\"><label>대전 모드<select id=\"home-mode\" aria-label=\"대전 모드\"><option value=\"ai\" ${homeMode==='ai'?'selected':''}>연습 대전</option></select></label><button id=\"play-selected\" ${queued||queueStarting?'disabled':''}>${queueStarting?'연결 중…':'플레이 ▸'}</button></div>\n"], ["function ownsCard(id){return cardCopies(id).length>0;}\n", "function ownsCard(id){return !retiredCards.has(id)&&profile.owned.includes(id);}\n"], ["  const issued=onlineProfile?.inventory.filter(u=>u.card===id)||[];\n  const localCopies=onlineProfile?.starters?(onlineProfile.starters.includes(id)?1:0):profile.copies?.[id]||(profile.owned.includes(id)?1:0);\n  return [...Array.from({length:localCopies},(_,i)=>({id:\"basic-\"+i})),...issued];\n", "  const copies=starter.includes(id)?[{id:'basic-0'}]:[];\n  for(const variant of [null,...devEditions.map(([name])=>name)]){\n    const count=profile.copies?.[devEditionKey(id,variant)]??0;\n    for(let serial=1;serial<=count;serial++)copies.push({id:variant?'dev-'+variant+'-'+serial:'dev-'+serial,card:id,serial,variant});\n  }\n  return copies;\n"], ["    return {id,duplicate};\n", "    return {id,duplicate,serial,variant};\n"], ["    profile.copies??={};profile.copies[id]=(profile.copies[id]||(duplicate?1:0))+1;\n", "    profile.copies??={};const key=devEditionKey(id,variant);\n    const serial=profile.copies[key]=(profile.copies[key]??0)+1;\n"], ["    const pool=cards.filter(c=>c.rar===(roll<.6?1:roll<.92?2:3));\n    const id=pool[Math.floor(Math.random()*pool.length)].id;\n", "    const pool=cards.filter(c=>!retiredCards.has(c.id)&&c.rar===(roll<.6?1:roll<.92?2:3));\n    const variant=rollDevEdition();\n    const themed=devThemes[variant];\n    const id=themed?themed[Math.floor(Math.random()*themed.length)]:pool[Math.floor(Math.random()*pool.length)].id;\n"], ["  const price=count===10?900:100;\n  if(opening||profile.coins<price)return;\n  profile.coins-=price;\n", "  if(count!==1&&count!==10)return;\n"], ["  ${onlineMessage?`<p role=\"status\">${escapeHTML(onlineMessage)}</p>`: ''}<div class=\"toolbar pack-actions\"><button class=\"btn primary\" data-draw=\"1\" ${opening||(!onlineBase.startsWith('http')||onlineProfile)&&(onlineProfile?.coins??profile.coins)<100?'disabled':''}>1장 뽑기 · 100</button><button class=\"btn\" data-draw=\"10\" ${opening||(!onlineBase.startsWith('http')||onlineProfile)&&(onlineProfile?.coins??profile.coins)<900?'disabled':''}>10장 뽑기 · 900</button>${onlineProfile&&!onlineProfile.sharedPracticeWallet?`<button class=\"btn\" data-ai-draw=\"1\" ${opening||profile.coins<100?'disabled':''}>연습 코인으로 1장 · 100</button><button class=\"btn\" data-ai-draw=\"10\" ${opening||profile.coins<900?'disabled':''}>연습 코인으로 10장 · 900</button>`:''}</div>`;\n", "  ${onlineMessage?`<p role=\"status\">${escapeHTML(onlineMessage)}</p>`: ''}<div class=\"toolbar pack-actions\"><button class=\"btn primary\" data-draw=\"1\" ${opening?'disabled':''}>1장 무료 뽑기</button><button class=\"btn\" data-draw=\"10\" ${opening?'disabled':''}>10장 무료 뽑기</button>${onlineProfile&&!onlineProfile.sharedPracticeWallet?`<button class=\"btn\" data-ai-draw=\"1\" ${opening||profile.coins<100?'disabled':''}>연습 코인으로 1장 · 100</button><button class=\"btn\" data-ai-draw=\"10\" ${opening||profile.coins<900?'disabled':''}>연습 코인으로 10장 · 900</button>`:''}</div>`;\n}\nconst devEditions=[\n  ['sapphire',700,4],['cobalt',200,7],['emerald',50,14],['gold',10,32],['black',1,100],['theme-teal',50,8],['theme-banana',50,10],['theme-hiphop',50,13],['theme-pink',50,9],['theme-pop',50,11]\n];\nconst devEditionKey=(card,variant)=>variant?card+':'+variant:card;\nconst devThemes={\"theme-teal\": [90, 71, 91, 151, 160], \"theme-banana\": [102, 55, 60, 74, 82], \"theme-hiphop\": [50, 126, 130, 131, 149], \"theme-pink\": [150, 69, 32, 154, 83], \"theme-pop\": [30, 128, 125, 58, 118]};\nfunction rollDevEdition(){\n  let roll=Math.floor(Math.random()*10000);\n  for(const [variant,weight] of devEditions){\n    if(roll<weight)return variant;\n    roll-=weight;\n  }\n  return null;\n"], ["try{soundOn=localStorage.getItem('lilago-card-audio')==='on';}catch{}\n", "try{soundOn=localStorage.getItem('lilago-dev-card-audio')==='on';}catch{}\n"], ["  document.querySelector('#coins').textContent=`◈ ${(onlineProfile?.coins??profile.coins).toLocaleString()} 코인`;\n  document.querySelector('#developer-tab').hidden=onlineProfile?.canOpenDeveloperBuild!==true;\n", "  document.querySelector('#coins').textContent='◈ ∞ 코인';\n"], ["const valueRequests = new Map();\nfunction refreshCardValues(){\n  if(!onlineBase.startsWith('http'))return;\n  const nodes=[...document.querySelectorAll('.home-card-back [data-card-value],#detail[open] [data-card-value]')];\n  for(const node of nodes){\n    const {cardValue:id,valueSerial:serial,valueVariant:variant}=node.dataset;\n    if(!valueRequests.has(node)) {\n      const params=new URLSearchParams({card:id});\n      if(serial)params.set('serial',serial);\n      if(variant)params.set('variant',variant);\n      valueRequests.set(node,true);\n      fetch(onlineBase+'/market/value?'+params,{cache:'no-store',signal:AbortSignal.timeout(7000)})\n        .then(response=>{if(!response.ok)throw Error();return response.json();})\n        .then(quote=>{\n          if(!node.isConnected)return;\n          node.querySelector('strong').textContent=quote.value.toLocaleString('ko-KR')+' 코인';\n          const supply=node.querySelector('[data-supply-label]');\n          if(supply)supply.textContent='서버 유통 '+quote.supply.toLocaleString('ko-KR')+'장 · 시리얼 사본';\n        }).catch(()=>{\n          const price=node.querySelector('strong');\n          if(price.textContent==='확인 중…')price.textContent='가격 확인 불가';\n        }).finally(()=>valueRequests.delete(node));\n    }\n  }\n}\n", "function refreshCardValues(){}\n"], ["  return `<span class=\"card-value\" data-card-value=\"${id}\" data-value-serial=\"${serial||''}\" data-value-variant=\"${variant||''}\"${showSupply?' data-value-supply':''}><small>추정 시장가</small><strong>확인 중…</strong>${showSupply?'<small data-supply-label></small>':''}</span>`;\n", "  const card=cards[id];\n  const supply=profile.copies?.[devEditionKey(id,variant)]??0;\n  const edition=devEditions.find(([key])=>key===variant)?.[2]??1;\n  const premium=serial===1?1.9:serial===2?1.6:serial===3?1.45:serial>=4&&serial<=10?1.23:serial>=11&&serial<=25?1.1:1;\n  const factor=Math.max(.72,.7+.006*card.atk+.0015*card.hp+.004*card.n);\n  const value=Math.round([0,160,360,800][card.rar]*edition*factor*Math.max(.36,1.25/Math.sqrt(1+supply/30))*premium);\n  return `<span class=\"card-value\"><small>개발용 추정가</small><strong>${value.toLocaleString('ko-KR')} 코인</strong>${showSupply?`<small>이 빌드 발행 ${supply}장</small>`:''}</span>`;\n"], ["const retiredCards=new Set([163,166]);\n", ""], ["    const owned=[...new Set([...starter,...data.owned.filter(id=>cards[id])])];\n    const deck=[...new Set(data.deck.filter(id=>Number.isInteger(id)&&cards[id]))];\n    return {coins:Number.isSafeInteger(data.coins)&&data.coins>=0?data.coins:600,owned,deck:deck.length===6?deck:starter,wins:Number.isSafeInteger(data.wins)?data.wins:0,stats:data.stats||{},copies:data.copies||{},collectionCopies:data.collectionCopies,deckCopies:data.deckCopies||{}};\n", "    const owned=[...new Set([...starter,...data.owned.filter(id=>cards[id]&&!retiredCards.has(id))])];\n    const deck=[...new Set(data.deck.filter(id=>Number.isInteger(id)&&cards[id]&&!retiredCards.has(id)))];\n    return {coins:Number.isSafeInteger(data.coins)&&data.coins>=0?data.coins:600,owned,deck:[...new Set([...deck,...starter])].slice(0,6),wins:Number.isSafeInteger(data.wins)?data.wins:0,stats:data.stats||{},copies:data.copies||{},collectionCopies:data.collectionCopies,deckCopies:data.deckCopies||{}};\n"], ["const saveKey='lilago-card-arena-v1';\n", "const saveKey='lilago-dev-card-arena-v1';\nconst retiredCards=new Set([163,166]);\n"], ["try{const featured=JSON.parse(localStorage.getItem('lilago-featured-card'));featuredId=featured?.card??featured;featuredCopy=featured?.copy??null;}catch{}\n", "try{const featured=JSON.parse(localStorage.getItem('lilago-dev-featured-card'));featuredId=featured?.card??featured;featuredCopy=featured?.copy??null;}catch{}\n"], ["<body><header><div><div class=\"brand\">릴라고 <b>카드 아레나</b></div><div class=\"header-actions\"><button class=\"btn audio-toggle\" id=\"music-toggle\" aria-pressed=\"false\">♫ 음악 설정</button><div class=\"balance\" id=\"coins\"></div><div class=\"balance\" id=\"ai-coins\"></div><button class=\"btn audio-toggle\" id=\"audio-toggle\" aria-pressed=\"false\">효과음</button></div></div><nav aria-label=\"게임 메뉴\"><button data-tab=\"battle\">⚔ 홈</button><button data-tab=\"collection\">▤ 카드 · 덱</button><button data-tab=\"pack\">◇ 뽑기</button><button data-tab=\"online\" data-panel=\"rank\">🏆 리더보드</button><button data-tab=\"online\" data-panel=\"profile\">◈ 프로필</button><button id=\"developer-tab\" type=\"button\" hidden>개발자 서버 ↗</button></nav></header>\n", "<body><header><div><div class=\"brand\">릴라고 <b>카드 아레나</b><small class=\"dev-badge\">개발자 빌드 · 오프라인</small></div><div class=\"header-actions\"><button class=\"btn audio-toggle\" id=\"music-toggle\" aria-pressed=\"false\">♫ 음악 설정</button><div class=\"balance\" id=\"coins\"></div><div class=\"balance\" id=\"ai-coins\"></div><button class=\"btn audio-toggle\" id=\"audio-toggle\" aria-pressed=\"false\">효과음</button></div></div><nav aria-label=\"게임 메뉴\"><button data-tab=\"battle\">⚔ 홈</button><button data-tab=\"collection\">▤ 카드 · 덱</button><button data-tab=\"pack\">◇ 뽑기</button><button data-tab=\"online\" data-panel=\"rank\">🏆 리더보드</button><button data-tab=\"online\" data-panel=\"profile\">◈ 프로필</button></nav></header>\n"], [".edition-detail{color:#ffe0a1;font-weight:800}\n", ".edition-detail{color:#ffe0a1;font-weight:800}\n\n.dev-badge{display:block;color:#ffda85;font-size:11px;letter-spacing:.04em;margin-top:4px} [data-go=\"online\"],[data-tab=\"online\"]{display:none!important}\n"], ["header[hidden],#developer-tab[hidden]{display:none!important}\n", "header[hidden]{display:none!important}\n"], ["<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"theme-color\" content=\"#11131b\"><title>릴라고 카드 아레나</title>\n", "<head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src https://ball-battle-online-john.onrender.com; media-src https://ball-battle-online-john.onrender.com; connect-src 'none'; form-action 'none'\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"theme-color\" content=\"#11131b\"><title>릴라고 카드 아레나 · 개발자 빌드</title>\n"]];
let developerCache;
async function latestDeveloperBuild(){
  if(developerBuild)return fs.promises.readFile(developerBuild);
  const now=Date.now();
  if(developerCache?.expires>now)return developerCache.html;
  const read=async file=>{
    const response=await fetch(new URL(file,allowedOrigin),{signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw error(503,'최신 개발자 빌드를 불러올 수 없어.');
    return response.text();
  };
  const [index,base,template]=await Promise.all(['index.html','arena-base.html','game-template.html'].map(read));
  const raw=base.match(/const cards = ([\s\S]*?);\nconst tiers/)?.[1];
  const moai=index.match(/catalog\[38\]\.art='([^']+)'/)?.[1];
  const latest=index.match(/length:(\d+)\},\(_,i\)=>fetch\('catalog\/'\+\((\d+)\+i\)/);
  if(!raw||!moai||!latest)throw error(503,'카드 목록 형식을 확인해 줘.');
  const cards=JSON.parse(raw);
  cards[38].art=moai;
  const files=[...Array.from(index.matchAll(/"(catalog\/\d+\.json)"/g),match=>match[1]),
    ...Array.from({length:Number(latest[1])},(_,i)=>'catalog/'+(Number(latest[2])+i)+'.json')];
  const batches=await Promise.all(files.map(async file=>JSON.parse(await read(file))));
  cards.push(...batches.flat());
  if(cards.some((card,id)=>card.id!==id))throw error(503,'카드 목록이 맞지 않아.');
  let html=template;
  for(const [before,after] of developerEdits){
    if(html.split(before).length!==2)throw error(503,'정식 업데이트에 맞춰 개발자 설정을 확인해 줘.');
    html=html.replace(before,()=>after);
  }
  html=html.replace('/* CARD_DATA */',()=>JSON.stringify(cards).replace(/</g,'\\u003c'));
  developerCache={expires:now+60000,html};
  return html;
}
const hash = token => crypto.createHash('sha256').update(token).digest('hex');
function account(p) {
  p.trophies ??= p.wins * 10;
  p.coins ??= 600;
  p.inventory ??= [];
  p.stats ??= {};
  return p;
}
const retiredCards = new Set([163,166]);
const activeCard = id => Boolean(cards[id]) && !retiredCards.has(id);
const variants = [
  {id:'sapphire',weight:700,price:4},
  {id:'cobalt',weight:200,price:7},
  {id:'emerald',weight:50,price:14},
  {id:'gold',weight:10,price:32},
  {id:'black',weight:1,price:100},
  {id:'theme-teal',weight:50,price:8,cards:[90, 71, 91, 151, 160]},
  {id:'theme-banana',weight:50,price:10,cards:[102, 55, 60, 74, 82]},
  {id:'theme-hiphop',weight:50,price:13,cards:[50, 126, 130, 131, 149]},
  {id:'theme-pink',weight:50,price:9,cards:[150, 69, 32, 154, 83]},
  {id:'theme-pop',weight:50,price:11,cards:[30, 128, 125, 58, 118]}
];
const variantById = Object.fromEntries(variants.map(v=>[v.id,v]));
const editionKey = (card,variant) => variant ? card+':'+variant : card;
function rollVariant(catalog){
  let roll=crypto.randomInt(10000);
  for(const variant of variants){
    if(roll<variant.weight)return !variant.cards||variant.cards.every(id=>id<catalog.length)?variant.id:null;
    roll-=variant.weight;
  }
  return null;
}
const startersFor = p => p.starters ?? starter;
function profileCardFor(p) {
  const chosen = p.profileCard;
  const copy = chosen?.unit && p.inventory.find(u => u.id === chosen.unit && u.card === chosen.card);
  if (copy && activeCard(copy.card)) return {card:copy.card, serial:copy.serial, variant:copy.variant};
  if (chosen && !chosen.unit && startersFor(p).includes(chosen.card)) return {card:chosen.card};
  return {card:startersFor(p)[0]};
}
const publicPlayer = p => {
  const {id,name,frame,wins,losses,trophies}=account(p);
  return {id,name,frame,wins,losses,trophies,profileCard:profileCardFor(p)};
};
const privatePlayer = p => ({ ...publicPlayer(p), coins:p.coins, canOpenDeveloperBuild:canOpenDeveloperBuild(p), collectionCopies:p.collectionCopies??{}, sharedPracticeWallet:true, canViewAllCards:!!ownerId && p.id===ownerId, inventory:p.inventory.filter(u=>activeCard(u.card)), stats:p.stats, starters:startersFor(p), deck:deckFor(p), deckCopies:deckCopiesFor(p,deckFor(p)) });
const error = (status, message) => Object.assign(new Error(message), { status });

function persist() {
  if (database) {
    const snapshot = JSON.stringify(state);
    pendingSave = pendingSave.then(() => database.query(
      'UPDATE lilago_card_arena_state SET payload = $1::jsonb WHERE singleton',
      [snapshot]
    )).catch(error => {
      console.error('Card database write failed:', error.code || error.name);
      process.exit(1);
    });
    return;
  }
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  fs.writeFileSync(dataPath + '.tmp', JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(dataPath + '.tmp', dataPath);
}

function finish(room, winner) {
  room.winner = winner;
  room.ended = Date.now();
  room.deadline = null;
  for (const [side,id] of room.ids.entries()) {
    const p=account(state.players[id]);
    for(const card of room.used[side]){
      const totals=p.stats[card]??={uses:0,wins:0};
      totals.uses++;
      if(winner===side)totals.wins++;
    }
    if(room.ai){p.coins+=winner===side?120:winner===-1?60:40;continue;}
    if(winner===side){p.wins++;p.trophies+=10;p.coins+=120;}
    else if(winner!==-1){p.losses++;p.coins+=40;}
    else p.coins+=60;
  }
  persist();
}

function activeRoom(id) {
  return [...rooms.values()].find(room => !room.ai && room.ids.includes(id) && room.winner === null);
}

function battleCopies(player){
  const deck=deckFor(player);
  const equipped=deckCopiesFor(player,deck);
  return Object.fromEntries(deck.flatMap(card=>{
    const chosen=equipped[card]??player.collectionCopies?.[card];
    const owned=player.inventory.filter(item=>item.card===card);
    const unit=chosen==='basic-0'&&startersFor(player).includes(card)?null:owned.find(item=>item.id===chosen)??owned[0];
    return unit?[[card,{serial:unit.serial,variant:unit.variant}]]:[];
  }));
}

function view(room, id) {
  if (!room) return null;
  const side = room.ids.indexOf(id);
  return {
    id: room.id, side, turn: room.turn, deadline: room.deadline,
    opponent: room.ai?{name:'연습 상대'}:publicPlayer(state.players[room.ids[1 - side]]),
    ai: !!room.ai,
    hands: room.hands[side], teams: room.teams,
    copies: room.copies.map((copies,index)=>index===side?copies:Object.fromEntries(
      Object.entries(copies).filter(([card])=>room.used[index].includes(Number(card)))
    )),
    submitted: !!room.moves[side], winner: room.winner, last: room.last
  };
}

function advanceRound(room){
      room.moves.forEach((move,side)=>room.used[side].push(move.id));
      room.last = resolveRound(room);
      room.moves = [null,null];
      if (room.turn === 5) finish(room,room.last.winner);
      else { room.turn++;room.deadline=Date.now()+deadlineMs; }
}

function clean() {
  const now = Date.now();
  for (const [id, expires] of queue) if (expires < now) queue.delete(id);
  for (const [id, expires] of registrations) if (expires < now) registrations.delete(id);
  for (const room of rooms.values()) {
    if (room.ended && now - room.ended > 300_000) rooms.delete(room.id);
    else if (room.winner === null && now > room.deadline) {
      for(let side=0;side<2;side++){
        const hand=room.hands[side];
        room.moves[side]??={id:hand[crypto.randomInt(hand.length)],lane:crypto.randomInt(3)};
      }
      advanceRound(room);
    }
  }
}


function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size <= 380000) chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > 380000) return reject(error(413, '입력값이 너무 길어.'));
      try { resolve(size ? JSON.parse(Buffer.concat(chunks)) : {}); }
      catch { reject(error(400, '요청 형식을 확인해줘.')); }
    });
    req.on('error', reject);
  });
}
function text(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}
async function playerFor(req) {
  const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) throw error(401, '온라인 프로필 연결이 필요해.');
  const key = hash(token);
  const player = Object.values(state.players).find(p => p.key === key);
  if (!player) throw error(401, '온라인 프로필을 다시 연결해줘.');
  return account(player);
}

function deckFor(p){return [...new Set([...(p.deck||[]).filter(id=>activeCard(id)&&(p.inventory.some(u=>u.card===id)||startersFor(p).includes(id))),...startersFor(p)])].slice(0,6);}
function deckCopiesFor(p,deck,copies=p.deckCopies){
  return Object.fromEntries(deck.flatMap(card=>{
    const id=copies?.[card];
    return (id==='basic-0'&&startersFor(p).includes(card))||p.inventory.some(u=>u.id===id&&u.card===card) ? [[card,id]] : [];
  }));
}
const sellable=(p,card)=>p.inventory.filter(u=>u.card===card&&!state.market[u.id]).length>1 || startersFor(p).includes(card);
const saleWindow = 21 * 24 * 60 * 60 * 1000;
function serialPremium(serial) {
  if (serial === 1) return 1.9;
  if (serial === 2) return 1.6;
  if (serial === 3) return 1.45;
  if (serial >= 4 && serial <= 10) return 1.23;
  return serial >= 11 && serial <= 25 ? 1.1 : 1;
}
function marketValue(card, supply, serial, variant) {
  const rarityPrice = [0, 160, 360, 800][card.rar];
  const cardFactor = Math.max(.72, .7 + .006*card.atk + .0015*card.hp + .004*card.n);
  const baseline = rarityPrice * (variantById[variant]?.price??1) * cardFactor * Math.max(.36, 1.25/Math.sqrt(1+supply/30));
  const cutoff = Date.now() - saleWindow;
  const samples = (state.marketSales[editionKey(card.id,variant)] ?? []).filter(sale=>sale.time>=cutoff);
  const normalized = samples.map(sale=>sale.price/serialPremium(sale.serial)).sort((a,b)=>a-b);
  const middle = Math.floor(normalized.length/2);
  const median = normalized.length%2 ? normalized[middle] : (normalized[middle-1]+normalized[middle])/2;
  const tradeWeight = Math.min(.6, normalized.length*.12);
  const demand = tradeWeight ? Math.max(baseline*.5, Math.min(baseline*3, median)) : baseline;
  const value = Math.round((baseline*(1-tradeWeight)+demand*tradeWeight)*serialPremium(serial));
  return {value, supply, serial, variant, recentSales:normalized.length};
}
const marketList=()=>Object.values(state.market).filter(item=>activeCard(item.card)).map(item=>({...item,sellerName:state.players[item.seller].name}));
const handlers = new Map([
  ['POST /profile/new', (req, body) => {
    const name = text(body.name, 20);
    if (!name || /[\x00-\x1f]/.test(name)) throw error(400, '닉네임을 입력해줘.');
    const origin = req.socket.remoteAddress;
    if (registrations.has(origin)) throw error(429, '잠시 뒤 다시 시도해줘.');
    registrations.set(origin, Date.now() + 4000);
    const token = crypto.randomBytes(32).toString('hex');
    const id = crypto.randomBytes(4).toString('hex').toUpperCase();
    const player = { id, key: hash(token), name, frame: ['mint','violet','amber'].includes(body.frame)?body.frame:'mint', icon: 0, wins: 0, losses: 0, rating: 1000, friends: [] };
    const eligible=cards.filter(c=>c.rar===1 && c.id<60).map(c=>c.id);
    player.starters=Array.from({length:6},()=>eligible.splice(crypto.randomInt(eligible.length),1)[0]);
    player.profileCard={card:player.starters[crypto.randomInt(player.starters.length)]};
    state.players[id] = player;
    persist();
    return { token, player: privatePlayer(player) };
  }],
  ['POST /profile', (req, body, p) => {
    const name = text(body.name, 20);
    if (!name || !['mint','violet','amber'].includes(body.frame)) {
      throw error(400, '프로필 설정을 확인해줘.');
    }
    Object.assign(p, { name, frame: body.frame });
    persist();
    return privatePlayer(p);
  }],
  ['POST /profile/card', (req, body, p) => {
    const {card,unit}=body;
    const owned=unit ? p.inventory.some(u=>u.id===unit&&u.card===card) : startersFor(p).includes(card);
    if(!Number.isInteger(card)||!activeCard(card)||!owned)throw error(400,'보유한 카드만 프로필에 사용할 수 있어.');
    p.profileCard=unit?{card,unit}:{card};
    persist();
    return privatePlayer(p);
  }],
  ['POST /developer/ticket', (req, body, p) => {
    if (!canOpenDeveloperBuild(p)) throw error(403, '개발자 서버에 입장할 권한이 없어.');
    const ticket = crypto.randomBytes(32).toString('hex');
    const expires = setTimeout(() => developerTickets.delete(ticket), 30_000);
    expires.unref();
    developerTickets.set(ticket, expires);
    return {ticket};
  }],
  ['POST /collection/copy', (req, body, p) => {
    const {card,copy}=body;
    const valid=activeCard(card)&&Number.isInteger(card)&&(
      copy==='basic-0'&&startersFor(p).includes(card)||
      p.inventory.some(unit=>unit.id===copy&&unit.card===card)&&!state.market[copy]
    );
    if(!valid)throw error(400,'장착할 수 있는 보유 사본을 선택해 줘.');
    p.collectionCopies??={};
    p.collectionCopies[card]=copy;
    if(deckFor(p).includes(card))p.deckCopies={...p.deckCopies,[card]:copy};
    persist();
    return {collectionCopies:p.collectionCopies};
  }],
  ['GET /profile', (req, body, p) => privatePlayer(p)],
  ['GET /leaderboard', () => Object.values(state.players)
    .map(publicPlayer).sort((a,b) => b.trophies - a.trophies || b.wins - a.wins || a.id.localeCompare(b.id)).slice(0,50)],
  ['GET /friends', (req, body, p) => p.friends.filter(id=>state.players[id]).map(id => publicPlayer(state.players[id]))],
  ['POST /friends', (req, body, p) => {
    const id = text(body.id, 8).toUpperCase();
    if (!state.players[id] || id === p.id) throw error(404, '친구 코드를 확인해줘.');
    if (!p.friends.includes(id)) {
      if (p.friends.length >= 100) throw error(409, '친구 목록이 가득 찼어.');
      p.friends.push(id);
      persist();
    }
    return p.friends.filter(id=>state.players[id]).map(id => publicPlayer(state.players[id]));
  }],
  ['POST /requests', (req, body, p) => {
    const name = text(body.name, 60), idea = text(body.idea, 400);
    if (!name || !idea) throw error(400, '카드 이름과 아이디어를 입력해줘.');
    if (state.requests.filter(r => r.player === p.id).length >= 20) throw error(409, '요청은 프로필당 20개까지 보낼 수 있어.');
    const photo=text(body.photo,370000);
    if(photo&&!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(photo))throw error(400,'사진 형식을 확인해줘.');
    state.requests.push({ player: p.id, name, idea, photo, date: Date.now() });
    persist();
    return { ok: true };
  }],
  ['GET /requests', (req, body, p) => state.requests.filter(r => r.player === p.id).reverse()],
  ['POST /deck', (req, body, p) => {
    if(!Array.isArray(body.deck)||body.deck.length!==6||new Set(body.deck).size!==6||body.deck.some(id=>!Number.isInteger(id)||!activeCard(id)||(!startersFor(p).includes(id)&&!p.inventory.some(u=>u.card===id))))throw error(400,'온라인 덱에 넣을 카드인지 확인해줘.');
    p.deck=body.deck;p.deckCopies=deckCopiesFor(p,p.deck,body.copies??p.deckCopies);persist();return {ok:true,deckCopies:p.deckCopies};
  }],
  ['POST /draw', (req, body, p) => {
    const count=body.count===10?10:1, price=count===10?900:100;
    const catalog=body.catalog===cards.length?cards:cards.slice(0,[135,157,159].includes(body.catalog)?body.catalog:60);
    if(p.coins<price)throw error(409,'코인이 부족해.');
    p.coins-=price;
    const results=Array.from({length:count},()=>{
      const roll=Math.random(), pool=catalog.filter(c=>activeCard(c.id)&&c.rar===(roll<.6?1:roll<.92?2:3));
      const variant=body.editions===1 ? rollVariant(catalog) : null;
      const themeCards=variantById[variant]?.cards;
      const card=themeCards?themeCards[crypto.randomInt(themeCards.length)]:pool[crypto.randomInt(pool.length)].id;
      const key=editionKey(card,variant);
      const serial=state.serials[key]=(state.serials[key]||0)+1;
      const unit={id:crypto.randomUUID(),card,serial,...(variant?{variant}:{})};
      p.inventory.push(unit);
      return {id:card,serial,variant,duplicate:false};
    });
    persist();return {player:privatePlayer(p),results};
  }],
  ['GET /market/value', (req, body, player, url) => {
    const id = url.searchParams.get('card');
    const serial = url.searchParams.get('serial');
    const card = id!==null && /^\d+$/.test(id) ? cards[Number(id)] : null;
    const variant=url.searchParams.get('variant');
    if(variant!==null&&(!Object.hasOwn(variantById,variant)||(variantById[variant].cards&&!variantById[variant].cards.includes(Number(id)))))throw error(400,'카드 버전을 확인해 줘.');
    const supply = card ? state.serials[editionKey(card.id,variant)] ?? 0 : 0;
    if (!card || !activeCard(card.id) || (serial!==null && (!/^[1-9]\d*$/.test(serial) || Number(serial)>supply))) {
      throw error(400,'카드 번호를 확인해 줘.');
    }
    return marketValue(card, supply, serial===null ? null : Number(serial), variant);
  }],
  ['GET /market', () => marketList()],
  ['POST /market/list', (req, body, p) => {
    const unit=p.inventory.find(u=>u.id===body.id);
    if(!unit||!activeCard(unit.card)||state.market[unit.id])throw error(409,'판매할 카드를 확인해줘.');
    if(!sellable(p,unit.card))throw error(409,'중복 카드만 판매할 수 있어. 한 장은 덱에 남겨야 해.');
    if(!Number.isSafeInteger(body.price)||body.price<1||body.price>1_000_000)throw error(400,'가격은 1~1,000,000 코인으로 설정해줘.');
    state.market[unit.id]={...unit,price:body.price,seller:p.id};
    persist();return {player:privatePlayer(p),market:marketList()};
  }],
  ['POST /market/cancel', (req, body, p) => {
    if(state.market[body.id]?.seller!==p.id)throw error(404,'판매 등록을 찾을 수 없어.');
    delete state.market[body.id];persist();return {player:privatePlayer(p),market:marketList()};
  }],
  ['POST /market/buy', (req, body, p) => {
    const item=state.market[body.id];
    if(!item||!activeCard(item.card)||item.seller===p.id||item.price!==body.price)throw error(409,'거래 내용을 다시 확인해줘.');
    if(p.coins<item.price)throw error(409,'코인이 부족해.');
    const seller=account(state.players[item.seller]);
    const unit=seller.inventory.find(u=>u.id===item.id);
    if(!unit)throw error(409,'카드가 이미 판매됐어.');
    if(!startersFor(seller).includes(item.card)&&!seller.inventory.some(u=>u.id!==item.id&&u.card===item.card&&!state.market[u.id]))throw error(409,'판매자가 보유할 카드가 한 장은 남아야 해.');
    p.coins-=item.price;seller.coins+=item.price;
    seller.inventory=seller.inventory.filter(u=>u.id!==item.id);
    p.inventory.push(unit);delete state.market[item.id];
    const key = editionKey(unit.card,unit.variant);
    const sales = state.marketSales[key] ?? [];
    const now = Date.now();
    state.marketSales[key] = [{serial:unit.serial, price:item.price, time:now},
      ...sales.filter(sale=>sale.serial!==unit.serial&&sale.time>=now-saleWindow)].slice(0,12);
    persist();return {player:privatePlayer(p),market:marketList()};
  }],
  ['POST /practice', (req, body, p) => {
    clean();
    const active=[...rooms.values()].find(room=>room.ai&&room.ids[0]===p.id&&room.winner===null);
    if(active)return view(active,p.id);
    const botDeck=(body.catalog===cards.length?cards:cards.slice(0,[135,157,159].includes(body.catalog)?body.catalog:60)).filter(c=>activeCard(c.id)).map(c=>c.id);
    for(let i=botDeck.length-1;i>0;i--){const j=crypto.randomInt(i+1);[botDeck[i],botDeck[j]]=[botDeck[j],botDeck[i]];}
    const room={ai:true,id:crypto.randomUUID(),ids:[p.id],copies:[battleCopies(p),{}],used:[[],[]],teams:[[],[]],hands:[deckFor(p),botDeck.slice(0,6)],moves:[null,null],turn:1,deadline:Date.now()+deadlineMs,winner:null,last:null};
    rooms.set(room.id,room);
    return view(room,p.id);
  }],
  ['POST /queue', (req, body, p) => {
    clean();
    const active = activeRoom(p.id);
    if (active) return { room: view(active, p.id), queued: false };
    const rival = [...queue.keys()].find(id => id !== p.id && !activeRoom(id));
    if (!rival) { queue.set(p.id, Date.now() + 120_000); return { queued: true }; }
    queue.delete(p.id);
    queue.delete(rival);
    const room = { used:[[],[]], id: crypto.randomUUID(), ids: [rival,p.id], copies:[battleCopies(state.players[rival]),battleCopies(p)], teams: [[],[]], hands: [deckFor(state.players[rival]),deckFor(p)], moves: [null,null], turn: 1, deadline: Date.now() + deadlineMs, winner: null, last: null };
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
    if(room.ai){
      const hand=room.hands[1];
      const lanes=[0,1,2].map(lane=>({lane,value:Math.random()*61+(room.teams[1].some(u=>u.lane===lane)?0:27)}));
      room.moves[1]={id:hand[crypto.randomInt(hand.length)],lane:lanes.sort((a,b)=>b.value-a.value)[0].lane};
    }
    if (room.moves.every(Boolean)) {
      advanceRound(room);
    }
    return view(room,p.id);
  }]
]);

const server = http.createServer(async (req,res) => {
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
    if (url.pathname==='/health') {res.end(JSON.stringify({ok:true,storage:database?'postgres':'file',cards:cards.length}));return;}
    if (req.method==='GET' && url.pathname==='/developer/play') {
      const ticket=url.searchParams.get('ticket');
      const expires=developerTickets.get(ticket);
      if (!expires) throw error(403, '정식 게임의 개발자 탭에서 다시 열어 줘.');
      developerTickets.delete(ticket);
      clearTimeout(expires);
      const html=await latestDeveloperBuild();
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.setHeader('Referrer-Policy','no-referrer');
      res.setHeader('X-Frame-Options','DENY');
      res.end(html);
      return;
    }
    const key=req.method+' '+url.pathname;
    const handler=handlers.get(key);
    if (!handler) throw error(404,'지원하지 않는 경로야.');
    if (origin && origin!==allowedOrigin) throw error(403,'허용되지 않은 게임 주소야.');
    const player=key==='POST /profile/new'||(key==='GET /leaderboard'||key==='GET /market/value')?null:await playerFor(req);
    const body=req.method==='POST'?await readBody(req):{};
    if (!body || typeof body!=='object' || Array.isArray(body)) throw error(400,'요청 형식을 확인해줘.');
    const result = handler(req,body,player,url);
    await pendingSave;
    res.end(JSON.stringify(result));
  } catch (e) {
    if(!e.status)console.error(e);
    res.writeHead(e.status||500);
    res.end(JSON.stringify({error:e.status?e.message:'서버에서 요청을 처리하지 못했어.'}));
  }
});

async function start() {
  const hasFile = fs.existsSync(dataPath);
  const initial = hasFile
    ? JSON.parse(fs.readFileSync(dataPath, 'utf8'))
    : { players: {}, requests: [], serials: {}, market: {} };
  if (process.env.CARD_DATABASE_URL) {
    const { Pool } = require('./pg-bundle.cjs');
    database = new Pool({ connectionString: process.env.CARD_DATABASE_URL, max: 1 });
    await database.query(
      'CREATE TABLE IF NOT EXISTS lilago_card_arena_state (singleton boolean PRIMARY KEY CHECK (singleton), payload jsonb NOT NULL)'
    );
    if (hasFile || process.env.CARD_ALLOW_EMPTY_INIT === '1') {
      await database.query(
        'INSERT INTO lilago_card_arena_state (singleton, payload) VALUES (true, $1::jsonb) ON CONFLICT DO NOTHING',
        [JSON.stringify(initial)]
      );
    }
    const { rows } = await database.query('SELECT payload FROM lilago_card_arena_state WHERE singleton');
    if (!rows.length) throw new Error('An existing card state backup is required');
    state = rows[0].payload;
  } else {
    if (process.env.RENDER_SERVICE_ID) throw new Error('CARD_DATABASE_URL is required on Render');
    state = initial;
  }
  state.serials ??= {};
  state.marketSales ??= {};
  state.market ??= {};
  setInterval(clean, 250).unref();
  server.listen(Number(process.env.PORT) || 3000);
}
start().catch(error => {
  console.error('Card server startup failed:', error.code || error.message);
  process.exit(1);
});
