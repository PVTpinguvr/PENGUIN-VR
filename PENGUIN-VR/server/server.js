import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';

const PORT=Number(process.env.PORT||8080);
const DATA_DIR=process.env.DATA_DIR||'./data';
fs.mkdirSync(DATA_DIR,{recursive:true});
const STORE=path.join(DATA_DIR,'penguin-vr-state.json');
const load=()=>{try{return JSON.parse(fs.readFileSync(STORE,'utf8'))}catch{return {ownerId:null,leaderboards:{}}}};
const state=load();
const save=()=>fs.writeFileSync(STORE,JSON.stringify(state,null,2));
const rooms=new Map(),clients=new Map();
const clean=(v,max=20)=>String(v??'').replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,max)||'Pingu';
const send=(ws,data)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data))};
const roomKey=(map,mode)=>map+':'+mode;
function broadcast(room,data,except=null){for(const ws of room?.players.values()||[])if(ws!==except)send(ws,data)}
function publicPlayers(room){return [...room.players.values()].map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,z:p.z,yaw:p.yaw,cosmetic:p.cosmetic}))}
function enter(ws,msg){
 const id=String(msg.playerId||'').match(/^[a-zA-Z0-9-]{16,64}$/)?String(msg.playerId):crypto.randomUUID(),name=clean(msg.name),map=clean(msg.map,24),mode=clean(msg.mode,24),key=roomKey(map,mode);
 if(!state.ownerId){state.ownerId=id;save()}
 let room=rooms.get(key);if(!room){room={key,map,mode,players:new Map()};rooms.set(key,room)}
 const player={id,name,map,mode,cosmetic:clean(msg.cosmetic,24),x:0,y:0,z:0,yaw:0,ws,room};
 room.players.set(id,player);clients.set(ws,player);
 send(ws,{type:'welcome',id,ownerId:state.ownerId,isOwner:id===state.ownerId,room:key,players:publicPlayers(room),leaderboard:(state.leaderboards[map]||[]).slice(0,10)});
 broadcast(room,{type:'player-joined',player:{id,name,x:0,y:0,z:0,yaw:0,cosmetic:player.cosmetic}},ws);
}
const server=http.createServer((req,res)=>{if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,rooms:rooms.size,players:clients.size}));return}res.writeHead(200,{'content-type':'text/plain'});res.end('PENGUIN VR realtime server')});
const wss=new WebSocketServer({server});
wss.on('connection',ws=>{
 ws.on('message',raw=>{
  let msg;try{msg=JSON.parse(raw.toString())}catch{return}
  const p=clients.get(ws);
  if(msg.type==='join'&&!p){enter(ws,msg);return}
  if(!p)return;
  if(msg.type==='move'){
   p.x=Number.isFinite(msg.x)?Math.max(-100,Math.min(100,msg.x)):p.x;
   p.y=Number.isFinite(msg.y)?Math.max(0,Math.min(30,msg.y)):p.y;
   p.z=Number.isFinite(msg.z)?Math.max(-100,Math.min(100,msg.z)):p.z;
   p.yaw=Number.isFinite(msg.yaw)?msg.yaw:p.yaw;
   broadcast(p.room,{type:'player-moved',player:{id:p.id,name:p.name,x:p.x,y:p.y,z:p.z,yaw:p.yaw,cosmetic:p.cosmetic}},ws);
  }else if(msg.type==='score'){
   const score=Math.max(0,Math.min(1000000,Math.floor(Number(msg.score)||0)));
   const list=state.leaderboards[p.map]||[];
   const old=list.find(x=>x.id===p.id);
   if(old)old.score=Math.max(old.score,score);else list.push({id:p.id,name:p.name,score});
   list.sort((a,b)=>b.score-a.score);state.leaderboards[p.map]=list.slice(0,100);save();
   send(ws,{type:'leaderboard',entries:list.slice(0,10)});
  }else if(msg.type==='signal'&&typeof msg.to==='string'){
   const target=[...p.room.players.values()].find(x=>x.id===msg.to);
   if(target)send(target.ws,{type:'signal',from:p.id,signal:msg.signal});
  }else if(msg.type==='chat'){
   const text=String(msg.text||'').slice(0,240);
   if(text.trim())broadcast(p.room,{type:'chat',id:p.id,name:p.name,text},null);
  }else if(msg.type==='owner-action'&&p.id===state.ownerId){
   const action=clean(msg.action,30);
   if(['kick','mute','announce'].includes(action)){
    const target=[...p.room.players.values()].find(x=>x.id===msg.target);
    if(target)send(target.ws,{type:'moderation',action,by:p.name,message:clean(msg.message,120)});
    if(action==='kick'&&target)target.ws.close(4001,'Removed by owner');
    if(action==='announce')broadcast(p.room,{type:'announcement',message:clean(msg.message,120)});
   }
  }
 });
 ws.on('close',()=>{
  const p=clients.get(ws);if(!p)return;
  p.room.players.delete(p.id);clients.delete(ws);
  broadcast(p.room,{type:'player-left',id:p.id});
  if(!p.room.players.size)rooms.delete(p.room.key);
 });
});
server.listen(PORT,'0.0.0.0',()=>console.log('PENGUIN VR server listening on '+PORT));
