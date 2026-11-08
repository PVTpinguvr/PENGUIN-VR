import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

const $=s=>document.querySelector(s), root=$('#game');
const vrOnlyStyle=document.createElement('style');vrOnlyStyle.textContent=`
#panel,#nav,.hud,.mobile-controls{display:none!important}
#hint{bottom:22px}
#vrGate{position:fixed;z-index:8;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(ellipse at 50% 35%,#263c69dd,#080b1bf5);text-align:center}
#vrGate .gate-card{max-width:440px;padding:28px;border:1px solid #ffffff30;border-radius:24px;background:#11152bee;box-shadow:0 20px 80px #0009}
#vrGate h1{font-size:34px;margin:0 0 8px;letter-spacing:.08em}
#vrGate p{color:#c8d4f3;line-height:1.55;font-size:14px}
#vrGate .gate-note{font-size:11px;color:#9eafd5}
body.vr-active #vrGate{display:none}
body.vr-active #brand{display:none}
#vrButton{left:50%;right:auto;bottom:calc(50% - 150px);transform:translateX(-50%);font-size:15px;padding:16px 24px;white-space:nowrap}
body.vr-active #vrButton{display:none}
`;document.head.appendChild(vrOnlyStyle);
const gate=document.createElement('div');gate.id='vrGate';gate.innerHTML='<div class="gate-card"><h1>🐧 PENGUIN VR</h1><p>A VR-only penguin movement game. Put on your Meta Quest headset and enter the frozen island.</p><p>Use your tracked flippers to push against the ground and move, just like Gorilla Tag.</p><p class="gate-note">Requires a WebXR-compatible VR browser over HTTPS. Desktop and mobile play are disabled.</p></div>';document.body.appendChild(gate);
const defaults={name:'Pingu',coins:250,level:1,xp:0,owned:['midnight'],equipped:'midnight',friends:[],claimedDay:'',volume:.5,sensitivity:1};
let save={...defaults,...JSON.parse(localStorage.getItem('penguinVRSave')||'{}')};
const catalog=[
 {id:'midnight',name:'Midnight Penguin',cost:0,color:0x202a42,desc:'The classic look.'},
 {id:'purple',name:'Royal Purple',cost:120,color:0x6655d9,desc:'A royal violet coat.'},
 {id:'ocean',name:'Ocean Penguin',cost:180,color:0x168c9c,desc:'Cool as the sea.'},
 {id:'berry',name:'Berry Penguin',cost:220,color:0x9c4d78,desc:'A berry-coloured buddy.'},
 {id:'caramel',name:'Caramel Penguin',cost:260,color:0x8c6038,desc:'Warm and cosy.'},
 {id:'forest',name:'Forest Penguin',cost:300,color:0x43834c,desc:'A woodland explorer.'},
 {id:'gold',name:'Golden Penguin',cost:900,color:0xe4b832,desc:'A shiny rare outfit.'},
 {id:'ice',name:'Ice Crystal',cost:650,color:0x7ad8ef,desc:'A frosty crystal style.'}
];
function persist(){localStorage.setItem('penguinVRSave',JSON.stringify(save));refreshUI()}
function notify(t){const e=$('#toast');e.textContent=t;e.classList.add('show');clearTimeout(notify.timer);notify.timer=setTimeout(()=>e.classList.remove('show'),2300)}
function refreshUI(){$('#coinPill').textContent='🐟 '+save.coins;$('#levelPill').textContent='Lv '+save.level;$('#playerName').value=save.name;$('#playerColour').value=String(Math.max(0,catalog.findIndex(x=>x.id===save.equipped)));$('#friendsList').textContent=save.friends.length?save.friends.map(n=>'🐧 '+n).join(' · '):'No friends added yet.';renderShop();renderInventory()}
function renderShop(){$('#shopItems').innerHTML=catalog.map(x=>`<div class="item"><strong>${x.name}</strong><small>${x.desc}<br>${x.cost?`🐟 ${x.cost}`:'FREE'}</small><button data-buy="${x.id}">${save.owned.includes(x.id)?(save.equipped===x.id?'EQUIPPED':'OWNED'): 'BUY'}</button></div>`).join('');$('#shopItems').querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>buy(b.dataset.buy))}
function renderInventory(){$('#inventoryItems').innerHTML=catalog.filter(x=>save.owned.includes(x.id)).map(x=>`<div class="item"><strong>${x.name}</strong><small>${x.desc}</small><button data-equip="${x.id}">${save.equipped===x.id?'EQUIPPED':'EQUIP'}</button></div>`).join('')||'<div class="muted">Your locker is empty.</div>';$('#inventoryItems').querySelectorAll('[data-equip]').forEach(b=>b.onclick=()=>equip(b.dataset.equip))}
function buy(id){const x=catalog.find(c=>c.id===id);if(!x)return;if(save.owned.includes(id)){equip(id);return}if(save.coins<x.cost){notify('Not enough fish coins!');return}save.coins-=x.cost;save.owned.push(id);save.equipped=id;applyPenguinColor();persist();notify('Purchased '+x.name+'!')}
function equip(id){if(!save.owned.includes(id))return;save.equipped=id;applyPenguinColor();persist();notify('Outfit equipped!')}
function showView(v){document.querySelectorAll('.view').forEach(e=>e.classList.remove('active'));$('#'+v+'View').classList.add('active');document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===v));$('#panel').classList.remove('hidden')}
document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>showView(b.dataset.view));

// Three.js world
const scene=new THREE.Scene();scene.background=new THREE.Color(0x9cc9e8);scene.fog=new THREE.Fog(0x9cc9e8,30,100);
const camera=new THREE.PerspectiveCamera(72,innerWidth/innerHeight,.05,180);camera.position.set(0,2.2,7);
const xrRig=new THREE.Group();scene.add(xrRig);xrRig.add(camera);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local-floor');renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;root.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xe7f5ff,0x4c6480,2));const sun=new THREE.DirectionalLight(0xffffff,2.1);sun.position.set(-8,15,8);sun.castShadow=true;scene.add(sun);
const mat=(c,r=.8)=>new THREE.MeshStandardMaterial({color:c,roughness:r});const ice=mat(0xd7f2ff),belly=mat(0xf4f8ff),beak=mat(0xffa72d),eye=mat(0x090d17),blue=mat(0x6655d9);
function addMesh(geo,m,x,y,z){const o=new THREE.Mesh(geo,m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;scene.add(o);return o}
const floor=addMesh(new THREE.CylinderGeometry(34,34,.65,64),ice,0,-.36,0);
const pond=addMesh(new THREE.CylinderGeometry(6,6,.12,48),mat(0x77c9ee,.25),0,-.02,-8);
const floes=[];for(let i=0;i<30;i++){const a=i/30*Math.PI*2,r=12+(i%4)*2;const p=addMesh(new THREE.DodecahedronGeometry(1.1+(i%4)*.2,0),mat(i%2?0xb9e4fa:0xeafaff),Math.cos(a)*r,-.04,Math.sin(a)*r);p.scale.y=.32;floes.push(p)}
for(let i=0;i<16;i++){const x=(Math.random()-.5)*48,z=(Math.random()-.5)*48;if(Math.hypot(x,z)>7)addMesh(new THREE.ConeGeometry(.6+Math.random()*.8,1.4+Math.random()*2,6),mat(0xf0fbff),x,.25,z)}
// Ice arch and decorative igloos
for(const x of [-2.2,2.2])addMesh(new THREE.CylinderGeometry(.18,.22,3,10),blue,x,1.4,-13);addMesh(new THREE.BoxGeometry(4.6,.35,.4),blue,0,2.85,-13);
for(let i=0;i<5;i++){const x=-18+i*9;addMesh(new THREE.SphereGeometry(1.35,16,10,0,Math.PI*2,0,Math.PI/2),mat(0xeaf7ff),x,.0,-20);addMesh(new THREE.BoxGeometry(1.4,.6,.3),mat(0x9acbe7),x,.4,-18.9)}
function makePenguin(color=0x202a42){const g=new THREE.Group();const body=new THREE.Mesh(new THREE.SphereGeometry(.48,20,16),mat(color));body.scale.set(.82,1.15,.68);body.position.y=.78;body.castShadow=true;g.add(body);const tummy=new THREE.Mesh(new THREE.SphereGeometry(.37,18,14),belly);tummy.scale.set(.83,1.05,.28);tummy.position.set(0,.76,-.26);g.add(tummy);const head=new THREE.Mesh(new THREE.SphereGeometry(.35,18,14),mat(color));head.position.set(0,1.55,-.02);g.add(head);for(const x of [-.13,.13]){const e=new THREE.Mesh(new THREE.SphereGeometry(.045,10,8),eye);e.position.set(x,1.59,-.33);g.add(e)}const b=new THREE.Mesh(new THREE.ConeGeometry(.12,.28,8),beak);b.rotation.x=Math.PI/2;b.position.set(0,1.48,-.39);g.add(b);const wings=[];for(const x of [-.43,.43]){const w=new THREE.Mesh(new THREE.CapsuleGeometry(.12,.55,4,8),mat(color));w.position.set(x,.85,0);w.rotation.z=x<0?-.28:.28;g.add(w);wings.push(w)}for(const x of [-.2,.2]){const f=new THREE.Mesh(new THREE.BoxGeometry(.25,.09,.35),beak);f.position.set(x,.08,-.06);g.add(f)}g.userData.wings=wings;return g}
const player=makePenguin(catalog.find(x=>x.id===save.equipped)?.color||0x202a42);scene.add(player);player.position.set(0,0,3);
function applyPenguinColor(){const c=catalog.find(x=>x.id===save.equipped)?.color||0x202a42;for(const i of [0,2,6,7])player.children[i].material=mat(c)}
const botColors=[0x5546a8,0x2584a4,0x7c536f,0x344c6e,0x9b663b,0x43834c,0x9b4777];const bots=[];for(let i=0;i<7;i++){const p=makePenguin(botColors[i]);p.position.set((Math.random()-.5)*18,0,-2-Math.random()*18);scene.add(p);bots.push({mesh:p,phase:Math.random()*6,speed:.4+Math.random()*.5,home:p.position.clone(),role:'wander',tagged:false})}
// Snowballs and mode checkpoints
const snowballs=[];function throwSnowball(){const dir=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw)).normalize();const start=player.position.clone().add(new THREE.Vector3(0,1.25,0));const mesh=addMesh(new THREE.SphereGeometry(.17,10,8),mat(0xffffff),start.x,start.y,start.z);snowballs.push({mesh,vel:dir.multiplyScalar(13).add(new THREE.Vector3(0,2,0)),life:2.5})}
const checkpoints=[];for(let i=0;i<5;i++){const a=i/5*Math.PI*2;const ring=new THREE.Mesh(new THREE.TorusGeometry(1.05,.12,8,24),mat(0xffd45a));ring.position.set(Math.cos(a)*13,.9,Math.sin(a)*13);ring.rotation.x=Math.PI/2;ring.visible=false;scene.add(ring);checkpoints.push(ring)}
const crown=addMesh(new THREE.TorusGeometry(2.8,.14,8,32),mat(0xffd34d),0,.15,-8);crown.rotation.x=Math.PI/2;crown.visible=false;
// Desktop / mobile / XR controls
const keys={};let yaw=0,pitch=0,locked=false,hop=0,mode='lobby',round=null,gameScore=0,gameTime=0,checkpoint=0,paintHits=0;addEventListener('keydown',e=>{keys[e.code]=true;if(['Space','ArrowUp','ArrowDown'].includes(e.code))e.preventDefault()});addEventListener('keyup',e=>keys[e.code]=false);renderer.domElement.addEventListener('click',()=>{if(!renderer.xr.isPresenting&&mode==='paint')throwSnowball();else if(!renderer.xr.isPresenting)renderer.domElement.requestPointerLock?.()});document.addEventListener('pointerlockchange',()=>locked=document.pointerLockElement===renderer.domElement);document.addEventListener('mousemove',e=>{if(locked){yaw-=e.movementX*.002*save.sensitivity;pitch=Math.max(-.8,Math.min(.8,pitch-e.movementY*.002*save.sensitivity))}});
const controllers=[renderer.xr.getController(0),renderer.xr.getController(1)];controllers.forEach(c=>xrRig.add(c));const grips=[renderer.xr.getControllerGrip(0),renderer.xr.getControllerGrip(1)];grips.forEach(g=>xrRig.add(g));const previousHands=[new THREE.Vector3(),new THREE.Vector3()];let handsReady=false;const locomotionVelocity=new THREE.Vector3();let grounded=false;const handContact=[false,false];renderer.xr.addEventListener('sessionstart',()=>{document.body.classList.add('vr-active');xrRig.position.set(player.position.x,0,player.position.z);xrRig.rotation.set(0,0,0);camera.position.set(0,0,0);camera.rotation.set(0,0,0);handsReady=false;locomotionVelocity.set(0,0,0);connectPublicRoom();notify('VR ready — push off the ice with your flippers to move!')});renderer.xr.addEventListener('sessionend',()=>{document.body.classList.remove('vr-active');if(netSocket){netSocket.close();netSocket=null}netReady=false;clearRemotePlayers();xrRig.position.set(0,0,0);xrRig.rotation.set(0,0,0);camera.position.set(0,2.2,7);camera.rotation.set(0,0,0);handsReady=false;locomotionVelocity.set(0,0,0)});controllers.forEach(c=>c.addEventListener('select',()=>{if(mode==='paint')throwSnowball()}));
$('#jumpBtn').onclick=()=>hop=4.2;$('#throwBtn').onclick=throwSnowball;
function setMap(m){scene.background=new THREE.Color(m==='night'?0x111a45:m==='cove'?0x83cbe6:m==='summit'?0xc6dced:0x9cc9e8);scene.fog.color.copy(scene.background);notify('Map changed: '+$('#map').selectedOptions[0].text)}
$('#map').onchange=e=>setMap(e.target.value);
function startMode(next){mode=next;gameScore=0;gameTime=next==='lobby'?0:90;checkpoint=0;paintHits=0;round={active:next!=='lobby',ended:false,tagged:false,king:0,elapsed:0};$('#modePill').textContent=next.toUpperCase();$('#gameTitle').textContent=({lobby:'Social Lobby',tag:'Penguin Tag',hide:'Hide & Seek',infection:'Infection',king:'King of the Ice',race:'Iceberg Race',paint:'Snowball Paint'})[next];$('#gameDescription').textContent=({lobby:'Explore the frozen island and meet the local penguins.',tag:'Avoid the seeker penguin. Stay free until the timer ends.',hide:'Hide from the seeker penguins until the timer runs out.',infection:'Survive the infected penguins. Keep moving!',king:'Stand inside the golden ring to earn points.',race:'Run through all five golden checkpoints in order.',paint:'Throw snowballs at the practice penguins to score points.'})[next];$('#gameScore').textContent='0';$('#gameTimer').textContent=next==='lobby'?'Free roam':'90 seconds';$('#gameAction').textContent=next==='paint'?'THROW SNOWBALL':next==='race'?'NEXT CHECKPOINT':next==='king'?'CLAIM THE RING':'JUMP';$('#gameAction').onclick=()=>{if(mode==='paint')throwSnowball();else if(mode==='race')notify('Find the next golden ring!');else hop=4.2};$('#gameView').classList.add('active');document.querySelectorAll('.view').forEach(e=>{if(e.id!=='gameView')e.classList.remove('active')});$('#nav').classList.add('hidden');$('#panel').classList.remove('hidden');$('#hint').textContent=next==='paint'?'Click / trigger to throw snowballs':next==='race'?'Follow the golden rings in order':'Explore and complete your objective';crown.visible=next==='king';checkpoints.forEach(c=>c.visible=next==='race');bots.forEach((b,i)=>{b.role=(next==='tag'||next==='hide'||next==='infection')&&i<2?'seeker':'wander';b.tagged=false;b.mesh.position.copy(b.home)});if(next==='tag')bots[0].role='seeker';if(next==='hide')bots.slice(0,2).forEach(b=>b.role='seeker');if(next==='infection')bots[0].role='infected';if(next==='lobby'){$('#gameView').classList.remove('active');$('#nav').classList.remove('hidden');showView('home');$('#hint').textContent='Explore the island · Find your friends · Have fun!'}else notify($('#gameTitle').textContent+' started!')}
$('#play').onclick=()=>{setMap($('#map').value);startMode($('#mode').value)};$('#leaveGame').onclick=()=>startMode('lobby');
$('#daily').onclick=()=>{const d=new Date().toISOString().slice(0,10);if(save.claimedDay===d){notify('You already claimed today’s reward.');return}save.claimedDay=d;save.coins+=100;save.xp+=25;save.level=Math.floor(save.xp/100)+1;persist();notify('Daily reward: +100 fish coins and +25 XP!')};
$('#createRoom').onclick=()=>{const c=Math.random().toString(36).slice(2,8).toUpperCase();$('#roomCode').value=c;notify('Room code created for local preview: '+c)};$('#joinRoom').onclick=()=>notify('Room codes need the online multiplayer server to be hosted first.');$('#addFriend').onclick=()=>{const n=$('#friendName').value.trim().slice(0,18);if(!n)return notify('Enter a penguin name first.');if(n.toLowerCase()===save.name.toLowerCase())return notify('That is your own name!');if(!save.friends.includes(n))save.friends.push(n);persist();$('#friendName').value='';notify(n+' added to local friends.')};
$('#saveProfile').onclick=()=>{const n=$('#playerName').value.trim().slice(0,18);if(n)save.name=n;const idx=Number($('#playerColour').value);const c=catalog[idx]||catalog[0];if(save.owned.includes(c.id))save.equipped=c.id;else notify('That colour is not unlocked yet — buy it in the shop.');applyPenguinColor();persist();notify('Profile saved!')};
$('#ownerTools').onclick=()=>notify('Owner tools are locked until the first-ever owner is verified by the secure online server.');$('#volume').oninput=e=>save.volume=Number(e.target.value);$('#sensitivity').oninput=e=>{save.sensitivity=Number(e.target.value);persist()};$('#resetData').onclick=()=>{if(confirm('Delete your local PENGUIN VR save?')){localStorage.removeItem('penguinVRSave');location.reload()}};
// Round simulation
function distance(a,b){return a.position.distanceTo(b.position)}function finishRound(msg){if(!round||round.ended)return;round.ended=true;round.active=false;$('#gameDescription').textContent=msg;$('#gameTimer').textContent='ROUND COMPLETE';save.xp+=Math.max(10,gameScore*2+20);save.coins+=Math.max(15,gameScore*3+25);save.level=Math.floor(save.xp/100)+1;persist();if(netReady)netSend({type:'score',score:gameScore});notify('Round rewards added to your locker!')}

/* IN-WORLD VR LOBBY: all menus live on 3D objects, not screen overlays. */
document.body.classList.add('world-ui-only');
const worldStyle=document.createElement('style');
worldStyle.textContent=`
#panel,#nav,.hud,#hint,#toast,#status,#brand,.mobile-controls{display:none!important}
body.vr-active #vrGate{display:none!important}
body.vr-active #vrButton{display:none!important}
`;
document.head.appendChild(worldStyle);
function worldText(title,subtitle=''){
 const c=document.createElement('canvas');c.width=768;c.height=320;const x=c.getContext('2d');
 x.fillStyle='#101a35';x.fillRect(0,0,c.width,c.height);x.strokeStyle='#9bdcff';x.lineWidth=8;x.strokeRect(8,8,c.width-16,c.height-16);
 x.textAlign='center';x.fillStyle='#ffffff';x.font='bold 54px system-ui';x.fillText(title,384,132);
 x.fillStyle='#bfeaff';x.font='28px system-ui';x.fillText(subtitle,384,196);
 const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
 return new THREE.MeshBasicMaterial({map:tex,transparent:false});
}
function signBoard(title,subtitle,pos,w=4,h=1.6){
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),worldText(title,subtitle));mesh.position.copy(pos);scene.add(mesh);return mesh;
}
const portalDefs=[
 {map:'ice',name:'FROZEN ISLAND',sub:'TAG · RACE · SOCIAL',pos:new THREE.Vector3(-10,2,-12),color:0x6bdcff},
 {map:'cove',name:'PENGUIN COVE',sub:'HIDE & SEEK · INFECTION',pos:new THREE.Vector3(0,2,-19),color:0x43d8c5},
 {map:'summit',name:'SNOWY SUMMIT',sub:'KING OF THE ICE · RACE',pos:new THREE.Vector3(10,2,-12),color:0xffffff},
 {map:'night',name:'AURORA NIGHT',sub:'TAG · SOCIAL · EVENTS',pos:new THREE.Vector3(0,2,13),color:0x9a8cff}
];
const worldPortals=[];
for(const d of portalDefs){
 const ring=new THREE.Mesh(new THREE.TorusGeometry(1.65,.16,12,48),new THREE.MeshStandardMaterial({color:d.color,emissive:d.color,emissiveIntensity:1.3,roughness:.25}));
 ring.position.copy(d.pos);ring.rotation.y=Math.PI;scene.add(ring);
 const base=new THREE.Mesh(new THREE.CylinderGeometry(1.55,1.7,.22,40),mat(0x8ec9e8));base.position.set(d.pos.x,.12,d.pos.z);scene.add(base);
 const sign=signBoard(d.name,d.sub,new THREE.Vector3(d.pos.x,d.pos.y+2.25,d.pos.z),4.5,1.5);sign.rotation.y=Math.PI;
 worldPortals.push({...d,ring,inside:false});
}
signBoard('PENGUIN PLAZA','WALK TO A GATE TO JOIN THAT MAP',new THREE.Vector3(0,4,0),7,1.7);
const boardFrame=new THREE.Mesh(new THREE.BoxGeometry(4.8,3.1,.22),mat(0x233b61));boardFrame.position.set(-5,2,-5);scene.add(boardFrame);
const leaderboard=signBoard('TOP PENGUINS','LOCAL PREVIEW · ONLINE SCORES NOT CONNECTED',new THREE.Vector3(-5,2,-4.86),4.5,2.8);
const computerBase=new THREE.Mesh(new THREE.BoxGeometry(2.8,1.2,1.4),mat(0x344b70));computerBase.position.set(5,.62,-5);scene.add(computerBase);
const computerScreen=new THREE.Mesh(new THREE.PlaneGeometry(2.5,1.55),worldText('LOBBY COMPUTER','POINT A FLIPPER + PRESS TRIGGER'));computerScreen.position.set(5,1.85,-5.72);scene.add(computerScreen);
const computerButtons=[];
const modeOptions=[['TAG','tag'],['HIDE & SEEK','hide'],['INFECTION','infection'],['KING OF ICE','king'],['ICEBERG RACE','race'],['SNOWBALL PAINT','paint']];
modeOptions.forEach((o,i)=>{
 const col=i%3,row=Math.floor(i/3),x=4+col*1.05,z=-4.3+row*.9;
 const b=new THREE.Mesh(new THREE.BoxGeometry(.9,.18,.65),new THREE.MeshStandardMaterial({color:0x536f9f,emissive:0x172d55}));
 b.position.set(x,.22,z);b.userData.mode=o[1];scene.add(b);computerButtons.push(b);
 const s=signBoard(o[0],'SELECT MODE',new THREE.Vector3(x,.75,z),1.15,.42);s.rotation.x=-.18;
});

const worldKioskButtons=[];
const shopFrame=new THREE.Mesh(new THREE.BoxGeometry(4.6,2.8,.22),mat(0x273b62));shopFrame.position.set(0,2,5);scene.add(shopFrame);
const shopScreen=signBoard('PENGUIN STYLE SHOP','POINT + TRIGGER TO BUY / EQUIP',new THREE.Vector3(0,2,4.84),4.35,2.55);
const kioskItems=['purple','ocean','gold','ice'];
kioskItems.forEach((id,i)=>{const item=catalog.find(v=>v.id===id),x=-1.55+(i%2)*3.1,z=5.8+Math.floor(i/2)*1.05;
 const b=new THREE.Mesh(new THREE.BoxGeometry(1.25,.2,.72),new THREE.MeshStandardMaterial({color:item.color,emissive:item.color,emissiveIntensity:.18}));b.position.set(x,.22,z);b.userData.shop=id;scene.add(b);worldKioskButtons.push(b);
 const label=signBoard(item.name,'FISH '+item.cost,new THREE.Vector3(x,.9,z),1.8,.62);label.rotation.x=-.25;
});
const ownerButtons=[];
const ownerFrame=new THREE.Mesh(new THREE.BoxGeometry(4.6,2.5,.22),mat(0x302a4f));ownerFrame.position.set(-9,2,5);scene.add(ownerFrame);
const ownerScreen=signBoard('STAFF CONSOLE','FIRST PLAYER OWNER ONLY',new THREE.Vector3(-9,2,4.84),4.35,2.25);
[['ANNOUNCE','announce'],['MUTE NEAREST','mute'],['KICK NEAREST','kick']].forEach((v,i)=>{const b=new THREE.Mesh(new THREE.BoxGeometry(1.25,.2,.72),new THREE.MeshStandardMaterial({color:0x8056a8,emissive:0x32194e}));b.position.set(-10.4+i*1.4,.22,5.8);b.userData.ownerAction=v[1];scene.add(b);ownerButtons.push(b);const t=signBoard(v[0],'STAFF',new THREE.Vector3(-10.4+i*1.4,.9,5.8),1.6,.55);t.rotation.x=-.2});
const questBoard=signBoard('DAILY QUEST','VISIT 2 MAP GATES · EARN 75 FISH',new THREE.Vector3(9,2,4),3.8,1.5);
const ownerBoard=signBoard('PENGUIN STAFF','OWNER POWERS REQUIRE VERIFIED FIRST JOIN',new THREE.Vector3(-9,2,4),4.2,1.5);
const boardEntries=['1  ICEKING     2450','2  PINGU       1980','3  SNOWFLAKE   1760','4  FROSTY      1520','5  WADDLES     1200'];
const boardCanvas=document.createElement('canvas');boardCanvas.width=768;boardCanvas.height=512;
function drawBoard(){
 const c=boardCanvas.getContext('2d');c.fillStyle='#101a35';c.fillRect(0,0,768,512);c.fillStyle='#fff';c.font='bold 48px system-ui';c.fillText('LEADERBOARD',40,68);
 c.font='30px system-ui';c.fillStyle='#c7e9ff';boardEntries.forEach((v,i)=>c.fillText(v,45,140+i*66));
 c.font='20px system-ui';c.fillStyle='#8fb4d9';c.fillText('LOCAL DEMO SCORES — LIVE SERVER REQUIRED',40,470);
 const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;leaderboard.material.map=tex;leaderboard.material.needsUpdate=true;
}
drawBoard();
const raycaster=new THREE.Raycaster(),controllerRays=controllers.map(()=>new THREE.Group());
controllers.forEach((controller,i)=>{
 const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0),new THREE.Vector3(0,0,-5)]),new THREE.LineBasicMaterial({color:0x9eeaff}));
 controller.add(line);controller.userData.ray=line;
 controller.addEventListener('select',()=>{
  if(!renderer.xr.isPresenting)return;
  const origin=new THREE.Vector3(),direction=new THREE.Vector3(0,0,-1);
  controller.getWorldPosition(origin);direction.applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion()));
  raycaster.set(origin,direction);
  const interactables=[...computerButtons,...worldKioskButtons,...ownerButtons];
  const hit=raycaster.intersectObjects(interactables,false)[0];
  if(hit){if(hit.object.userData.mode){selectedWorldMode=hit.object.userData.mode;inWorldMode=selectedWorldMode;computerScreen.material=worldText('MODE: '+selectedWorldMode.toUpperCase(),'SELECTED · WALK THROUGH A MAP GATE');computerScreen.material.needsUpdate=true;}else if(hit.object.userData.ownerAction){if(!isVerifiedOwner){ownerScreen.material=worldText('OWNER ONLY','THIS ACCOUNT IS NOT THE VERIFIED OWNER');ownerScreen.material.needsUpdate=true;}else{const action=hit.object.userData.ownerAction;const nearest=[...remotePlayers.entries()].sort((a,b)=>a[1].mesh.position.distanceTo(xrRig.position)-b[1].mesh.position.distanceTo(xrRig.position))[0];netSend({type:'owner-action',action,target:nearest?.[0],message:'Welcome to PENGUIN VR!'});ownerScreen.material=worldText('STAFF ACTION SENT',action.toUpperCase());ownerScreen.material.needsUpdate=true;}}else if(hit.object.userData.shop){const item=catalog.find(v=>v.id===hit.object.userData.shop);if(item){if(save.owned.includes(item.id)){save.equipped=item.id;applyPenguinColor();persist();shopScreen.material=worldText('EQUIPPED: '+item.name,'YOUR PENGUIN STYLE IS UPDATED');}else if(save.coins>=item.cost){save.coins-=item.cost;save.owned.push(item.id);save.equipped=item.id;applyPenguinColor();persist();shopScreen.material=worldText('PURCHASED: '+item.name,'LOOKING FRESH!');}else shopScreen.material=worldText('NOT ENOUGH FISH','EARN COINS BY PLAYING');shopScreen.material.needsUpdate=true;}}}
 });
});
let inWorldMode='lobby',selectedWorldMode='tag',lastPortalJoin=0;
function updateWorldLobby(dt,xr){
 if(!xr)return;
 const p=xrRig.position;
 for(const gate of worldPortals){
  const near=Math.hypot(p.x-gate.pos.x,p.z-gate.pos.z)<1.55;
  gate.ring.material.emissiveIntensity=near?2.4:1.1;
  if(near&&!gate.inside&&performance.now()-lastPortalJoin>1800){
   gate.inside=true;lastPortalJoin=performance.now();
   setMap(gate.map);startMode(selectedWorldMode);inWorldMode=selectedWorldMode;if(netSocket)connectPublicRoom();
   computerScreen.material=worldText(gate.name+' · '+selectedWorldMode.toUpperCase(),'PUBLIC MATCHMAKING PLACEHOLDER · SERVER NOT LIVE');
   computerScreen.material.needsUpdate=true;
  }
  if(!near)gate.inside=false;
 }
}


/* Optional live public-room connection. Configure PENGUIN_SERVER_URL to enable it. */
const playerId=localStorage.getItem('penguinVRPlayerId')||crypto.randomUUID();
localStorage.setItem('penguinVRPlayerId',playerId);let networkPlayerId=playerId,ownerToken=localStorage.getItem('penguinVROwnerToken')||'';
let netSocket=null,netReady=false,lastNetSend=0,networkRoom='',isVerifiedOwner=false;
const remotePlayers=new Map();
function netSend(data){if(netSocket&&netSocket.readyState===WebSocket.OPEN)netSocket.send(JSON.stringify(data))}
function clearRemotePlayers(){for(const v of remotePlayers.values())scene.remove(v.mesh);remotePlayers.clear()}
function connectPublicRoom(){
 if(!window.PENGUIN_SERVER_URL||!renderer.xr.isPresenting)return;
 if(netSocket){netSocket.onclose=null;netSocket.close();netSocket=null}
 netReady=false;clearRemotePlayers();
 try{
  netSocket=new WebSocket(window.PENGUIN_SERVER_URL);
  netSocket.addEventListener('open',()=>{
   netSend({type:'join',playerId,ownerToken,name:save.name,map:$('#map').value,mode:mode==='lobby'?'social':mode,cosmetic:save.equipped});
  });
  netSocket.addEventListener('message',ev=>{
   let m;try{m=JSON.parse(ev.data)}catch{return}
   if(m.type==='welcome'){
    netReady=true;networkPlayerId=m.id;if(m.ownerToken){ownerToken=m.ownerToken;localStorage.setItem('penguinVROwnerToken',m.ownerToken)}networkRoom=m.room;isVerifiedOwner=!!m.isOwner;
    const status=m.isOwner?'OWNER · ONLINE':'PUBLIC ROOM · ONLINE';
    computerScreen.material=worldText('CONNECTED','ROOM '+m.room+' · '+status);computerScreen.material.needsUpdate=true;
    for(const p of m.players||[])if(p.id!==networkPlayerId){upsertRemote(p);if(networkPlayerId<p.id)callPeer(p.id,true);else callPeer(p.id,false);}
    if(m.leaderboard)updateLeaderboard(m.leaderboard);
   }else if(m.type==='player-joined'){upsertRemote(m.player);if(networkPlayerId<m.player.id)callPeer(m.player.id,true);else callPeer(m.player.id,false);}else if(m.type==='player-moved')upsertRemote(m.player);
   else if(m.type==='player-left'){const v=remotePlayers.get(m.id);if(v)scene.remove(v.mesh);remotePlayers.delete(m.id)}
   else if(m.type==='leaderboard')updateLeaderboard(m.entries||[]);else if(m.type==='signal')receiveSignal(m.from,m.signal);
   else if(m.type==='announcement'){computerScreen.material=worldText('ANNOUNCEMENT',m.message||'');computerScreen.material.needsUpdate=true}
   else if(m.type==='moderation'){if(m.action==='kick'){netSocket.close();computerScreen.material=worldText('REMOVED FROM ROOM','THE OWNER REMOVED YOU')}else if(m.action==='mute'){voiceMuted=true;setPushToTalk(false)}}
   else if(m.type==='chat')console.info('[PENGUIN CHAT]',m.name+': '+m.text);
  });
  netSocket.addEventListener('close',()=>{netReady=false;isVerifiedOwner=false;clearRemotePlayers()});
  netSocket.addEventListener('error',()=>{netReady=false});
 }catch(e){console.warn('PENGUIN VR connection failed',e)}
}
function upsertRemote(p){
 if(!p||p.id===networkPlayerId)return;
 let v=remotePlayers.get(p.id);
 if(!v){const mesh=makePenguin(catalog.find(c=>c.id===p.cosmetic)?.color||0x202a42);scene.add(mesh);v={mesh,target:new THREE.Vector3()};remotePlayers.set(p.id,v)}
 v.target.set(Number(p.x)||0,0,Number(p.z)||0);v.mesh.rotation.y=Number(p.yaw)||0;
}
function updateLeaderboard(entries){
 const c=boardCanvas.getContext('2d');c.fillStyle='#101a35';c.fillRect(0,0,768,512);c.fillStyle='#fff';c.font='bold 48px system-ui';c.fillText('MAP LEADERBOARD',40,68);c.font='30px system-ui';c.fillStyle='#c7e9ff';
 (entries||[]).slice(0,10).forEach((e,i)=>c.fillText((i+1)+'. '+String(e.name||'Pingu').slice(0,18)+'  '+(e.score||0),45,130+i*36));
 c.font='20px system-ui';c.fillStyle='#8fb4d9';c.fillText('SERVER SAVED SCORES',40,490);const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;leaderboard.material.map=tex;leaderboard.material.needsUpdate=true;
}
let voiceMuted=false,micStream=null,voicePeers=new Map(),pttHeld=false;
async function enableMic(){if(micStream)return true;try{micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});for(const pc of voicePeers.values())for(const track of micStream.getAudioTracks())pc.addTrack(track,micStream);return true}catch(e){console.warn('Microphone permission unavailable',e);return false}}
function peerFor(id){if(voicePeers.has(id))return voicePeers.get(id);const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});voicePeers.set(id,pc);if(micStream)for(const track of micStream.getAudioTracks())pc.addTrack(track,micStream);pc.onicecandidate=e=>{if(e.candidate)netSend({type:'signal',to:id,signal:{candidate:e.candidate}})};pc.ontrack=e=>{let audio=document.getElementById('voice-'+id);if(!audio){audio=document.createElement('audio');audio.id='voice-'+id;audio.autoplay=true;audio.playsInline=true;document.body.appendChild(audio)}audio.srcObject=e.streams[0]};return pc}
async function callPeer(id,offer=false){const pc=peerFor(id);if(offer){const d=await pc.createOffer();await pc.setLocalDescription(d);netSend({type:'signal',to:id,signal:{description:pc.localDescription}})}}
async function receiveSignal(id,signal){const pc=peerFor(id);if(signal.description){await pc.setRemoteDescription(signal.description);if(signal.description.type==='offer'){const answer=await pc.createAnswer();await pc.setLocalDescription(answer);netSend({type:'signal',to:id,signal:{description:pc.localDescription}})}}else if(signal.candidate){try{await pc.addIceCandidate(signal.candidate)}catch{}}}
function setPushToTalk(on){pttHeld=on;if(on)enableMic().then(ok=>{if(ok)for(const t of micStream.getAudioTracks())t.enabled=!voiceMuted});else if(micStream)for(const t of micStream.getAudioTracks())t.enabled=false;}
controllers.forEach(c=>{c.addEventListener('squeezestart',()=>setPushToTalk(true));c.addEventListener('squeezeend',()=>setPushToTalk(false));});

const clock=new THREE.Clock();function animate(){const dt=Math.min(clock.getDelta(),.04),t=clock.elapsedTime,xr=renderer.xr.isPresenting;
 if(!xr){player.visible=false;$('#status').textContent='VR REQUIRED · ENTER IMMERSIVE MODE';}else{player.visible=true;const head=renderer.xr.getCamera(camera),dir=new THREE.Vector3();head.getWorldDirection(dir);yaw=Math.atan2(-dir.x,-dir.z);// Keep hand history in rig-local space so moving the player rig does not cancel the hand stroke.
 const handNow=grips.map(g=>{const p=new THREE.Vector3();g.getWorldPosition(p);xrRig.worldToLocal(p);return p});
 if(!handsReady){handNow.forEach((p,i)=>previousHands[i].copy(p));handsReady=true}
 else{
  const pushSum=new THREE.Vector3();let contacts=0;
  for(let i=0;i<handNow.length;i++){
   const p=handNow[i],prev=previousHands[i],delta=prev.clone().sub(p);
   // Hands push against the ice when they are near floor level; side boundaries act as walls.
   const worldHand=p.clone().applyMatrix4(xrRig.matrixWorld);
   const touchingFloor=p.y<.62;
   const touchingWall=Math.abs(worldHand.x)>28.5||Math.abs(worldHand.z)>28.5;
   if(touchingFloor||touchingWall){
    const push=delta.applyQuaternion(xrRig.quaternion);
    pushSum.add(push);contacts++;handContact[i]=true;
   }else handContact[i]=false;
   previousHands[i].copy(p);
  }
  if(contacts){
   // Convert tracked hand displacement into a frame-rate-independent player impulse.
   locomotionVelocity.addScaledVector(pushSum,0.9/dt);
   const horizontal=Math.hypot(locomotionVelocity.x,locomotionVelocity.z);
   if(horizontal>8){locomotionVelocity.x*=8/horizontal;locomotionVelocity.z*=8/horizontal}
   locomotionVelocity.y=THREE.MathUtils.clamp(locomotionVelocity.y,-7,7);
  }
 }
 // Gravity, momentum, ground response and friction.
 locomotionVelocity.y-=9.8*dt;
 xrRig.position.addScaledVector(locomotionVelocity,dt);
 if(xrRig.position.y<0){xrRig.position.y=0;if(locomotionVelocity.y<0)locomotionVelocity.y=0;grounded=true}else grounded=false;
 const drag=Math.exp(-1.15*dt);locomotionVelocity.x*=drag;locomotionVelocity.z*=drag;
 if(Math.abs(locomotionVelocity.x)+Math.abs(locomotionVelocity.z)<.015){locomotionVelocity.x=0;locomotionVelocity.z=0;}
 if(xrRig.position.x<-29||xrRig.position.x>29)locomotionVelocity.x*=-.25;if(xrRig.position.z<-29||xrRig.position.z>29)locomotionVelocity.z*=-.25;xrRig.position.x=THREE.MathUtils.clamp(xrRig.position.x,-29,29);xrRig.position.z=THREE.MathUtils.clamp(xrRig.position.z,-29,29);player.position.copy(xrRig.position);player.position.y=0;player.rotation.y=yaw;if(netReady&&performance.now()-lastNetSend>90){lastNetSend=performance.now();netSend({type:'move',x:xrRig.position.x,y:xrRig.position.y,z:xrRig.position.z,yaw});}}
 player.position.x=THREE.MathUtils.clamp(player.position.x,-29,29);player.position.z=THREE.MathUtils.clamp(player.position.z,-29,29);
 for(const b of bots){b.phase+=dt*b.speed;if(round?.active&&['tag','hide','infection'].includes(mode)&&b.role==='seeker'&&distance(b.mesh,player)<13){const d=player.position.clone().sub(b.mesh.position);d.y=0;if(d.lengthSq()>.01){d.normalize();b.mesh.position.addScaledVector(d,dt*(mode==='infection'?2.5:2.1));b.mesh.rotation.y=Math.atan2(-d.x,-d.z)}}else if(round?.active&&mode==='tag'&&b.role==='wander'){b.mesh.position.x+=Math.sin(b.phase)*dt*.3;b.mesh.position.z+=Math.cos(b.phase*.7)*dt*.25}else{b.mesh.position.x+=Math.sin(b.phase)*dt*.35;b.mesh.position.z+=Math.cos(b.phase*.7)*dt*.3}b.mesh.position.x=THREE.MathUtils.clamp(b.mesh.position.x,-30,30);b.mesh.position.z=THREE.MathUtils.clamp(b.mesh.position.z,-30,30);b.mesh.rotation.y+=dt*.1;}
 for(let i=snowballs.length-1;i>=0;i--){const s=snowballs[i];s.life-=dt;s.vel.y-=9.8*dt;s.mesh.position.addScaledVector(s.vel,dt);let hit=false;for(const b of bots)if(s.mesh.position.distanceTo(b.mesh.position.clone().add(new THREE.Vector3(0,1,0)))<.75){hit=true;paintHits++;gameScore++;$('#gameScore').textContent=gameScore;notify('Snowball hit! +1');break}if(s.life<=0||hit){scene.remove(s.mesh);snowballs.splice(i,1)}}
 if(round?.active&&!round.ended){round.elapsed+=dt;gameTime=Math.max(0,90-round.elapsed);$('#gameTimer').textContent=Math.ceil(gameTime)+' seconds left';if(mode==='king'&&Math.hypot(player.position.x,player.position.z+8)<3.2){round.king+=dt;gameScore=Math.floor(round.king*2);$('#gameScore').textContent=gameScore}if(mode==='race'&&player.position.distanceTo(checkpoints[checkpoint].position)<1.6){checkpoints[checkpoint].visible=false;checkpoint++;gameScore=checkpoint;$('#gameScore').textContent=gameScore;if(checkpoint<checkpoints.length)checkpoints[checkpoint].visible=true;else finishRound('You completed the iceberg race!')}if(['tag','hide','infection'].includes(mode)){const seeker=bots.find(b=>b.role==='seeker'||b.role==='infected');if(seeker&&distance(seeker.mesh,player)<.85){if(mode==='tag')finishRound('You were tagged! Try again and avoid the seeker.');else if(mode==='hide')finishRound('The seekers found you! Try hiding for longer.');else finishRound('You were infected! The colony got you.')}}if(gameTime<=0&&!round.ended)finishRound(mode==='king'?'Time up! Your ring score: '+gameScore:'You survived the round! Great job.')}
 for(const [id,v] of remotePlayers){v.mesh.position.lerp(v.target,Math.min(1,dt*12));const a=document.getElementById('voice-'+id);if(a){const d=v.mesh.position.distanceTo(xrRig.position);a.volume=THREE.MathUtils.clamp(1-d/18,0,1);}}updateWorldLobby(dt,xr);player.userData.wings.forEach((w,i)=>{w.rotation.z=(i===0?-.28:.28)+Math.sin(t*7+(i* Math.PI))*0.12});if(!xr)$('#status').textContent='VR REQUIRED';else $('#status').textContent='QUEST VR · IMMERSIVE';renderer.render(scene,camera)}renderer.setAnimationLoop(animate);
const vr=VRButton.createButton(renderer);vr.id='vrButton';vr.textContent='ENTER QUEST VR';document.body.appendChild(vr);
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
refreshUI();$('#status').textContent='VR REQUIRED';
