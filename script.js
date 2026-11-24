const $ = (id) => document.getElementById(id);
const state = { ws:null, roomId:null, selfId:null, peers:new Map(), pcs:new Map(), localStream:null, cameraOn:false, micOn:true, facing:"user", yt:null, ytReady:false, ignoreSync:false };
const home = $("home"), room = $("room");

function randomRoom(){ return "love-" + Math.random().toString(36).slice(2,8) + Math.random().toString(36).slice(2,5); }
function inviteUrl(id){ return location.origin + location.pathname + "?room=" + encodeURIComponent(id); }
function parseRoom(value){ try { const u = new URL(value); return u.searchParams.get("room") || value.trim(); } catch { return value.trim(); } }
function send(data){ if(state.ws && state.ws.readyState===WebSocket.OPEN) state.ws.send(JSON.stringify(data)); }
function showError(message){ alert(message); }
function addMessage(name,text,mine=false,image=null){
  const box=document.createElement("div"); box.className="bubble"+(mine?" mine":"");
  const who=document.createElement("b"); who.textContent=name; box.appendChild(who);
  if(image){ const img=document.createElement("img"); img.src=image; box.appendChild(img); }
  if(text){ const body=document.createElement("div"); body.textContent=text; box.appendChild(body); }
  $("messages").appendChild(box); $("messages").scrollTop=$("messages").scrollHeight;
}
function connect(roomId,create){
  const name=prompt("What should we call you?","Guest") || "Guest";
  const protocol=location.protocol==="https:"?"wss:":"ws:";
  state.ws=new WebSocket(`${protocol}//${location.host}`);
  state.roomId=roomId;
  state.ws.onopen=()=>send({type:"join",roomId,create,name});
  state.ws.onmessage=async(event)=>{
    const msg=JSON.parse(event.data);
    if(msg.type==="error"){showError(msg.message);state.ws.close();return;}
    if(msg.type==="joined"){
      state.selfId=msg.id; home.hidden=true; room.hidden=false;
      history.replaceState({}, "", inviteUrl(roomId));
      $("onlineCount").textContent=msg.count+" online";
      msg.peers.forEach(p=>state.peers.set(p.id,p.name));
      return;
    }
    if(msg.type==="count") $("onlineCount").textContent=msg.count+" online";
    if(msg.type==="peer-joined"){state.peers.set(msg.id,msg.name);addSystem(`${msg.name} joined the room`);}
    if(msg.type==="peer-left"){state.peers.delete(msg.id);closePeer(msg.id);addSystem("Someone left the room");}
    if(msg.type==="chat") addMessage(msg.name||"Guest",msg.text,false);
    if(msg.type==="photo") addMessage(msg.name||"Guest","",false,msg.data);
    if(msg.type==="youtube") loadYouTube(msg.url,false);
    if(msg.type==="sync") applySync(msg);
    if(msg.type==="signal") await handleSignal(msg.from,msg.signal);
  };
  state.ws.onclose=()=>{};
  state.ws.onerror=()=>showError("Connection failed. Please refresh and try again.");
}
function addSystem(text){const p=document.createElement("div");p.className="system-message";p.textContent=text;$("messages").appendChild(p);}
$("createBtn").onclick=()=>connect(randomRoom(),true);
$("joinBtn").onclick=()=>{const id=parseRoom($("inviteInput").value);if(!id)return showError("Paste an invitation link first.");connect(id,false);};
$("copyInvite").onclick=async()=>{try{await navigator.clipboard.writeText(inviteUrl(state.roomId));$("copyInvite").textContent="Copied!";}catch{prompt("Copy this invitation link:",inviteUrl(state.roomId));}};
$("chatForm").onsubmit=(e)=>{e.preventDefault();const text=$("messageInput").value.trim();if(!text)return;addMessage("You",text,true);send({type:"chat",text});$("messageInput").value="";};
$("photoBtn").onclick=()=>{const f=document.createElement("input");f.type="file";f.accept="image/*";f.onchange=()=>{const file=f.files[0];if(!file)return;if(file.size>700000) return showError("Please choose an image smaller than 700 KB.");const reader=new FileReader();reader.onload=()=>{addMessage("You","",true,reader.result);send({type:"photo",data:reader.result});};reader.readAsDataURL(file);};f.click();};

function dialog(title,text,placeholder,callback){$("dialogTitle").textContent=title;$("dialogText").textContent=text;$("dialogInput").placeholder=placeholder;$("dialogInput").value="";const d=$("promptDialog");d.showModal();$("dialogConfirm").onclick=(e)=>{e.preventDefault();const v=$("dialogInput").value.trim();if(!v)return;d.close();callback(v);};}
$("youtubeBtn").onclick=()=>dialog("Watch YouTube together","Paste a YouTube video URL.","https://youtube.com/watch?v=...",url=>{loadYouTube(url,true);});
$("linkBtn").onclick=()=>dialog("Add an online video","Paste a direct .mp4 or .webm video URL. Ordinary webpage links may not work.","Direct video URL",url=>loadDirectVideo(url,true));
$("driveBtn").onclick=()=>dialog("Google Drive video","Paste a Drive link. The file must be shared for viewing; some Drive links cannot play directly.","Google Drive link",url=>{const id=(url.match(/\/d\/([^/]+)/)||url.match(/[?&]id=([^&]+)/)||[])[1];if(!id)return showError("That doesn't look like a Google Drive file link.");loadDirectVideo(`https://drive.google.com/uc?export=download&id=${id}`,true);});
$("fileBtn").onclick=()=>$("fileInput").click();
$("selectVideoBtn").onclick=()=>$("fileInput").click();
$("fileInput").onchange=()=>{const f=$("fileInput").files[0];if(!f)return;loadDirectVideo(URL.createObjectURL(f),false);addSystem("This phone-only file is local to your device; it is not shared to other viewers.");};
function getYouTubeId(url){try{const u=new URL(url);if(u.hostname.includes("youtu.be"))return u.pathname.slice(1);if(u.searchParams.get("v"))return u.searchParams.get("v");const m=u.pathname.match(/\/(embed|shorts)\/([^/]+)/);return m?m[2]:null;}catch{return null;}}
function loadYouTube(url,broadcast){const id=getYouTubeId(url);if(!id)return showError("Please enter a valid YouTube video URL.");$("emptyPlayer").hidden=true;$("videoPlayer").hidden=true;$("youtubeWrap").hidden=false;if(state.ytReady){if(state.yt)state.yt.loadVideoById(id);else state.yt=new YT.Player("youtubePlayer",{videoId:id,events:{onReady:()=>{}}});}else window.pendingYT=id;if(broadcast)send({type:"youtube",url});$("playStatus").textContent="YouTube video selected";}
window.onYouTubeIframeAPIReady=()=>{state.ytReady=true;if(window.pendingYT){state.yt=new YT.Player("youtubePlayer",{videoId:window.pendingYT,events:{onReady:()=>{}}});window.pendingYT=null;}};
function loadDirectVideo(url,broadcast){$("youtubeWrap").hidden=true;$("emptyPlayer").hidden=true;const v=$("videoPlayer");v.hidden=false;v.src=url;v.load();$("playStatus").textContent="Online video selected";if(broadcast)send({type:"sync",kind:"direct",url});}
$("videoPlayer").addEventListener("play",()=>{if(!state.ignoreSync)send({type:"sync",kind:"direct-control",action:"play",time:$("videoPlayer").currentTime});});
$("videoPlayer").addEventListener("pause",()=>{if(!state.ignoreSync)send({type:"sync",kind:"direct-control",action:"pause",time:$("videoPlayer").currentTime});});
$("videoPlayer").addEventListener("seeked",()=>{if(!state.ignoreSync)send({type:"sync",kind:"direct-control",action:"seek",time:$("videoPlayer").currentTime});});
function applySync(msg){if(msg.kind==="direct"){loadDirectVideo(msg.url,false);return;}if(msg.kind==="direct-control"){const v=$("videoPlayer");state.ignoreSync=true;v.currentTime=msg.time||0;if(msg.action==="play")v.play().catch(()=>{});if(msg.action==="pause")v.pause();setTimeout(()=>state.ignoreSync=false,500);}}
$("leaveBtn").onclick=()=>{stopMedia();if(state.ws)state.ws.close();location.href=location.pathname;};

async function startMedia(video){
  if(!navigator.mediaDevices?.getUserMedia)return showError("Camera/microphone needs a supported browser and HTTPS.");
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:video?{facingMode:state.facing}:false});
    if(state.localStream)state.localStream.getTracks().forEach(t=>t.stop());
    state.localStream=stream;state.cameraOn=video;$("localVideo").srcObject=video?stream:null;
    $("micToggle").textContent="Mute mic";$("cameraToggle").textContent=video?"Turn camera off":"Turn camera on";
    for(const [id,pc] of state.pcs){stream.getTracks().forEach(track=>{if(!pc.getSenders().some(s=>s.track?.kind===track.kind))pc.addTrack(track,stream);else{const sender=pc.getSenders().find(s=>s.track?.kind===track.kind);sender.replaceTrack(track);}});}
  }catch(e){showError("Could not access camera/microphone: "+e.message);}
}
$("cameraToggle").onclick=async()=>{if(!state.localStream||!state.cameraOn){await startMedia(true);}else{state.localStream.getVideoTracks().forEach(t=>t.stop());$("localVideo").srcObject=null;state.cameraOn=false;$("cameraToggle").textContent="Turn camera on";}};
$("micToggle").onclick=async()=>{if(!state.localStream)await startMedia(false);if(!state.localStream)return;state.micOn=!state.micOn;state.localStream.getAudioTracks().forEach(t=>t.enabled=state.micOn);$("micToggle").textContent=state.micOn?"Mute mic":"Unmute mic";};
$("switchCamera").onclick=async()=>{state.facing=state.facing==="user"?"environment":"user";if(state.cameraOn)await startMedia(true);};
$("leaveCallBtn").onclick=stopMedia;
function stopMedia(){if(state.localStream)state.localStream.getTracks().forEach(t=>t.stop());state.localStream=null;$("localVideo").srcObject=null;$("remoteVideo").srcObject=null;state.cameraOn=false;for(const id of state.pcs.keys())closePeer(id);}
function makePeer(id){
  if(state.pcs.has(id))return state.pcs.get(id);
  const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});state.pcs.set(id,pc);
  if(state.localStream)state.localStream.getTracks().forEach(t=>pc.addTrack(t,state.localStream));
  pc.onicecandidate=e=>{if(e.candidate)send({type:"signal",to:id,signal:{candidate:e.candidate}});};
  pc.ontrack=e=>{if(e.streams[0])$("remoteVideo").srcObject=e.streams[0];};
  pc.onconnectionstatechange=()=>{if(pc.connectionState==="failed")pc.restartIce();};
  return pc;
}
async function handleSignal(from,sig){
  const pc=makePeer(from);
  try{
    if(sig.description){await pc.setRemoteDescription(sig.description);if(sig.description.type==="offer"){const answer=await pc.createAnswer();await pc.setLocalDescription(answer);send({type:"signal",to:from,signal:{description:pc.localDescription}});}}
    if(sig.candidate)await pc.addIceCandidate(sig.candidate);
  }catch(e){console.warn("WebRTC signal error",e);}
}
async function createOffer(id){
  const pc=makePeer(id);
  try{const offer=await pc.createOffer();await pc.setLocalDescription(offer);send({type:"signal",to:id,signal:{description:pc.localDescription}});}catch(e){console.warn(e);}
}
// Offer to newly joined peers only when our id sorts before theirs to reduce offer collisions.
const originalOnMessage = Object.getOwnPropertyDescriptor(WebSocket.prototype,"onmessage");
const oldConnect = connect;
connect = function(roomId,create){
  oldConnect(roomId,create);
  const ws=state.ws;
  const prev=ws.onmessage;
  ws.addEventListener("message",e=>{const m=JSON.parse(e.data);if(m.type==="joined"){m.peers.forEach(p=>{if(state.selfId<p.id)createOffer(p.id);});}if(m.type==="peer-joined"&&state.selfId<m.id)createOffer(m.id);});
};
const queryRoom=new URLSearchParams(location.search).get("room");
if(queryRoom) $("inviteInput").value=inviteUrl(queryRoom);
