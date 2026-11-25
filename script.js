// Render WebSocket server
const WS_URL = "wss://watchtogether-devseizun.onrender.com";

const $ = id => document.getElementById(id);

const state = {
  ws: null,
  roomId: null,
  selfId: null,
  name: "Guest",
  peers: new Map(),
  pcs: new Map(),
  localStream: null,
  cameraOn: false,
  micOn: true,
  facing: "user",
  yt: null,
  ytReady: false,
  pendingVideo: null,
  ignoreSync: false,
  stopReconnect: false
};

let reconnectAttempts = 0;
let reconnectTimer = null;

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
    // { urls: "turn:YOUR_TURN_SERVER:3478", username: "YOUR_USER", credential: "YOUR_PASS" }
  ]
};

const home = $("home");
const room = $("room");

function randomRoom() {
  let hex = "";

  try {
    hex = crypto.randomUUID().replace(/-/g, "");
  } catch {
    const buf = new Uint8Array(12);
    (crypto.getRandomValues || (a => a.map(() => Math.floor(Math.random() * 256))))(buf);
    hex = [...buf].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  return "love-" + hex.slice(0, 12);
}

function inviteUrl(id) {
  return location.origin + location.pathname + "?room=" + encodeURIComponent(id);
}

function parseRoom(value) {
  try {
    const u = new URL(value);
    return u.searchParams.get("room") || value.trim();
  } catch {
    return value.trim();
  }
}

function send(data) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(data));
  }
}

function showError(message) {
  alert(message);
}

function trimMessages() {
  const m = $("messages");

  while (m.children.length > 300) {
    m.firstChild.remove();
  }

  m.scrollTop = m.scrollHeight;
}

function addSystem(text) {
  const p = document.createElement("div");
  p.className = "system-message";
  p.textContent = text;
  $("messages").appendChild(p);
  trimMessages();
}

function addMessage(name, text, mine = false, image = null) {
  const box = document.createElement("div");
  box.className = "bubble" + (mine ? " mine" : "");

  const who = document.createElement("b");
  who.textContent = name;
  box.appendChild(who);

  if (image) {
    const img = document.createElement("img");
    img.src = image;
    box.appendChild(img);
  }

  if (text) {
    const body = document.createElement("div");
    body.textContent = text;
    box.appendChild(body);
  }

  $("messages").appendChild(box);
  trimMessages();
}

// Camera on ho ya koi remote cam ho -> chat ke andar box dikhe, chat apne aap neeche shift
function refreshCallArea() {
  const hasRemotes = $("remoteCams").children.length > 0;
  $("callArea").hidden = !(state.cameraOn || hasRemotes);
  $("localCamBox").style.display = state.cameraOn ? "" : "none";
}

function scheduleReconnect() {
  if (state.stopReconnect) return;

  if (reconnectAttempts >= 5) {
    addSystem("Couldn't reconnect. Please refresh the page.");
    return;
  }

  reconnectAttempts++;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => connect(state.roomId, true, true), 1500);
}

function connect(roomId, create, reconnect = false) {
  if (state.ws) {
    state.ws._replaced = true;
    state.ws.close();
  }

  if (!reconnect) {
    state.name = (prompt("What should we call you?", "Guest") || "Guest")
      .trim().slice(0, 24) || "Guest";
    state.stopReconnect = false;
    reconnectAttempts = 0;
  }

  clearTimeout(reconnectTimer);
  state.roomId = roomId;

  const ws = state.ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: "join",
      roomId,
      create,
      name: state.name
    }));
  };

  ws.onmessage = async event => {
    let msg;

    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === "error") {
      if (!room.hidden) {
        addSystem(msg.message);
        state.stopReconnect = true;
        clearTimeout(reconnectTimer);
      } else {
        showError(msg.message);
      }
      return;
    }

    if (msg.type === "joined") {
      for (const id of [...state.pcs.keys()]) closePeer(id);
      state.peers.clear();

      state.selfId = msg.id;
      state.stopReconnect = false;
      reconnectAttempts = 0;

      home.hidden = true;
      room.hidden = false;

      history.replaceState({}, "", inviteUrl(roomId));

      $("onlineCount").textContent = msg.count + " online";

      msg.peers.forEach(p => state.peers.set(p.id, p.name));

      if (msg.video) applyVideoState(msg.video);
      return;
    }

    if (msg.type === "count") {
      $("onlineCount").textContent = msg.count + " online";
    }

    if (msg.type === "peer-joined") {
      state.peers.set(msg.id, msg.name);
      addSystem(`${msg.name} joined the room`);
      makePeer(msg.id);
    }

    if (msg.type === "peer-left") {
      const name = state.peers.get(msg.id);
      state.peers.delete(msg.id);
      closePeer(msg.id);
      addSystem(`${name || "Someone"} left the room`);
    }

    if (msg.type === "chat") {
      addMessage(msg.name || "Guest", msg.text, false);
    }

    if (msg.type === "photo") {
      addMessage(msg.name || "Guest", "", false, msg.data);
    }

    if (msg.type === "youtube") {
      loadYouTube(msg.url, false);
    }

    if (msg.type === "sync") {
      applySync(msg);
    }

    if (msg.type === "call-ended") {
      removeRemoteBox(msg.from);
    }

    if (msg.type === "signal") {
      await handleSignal(msg.from, msg.signal);
    }
  };

  ws.onerror = () => {
    if (room.hidden) {
      showError("Could not connect to the Render room server. Check the Render service and URL.");
    }
  };

  ws.onclose = () => {
    if (ws._replaced || !state.roomId || room.hidden || state.stopReconnect) return;
    addSystem("Connection lost. Reconnecting...");
    scheduleReconnect();
  };
}

// 2nd PAGE (naya tab) dono cases me khulega
$("createBtn").onclick = () => {
  window.open(inviteUrl(randomRoom()), "_blank");
};

$("joinBtn").onclick = () => {
  const id = parseRoom($("inviteInput").value);

  if (!id) {
    return showError("Paste an invitation link first.");
  }

  // ✅ FIX: join bhi ab naye tab me khulta hai (same page pe nahi)
  window.open(inviteUrl(id), "_blank");
};

$("copyInvite").onclick = async () => {
  const link = inviteUrl(state.roomId);

  try {
    await navigator.clipboard.writeText(link);
    $("copyInvite").textContent = "Copied!";
    setTimeout(() => $("copyInvite").textContent = "Copy invite link", 1500);
  } catch {
    prompt("Copy invitation link:", link);
  }
};

$("chatForm").onsubmit = e => {
  e.preventDefault();

  const text = $("messageInput").value.trim();
  if (!text) return;

  addMessage("You", text, true);
  send({ type: "chat", text });

  $("messageInput").value = "";
};

$("photoBtn").onclick = () => {
  const f = document.createElement("input");
  f.type = "file";
  f.accept = "image/*";

  f.onchange = () => {
    const file = f.files[0];
    if (!file) return;

    if (file.size > 500000) {
      return showError("Choose an image smaller than 500 KB.");
    }

    const reader = new FileReader();

    reader.onload = () => {
      addMessage("You", "", true, reader.result);
      send({ type: "photo", data: reader.result });
    };

    reader.readAsDataURL(file);
  };

  f.click();
};

// ---------- Dialog ----------

let dialogCallback = null;

function openDialog(title, text, placeholder, callback) {
  $("dialogTitle").textContent = title;
  $("dialogText").textContent = text;
  $("dialogInput").placeholder = placeholder;
  $("dialogInput").value = "";
  dialogCallback = callback;

  $("promptDialog").showModal();
  setTimeout(() => $("dialogInput").focus(), 50);
}

function closeDialog(ok) {
  const d = $("promptDialog");

  if (ok) {
    const value = $("dialogInput").value.trim();
    if (!value) return;
    d.close();
    const cb = dialogCallback;
    dialogCallback = null;
    cb(value);
  } else {
    d.close();
    dialogCallback = null;
  }
}

$("dialogForm").onsubmit = e => {
  e.preventDefault();
  closeDialog(true);
};

document.querySelector("#promptDialog .x").onclick = () => closeDialog(false);

$("promptDialog").addEventListener("click", e => {
  if (e.target === $("promptDialog")) closeDialog(false);
});

$("youtubeBtn").onclick = () => {
  openDialog(
    "Watch YouTube together",
    "Paste a YouTube link — youtube.com, youtu.be, Shorts, sab chalenge.",
    "https://youtube.com/watch?v=...",
    url => loadYouTube(url, true)
  );
};

$("linkBtn").onclick = () => {
  openDialog(
    "Add an online video",
    "Paste a direct MP4/WebM video URL from any website.",
    "Direct video URL (ends with .mp4 / .webm)",
    url => {
      if (getYouTubeId(url)) {
        return loadYouTube(url, true);
      }

      if (location.protocol === "https:" && /^http:\/\//i.test(url)) {
        return showError("HTTP video link HTTPS page pe browser block kar deta hai. HTTPS wala link use karo.");
      }

      loadDirectVideo(url, true);
    }
  );
};

// ---------- YouTube ----------

function getYouTubeId(url) {
  try {
    const u = new URL(url);

    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0] || null;

    if (u.hostname.includes("youtube.com")) {
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      const m = u.pathname.match(/\/(embed|shorts|live)\/([^/?]+)/);
      return m ? m[2] : null;
    }

    return null;
  } catch {
    return null;
  }
}

function createYTPlayer(videoId, resume) {
  state.yt = new YT.Player("youtubePlayer", {
    videoId: videoId || undefined,
    playerVars: { rel: 0 },
    events: {
      onReady: () => {
        if (resume) ytApply(resume.time, resume.action);
      },
      onStateChange: onYTState
    }
  });
}

function ytApply(time, action) {
  if (!state.yt || !state.yt.seekTo) return;

  state.ignoreSync = true;

  try {
    state.yt.seekTo(time || 0, true);
    if (action === "play") state.yt.playVideo();
    else state.yt.pauseVideo();
  } catch (e) {}

  setTimeout(() => state.ignoreSync = false, 600);
}

function onYTState(e) {
  if (state.ignoreSync || !state.yt || !state.yt.getCurrentTime) return;

  if (e.data === YT.PlayerState.PLAYING) {
    send({ type: "sync", kind: "yt", action: "play", time: state.yt.getCurrentTime() });
  } else if (e.data === YT.PlayerState.PAUSED) {
    send({ type: "sync", kind: "yt", action: "pause", time: state.yt.getCurrentTime() });
  }
}

function loadYouTube(url, broadcast, resume) {
  const id = getYouTubeId(url);

  if (!id) return showError("Please enter a valid YouTube URL.");

  $("emptyPlayer").hidden = true;
  $("videoPlayer").hidden = true;
  $("youtubeWrap").hidden = false;

  const start = resume || { time: 0, action: "pause" };

  if (state.ytReady && state.yt && state.yt.loadVideoById) {
    state.ignoreSync = true;
    state.yt.loadVideoById(id);
    if (start.action === "play") state.yt.playVideo();
    else state.yt.pauseVideo();
    setTimeout(() => state.ignoreSync = false, 600);
  } else {
    state.pendingVideo = { id, ...start };
    if (state.ytReady && !state.yt) createYTPlayer(id, start);
  }

  if (broadcast) send({ type: "youtube", url });

  $("playStatus").textContent = "YouTube video selected";
}

window.onYouTubeIframeAPIReady = () => {
  state.ytReady = true;

  if (state.pendingVideo) {
    const pv = state.pendingVideo;
    state.pendingVideo = null;
    createYTPlayer(pv.id, pv);
  }
};

// ---------- Direct video ----------

function loadDirectVideo(url, broadcast) {
  $("youtubeWrap").hidden = true;
  $("emptyPlayer").hidden = true;

  if (state.yt && state.yt.stopVideo) {
    state.ignoreSync = true;
    try { state.yt.stopVideo(); } catch (e) {}
    setTimeout(() => state.ignoreSync = false, 600);
  }

  const video = $("videoPlayer");

  video.hidden = false;
  video.src = url;
  video.load();

  $("playStatus").textContent = "Online video selected";

  if (broadcast) {
    video.play().catch(() => {});
    send({ type: "sync", kind: "direct", url });
  }
}

$("videoPlayer").addEventListener("play", () => {
  if (!state.ignoreSync) {
    send({ type: "sync", kind: "direct-control", action: "play", time: $("videoPlayer").currentTime });
  }
});

$("videoPlayer").addEventListener("pause", () => {
  if (!state.ignoreSync) {
    send({ type: "sync", kind: "direct-control", action: "pause", time: $("videoPlayer").currentTime });
  }
});

$("videoPlayer").addEventListener("seeked", () => {
  if (!state.ignoreSync) {
    send({ type: "sync", kind: "direct-control", action: "seek", time: $("videoPlayer").currentTime });
  }
});

$("videoPlayer").addEventListener("error", () => {
  if (!$("videoPlayer").hidden && $("videoPlayer").src) {
    $("playStatus").textContent = "Couldn't load that video — link direct MP4/WebM nahi hai ya block ho raha hai.";
    showError("Video load nahi hui. Link direct video file (.mp4/.webm) honi chahiye, website ka page URL nahi.");
  }
});

// ---------- Sync ----------

function applySync(msg) {
  if (msg.kind === "direct") {
    loadDirectVideo(msg.url, false);
    return;
  }

  if (msg.kind === "direct-control") {
    const video = $("videoPlayer");
    if (video.hidden) return;

    state.ignoreSync = true;
    video.currentTime = msg.time || 0;

    if (msg.action === "play") {
      video.play().catch(() => {});
    } else {
      video.pause();
    }

    setTimeout(() => state.ignoreSync = false, 600);
    return;
  }

  if (msg.kind === "yt") {
    if (state.ytReady && state.yt && state.yt.seekTo) {
      ytApply(msg.time, msg.action);
    } else if (state.pendingVideo) {
      state.pendingVideo.time = msg.time;
      state.pendingVideo.action = msg.action;
    }
  }
}

function applyVideoState(v) {
  if (!v) return;

  if (v.kind === "yt") {
    loadYouTube(v.url, false, { time: v.time, action: v.action });
  } else if (v.kind === "direct") {
    loadDirectVideo(v.url, false);

    if (typeof v.time === "number" && v.time > 0) {
      const video = $("videoPlayer");

      const seek = () => {
        state.ignoreSync = true;
        video.currentTime = v.time;
        if (v.action === "play") video.play().catch(() => {});
        else video.pause();
        setTimeout(() => state.ignoreSync = false, 600);
      };

      if (video.readyState >= 1) seek();
      else video.addEventListener("loadedmetadata", seek, { once: true });
    }
  }
}

// ---------- Exit (top bar) ----------

$("leaveBtnTop").onclick = () => {
  state.stopReconnect = true;
  state.roomId = null;
  clearTimeout(reconnectTimer);
  stopMedia();

  if (state.ws) {
    state.ws._replaced = true;
    state.ws.close();
  }

  location.href = location.pathname;
};

// ---------- Mic / Camera (top bar) ----------

async function startMedia(video) {
  if (!navigator.mediaDevices?.getUserMedia) {
    return showError("Camera/microphone requires HTTPS and browser permission.");
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: video ? { facingMode: state.facing } : false
    });

    if (state.localStream) {
      state.localStream.getTracks().forEach(t => t.stop());
    }

    state.localStream = stream;
    state.cameraOn = video;

    $("localVideo").srcObject = video ? stream : null;

    stream.getAudioTracks().forEach(t => t.enabled = state.micOn);

    $("micToggle").textContent = state.micOn ? "🎤 Mic" : "🔇 Muted";
    $("cameraToggle").textContent = video ? "🚫 Cam off" : "📷 Camera";

    refreshCallArea();

    for (const pc of state.pcs.values()) {
      for (const track of stream.getTracks()) {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === track.kind);

        if (sender) {
          await sender.replaceTrack(track);
        } else {
          pc.addTrack(track, stream);
        }
      }
    }
  } catch (e) {
    showError("Camera/microphone error: " + e.message);
  }
}

$("cameraToggle").onclick = async () => {
  if (!state.localStream || !state.cameraOn) {
    await startMedia(true);
    return;
  }

  // Camera off (voice chat chalti rehti hai)
  const stream = state.localStream;

  stream.getVideoTracks().forEach(t => {
    t.stop();
    stream.removeTrack(t);
  });

  state.cameraOn = false;
  $("localVideo").srcObject = null;
  $("cameraToggle").textContent = "📷 Camera";

  refreshCallArea();

  for (const pc of state.pcs.values()) {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
    if (sender) sender.replaceTrack(null).catch(() => {});
  }
};

$("micToggle").onclick = async () => {
  if (!state.localStream) await startMedia(false);
  if (!state.localStream) return;

  state.micOn = !state.micOn;

  state.localStream.getAudioTracks().forEach(t => {
    t.enabled = state.micOn;
  });

  $("micToggle").textContent = state.micOn ? "🎤 Mic" : "🔇 Muted";
};

function stopMedia() {
  if (state.localStream) {
    state.localStream.getTracks().forEach(t => t.stop());
  }

  state.localStream = null;
  state.cameraOn = false;

  $("localVideo").srcObject = null;
  $("remoteCams").innerHTML = "";

  refreshCallArea();

  for (const id of [...state.pcs.keys()]) {
    closePeer(id);
  }
}

function ensureRemoteBox(id) {
  let box = document.getElementById("cam-" + id);

  if (!box) {
    box = document.createElement("div");
    box.className = "cam-box";
    box.id = "cam-" + id;

    const v = document.createElement("video");
    v.autoplay = true;
    v.playsInline = true;

    const s = document.createElement("span");
    s.textContent = state.peers.get(id) || "Guest";

    box.append(v, s);
    box._video = v;

    $("remoteCams").appendChild(box);
    refreshCallArea();
  }

  return box;
}

function removeRemoteBox(id) {
  const b = document.getElementById("cam-" + id);
  if (b) {
    b.remove();
    refreshCallArea();
  }
}

function makePeer(id) {
  if (state.pcs.has(id)) return state.pcs.get(id);

  const pc = new RTCPeerConnection(RTC_CONFIG);

  pc._makingOffer = false;
  pc._polite = state.selfId.localeCompare(id) > 0;

  state.pcs.set(id, pc);

  if (state.localStream) {
    state.localStream.getTracks().forEach(track => {
      pc.addTrack(track, state.localStream);
    });
  }

  pc.onnegotiationneeded = async () => {
    try {
      pc._makingOffer = true;
      await pc.setLocalDescription(await pc.createOffer());
      send({
        type: "signal",
        to: id,
        signal: { description: pc.localDescription }
      });
    } catch (e) {
      console.error(e);
    } finally {
      pc._makingOffer = false;
    }
  };

  pc.onicecandidate = e => {
    if (e.candidate) {
      send({
        type: "signal",
        to: id,
        signal: { candidate: e.candidate }
      });
    }
  };

  pc.ontrack = e => {
    if (e.streams[0]) {
      const box = ensureRemoteBox(id);
      box._video.srcObject = e.streams[0];
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" && pc.restartIce) {
      pc.restartIce();
    }
  };

  return pc;
}

async function handleSignal(from, signal) {
  const pc = makePeer(from);

  try {
    if (signal.description) {
      const offerCollision =
        signal.description.type === "offer" &&
        (pc._makingOffer || pc.signalingState !== "stable");

      if (offerCollision && !pc._polite) return;

      await pc.setRemoteDescription(signal.description);

      if (signal.description.type === "offer") {
        await pc.setLocalDescription(await pc.createAnswer());
        send({
          type: "signal",
          to: from,
          signal: { description: pc.localDescription }
        });
      }
    }

    if (signal.candidate) {
      try {
        await pc.addIceCandidate(signal.candidate);
      } catch (e) {
        if (!pc._polite) throw e;
      }
    }
  } catch (e) {
    console.error("WebRTC signaling error", e);
  }
}

function closePeer(id) {
  const pc = state.pcs.get(id);

  if (pc) {
    try { pc.close(); } catch (e) {}
    state.pcs.delete(id);
  }

  removeRemoteBox(id);
}

// 2nd page (room wala tab) khulte hi auto-join
const initialRoom = new URLSearchParams(location.search).get("room");

if (initialRoom) {
  connect(initialRoom, true);
}
