// Start with: npm install ws && node snake-pvp-server.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 8080);
const rooms = new Map();
const page = path.join(__dirname, 'snake-game.html');
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/snake-pvp.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(page).pipe(res);
  } else { res.writeHead(404); res.end('Not found'); }
});
const wss = new WebSocketServer({ server });
const send = (ws, data) => { if (ws.readyState === 1) ws.send(JSON.stringify(data)); };
const code = () => Math.random().toString(36).slice(2, 6).toUpperCase();
function freshGame() {
  return { running: true, tick: 0, score: [0, 0], snakes: [
    [{x:3,y:10},{x:2,y:10},{x:1,y:10}], [{x:16,y:10},{x:17,y:10},{x:18,y:10}]
  ], dirs: [{x:1,y:0},{x:-1,y:0}], food: [], powerups: [], shots: [], effects: [{giant:0,ammo:0},{giant:0,ammo:0}], winner: null };
}
function place(room, list) {
  let p; do { p={x:Math.floor(Math.random()*20),y:Math.floor(Math.random()*20)}; }
  while(room.game.snakes.some(s=>s.some(q=>q.x===p.x&&q.y===p.y)) || list.some(q=>q.x===p.x&&q.y===p.y));
  return p;
}
function broadcast(room) {
  const state = { type:'state', code:room.code, connected:room.players.filter(Boolean).length, game:room.game };
  room.players.forEach(ws => send(ws, state));
}
function start(room) {
  if (room.loop) clearInterval(room.loop);
  room.game = freshGame(); room.game.food.push(place(room, [])); broadcast(room);
  room.tempo = 130;
  room.step = () => {
    const g=room.game;if(!g.running)return;g.tick++;
    if(g.tick%60===0&&g.powerups.length<2){const types=['speed','slow','giant','points','fire'];g.powerups.push({...place(room,g.powerups),kind:types[Math.floor(Math.random()*types.length)],expires:g.tick+100});}
    const heads=g.snakes.map((s,i)=>({x:(s[0].x+g.dirs[i].x+20)%20,y:(s[0].y+g.dirs[i].y+20)%20}));
    const hits=[false,false];
    heads.forEach((h,i)=>{if(g.snakes[i].some((p,j)=>j<g.snakes[i].length-1&&p.x===h.x&&p.y===h.y)||g.snakes[1-i].some(p=>p.x===h.x&&p.y===h.y))hits[i]=true;});
    if(heads[0].x===heads[1].x&&heads[0].y===heads[1].y)hits[0]=hits[1]=true;
    heads.forEach((h,i)=>g.snakes[i].unshift(h));
    heads.forEach((h,i)=>{
      const fi=g.food.findIndex(p=>p.x===h.x&&p.y===h.y);
      if(fi>=0){g.food.splice(fi,1);g.score[i]+=10;} else g.snakes[i].pop();
      if(hits[i]&&g.snakes[i].length>1)g.snakes[i].pop();
      const pi=g.powerups.findIndex(p=>p.x===h.x&&p.y===h.y);
      if(pi>=0){const kind=g.powerups.splice(pi,1)[0].kind;
        if(kind==='points')g.score[i]+=50;
        if(kind==='giant'){for(let n=0;n<4;n++)g.snakes[i].push({...g.snakes[i][g.snakes[i].length-1]});g.effects[i].giant=g.tick+60;}
        if(kind==='fire')g.effects[i].ammo++;
        if(kind==='speed')g.speedUntil=g.tick+40;
        if(kind==='slow')g.slowUntil=g.tick+40;
      }
      if(g.effects[i].giant&&g.tick>=g.effects[i].giant){while(g.snakes[i].length>3)g.snakes[i].pop();g.effects[i].giant=0;}
    });
    g.shots.forEach(s=>{s.x=(s.x+s.dx+20)%20;s.y=(s.y+s.dy+20)%20;s.life--;const target=g.snakes[1-s.player];if(target.some(p=>p.x===s.x&&p.y===s.y)){if(target.length>1)target.pop();s.life=0;}});
    g.shots=g.shots.filter(s=>s.life>0);g.powerups=g.powerups.filter(p=>p.expires>g.tick);
    if(!g.food.length)g.food.push(place(room,[]));
    broadcast(room);
    const pace = room.game.speedUntil > room.game.tick ? 85 : room.game.slowUntil > room.game.tick ? 180 : 130;
    if (pace !== room.tempo) { room.tempo = pace; clearInterval(room.loop); room.loop = setInterval(room.step, room.tempo); }
  };
  room.loop = setInterval(room.step, room.tempo);
}
wss.on('connection', ws => {
  let room=null,player=-1;
  ws.on('message', raw => {
    let msg;try{msg=JSON.parse(raw.toString())}catch{return;}
    if(msg.type==='ping'){send(ws,{type:'pong'});return;}
    if(msg.type==='host'){
      let id;do{id=code()}while(rooms.has(id));
      room={code:id,players:[ws,null],game:freshGame(),loop:null};rooms.set(id,room);player=0;
      send(ws,{type:'joined',code:id,player,connected:1});broadcast(room);return;
    }
    if(msg.type==='join'){
      const id=String(msg.code||'').trim().toUpperCase();room=rooms.get(id);
      if(!room){send(ws,{type:'error',message:'Room code not found.'});return;}
      if(room.players[1]){send(ws,{type:'error',message:'That room is full.'});return;}
      room.players[1]=ws;player=1;send(ws,{type:'joined',code:id,player,connected:2});
      room.players.forEach((peer,i)=>send(peer,{type:'ready',player:i}));start(room);return;
    }
    if(!room||player<0)return;
    if(msg.type==='dir'){
      const dirs={up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}},d=dirs[msg.dir],old=room.game.dirs[player];
      if(d&&!(d.x===-old.x&&d.y===-old.y))room.game.dirs[player]=d;
    } else if(msg.type==='spit'&&room.game.effects[player].ammo>0){
      const g=room.game;g.effects[player].ammo--;g.shots.push({x:g.snakes[player][0].x,y:g.snakes[player][0].y,dx:g.dirs[player].x,dy:g.dirs[player].y,life:8,player});broadcast(room);
    } else if(msg.type==='restart'&&room.players.filter(Boolean).length===2)start(room);
  });
  ws.on('close',()=>{
    if(!room)return;
    if(room.players[player]===ws)room.players[player]=null;
    if(room.loop){clearInterval(room.loop);room.loop=null;}
    room.players.forEach(peer=>send(peer,{type:'opponent-left'}));
    if(!room.players.some(Boolean))rooms.delete(room.code);
  });
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Snake PvP listening on http://localhost:${PORT}`));

