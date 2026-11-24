
// Render WebSocket server
const WS_URL = "wss://watchtogether-devseizun.onrender.com";

const $ = id => document.getElementById(id);

const state = {
  ws: null,
  roomId: null,
  selfId: null,
  peers: new Map(),
  pcs: new Map(),
  localStream: null,
  cameraOn: false,
  micOn: true,
  facing: "user",
  yt: null,
  ytReady: false,
  ignoreSync: false
};

const home = $("home");
const room = $("room");

function randomRoom() {
  return "love-" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
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

function addSystem(text) {
  const p = document.createElement("div");
  p.className = "system-message";
  p.textContent = text;
  $("messages").appendChild(p);
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
  $("messages").scrollTop = $("messages").scrollHeight;
}

function connect(roomId, create) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.close();
  }

  const name = (prompt("What should we call you?", "Guest") || "Guest")
    .trim().slice(0, 24) || "Guest";

  state.roomId = roomId;
  state.ws = new WebSocket(WS_URL);

  const ws = state.ws;

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: "join",
      roomId,
      create,
      name
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
      showError(msg.message);
      return;
    }

    if (msg.type === "joined") {
      state.selfId = msg.id;
      home.hidden = true;
      room.hidden = false;

      history.replaceState({}, "", inviteUrl(roomId));

      $("onlineCount").textContent = msg.count + " online";

      msg.peers.forEach(p => state.peers.set(p.id, p.name));

      msg.peers.forEach(p => {
        if (state.selfId.localeCompare(p.id) < 0) {
          createOffer(p.id);
        }
      });

      return;
    }

    if (msg.type === "count") {
      $("onlineCount").textContent = msg.count + " online";
    }

    if (msg.type === "peer-joined") {
      state.peers.set(msg.id, msg.name);
      addSystem(`${msg.name} joined the room`);

      if (state.selfId.localeCompare(msg.id) < 0) {
        createOffer(msg.id);
      }
    }

    if (msg.type === "peer-left") {
      state.peers.delete(msg.id);
      closePeer(msg.id);
      addSystem("Someone left the room");
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

    if (msg.type === "signal") {
      await handleSignal(msg.from, msg.signal);
    }
  };

  ws.onerror = () => {
    showError("Could not connect to the Render room server. Check the Render service and URL.");
  };

  ws.onclose = () => {};
}

$("createBtn").onclick = () => {
  connect(randomRoom(), true);
};

$("joinBtn").onclick = () => {
  const id = parseRoom($("inviteInput").value);

  if (!id) {
    return showError("Paste an invitation link first.");
  }

  connect(id, false);
};

$("copyInvite").onclick = async () => {
  const link = inviteUrl(state.roomId);

  try {
    await navigator.clipboard.writeText(link);
    $("copyInvite").textContent = "Copied!";
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

function dialog(title, text, placeholder, callback) {
  $("dialogTitle").textContent = title;
  $("dialogText").textContent = text;
  $("dialogInput").placeholder = placeholder;
  $("dialogInput").value = "";

  const d = $("promptDialog");
  d.showModal();

  $("dialogConfirm").onclick = e => {
    e.preventDefault();

    const value = $("dialogInput").value.trim();

    if (value) {
      d.close();
      callback(value);
    }
  };
}

$("youtubeBtn").onclick = () => {
  dialog(
    "Watch YouTube together",
    "Paste a YouTube video URL.",
    "https://youtube.com/watch?v=...",
    url => loadYouTube(url, true)
  );
};

$("linkBtn").onclick = () => {
  dialog(
    "Add an online video",
    "Paste a direct MP4/WebM URL.",
    "Direct video URL",
    url => loadDirectVideo(url, true)
  );
};

$("driveBtn").onclick = () => {
  dialog(
    "Google Drive video",
    "Drive playback depends on file permissions and Google delivery support.",
    "Google Drive share link",
    url => {
      const id =
        (url.match(/\/d\/([^/]+)/) ||
        url.match(/[?&]id=([^&]+)/) || [])[1];

      if (!id) return showError("Invalid Google Drive file link.");

      loadDirectVideo(
        `https://drive.google.com/uc?export=download&id=${id}`,
        true
      );
    }
  );
};

$("fileBtn").onclick = () => $("fileInput").click();

$("fileInput").onchange = () => {
  const file = $("fileInput").files[0];
  if (!file) return;

  loadDirectVideo(URL.createObjectURL(file), false);

  addSystem("This local file plays only on your device; it is not transferred to other viewers.");
};

function getYouTubeId(url) {
  try {
    const u = new URL(url);

    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
    if (u.searchParams.get("v")) return u.searchParams.get("v");

    const match = u.pathname.match(/\/(embed|shorts)\/([^/]+)/);

    return match ? match[2] : null;
  } catch {
    return null;
  }
}

function loadYouTube(url, broadcast) {
  const id = getYouTubeId(url);

  if (!id) return showError("Please enter a valid YouTube URL.");

  $("emptyPlayer").hidden = true;
  $("videoPlayer").hidden = true;
  $("youtubeWrap").hidden = false;

  if (state.ytReady) {
    if (state.yt) {
      state.yt.loadVideoById(id);
    } else {
      state.yt = new YT.Player("youtubePlayer", {
        videoId: id
      });
    }
  } else {
    window.pendingYT = id;
  }

  if (broadcast) send({ type: "youtube", url });

  $("playStatus").textContent = "YouTube video selected";
}

window.onYouTubeIframeAPIReady = () => {
  state.ytReady = true;

  if (window.pendingYT) {
    state.yt = new YT.Player("youtubePlayer", {
      videoId: window.pendingYT
    });

    window.pendingYT = null;
  }
};

function loadDirectVideo(url, broadcast) {
  $("youtubeWrap").hidden = true;
  $("emptyPlayer").hidden = true;

  const video = $("videoPlayer");

  video.hidden = false;
  video.src = url;
  video.load();

  $("playStatus").textContent = "Online video selected";

  if (broadcast) {
    send({ type: "sync", kind: "direct", url });
  }
}

$("videoPlayer").addEventListener("play", () => {
  if (!state.ignoreSync) {
    send({
      type: "sync",
      kind: "direct-control",
      action: "play",
      time: $("videoPlayer").currentTime
    });
  }
});

$("videoPlayer").addEventListener("pause", () => {
  if (!state.ignoreSync) {
    send({
      type: "sync",
      kind: "direct-control",
      action: "pause",
      time: $("videoPlayer").currentTime
    });
  }
});

$("videoPlayer").addEventListener("seeked", () => {
  if (!state.ignoreSync) {
    send({
      type: "sync",
      kind: "direct-control",
      action: "seek",
      time: $("videoPlayer").currentTime
    });
  }
});

function applySync(msg) {
  if (msg.kind === "direct") {
    loadDirectVideo(msg.url, false);
    return;
  }

  if (msg.kind === "direct-control") {
    const video = $("videoPlayer");

    state.ignoreSync = true;
    video.currentTime = msg.time || 0;

    if (msg.action === "play") {
      video.play().catch(() => {});
    } else if (msg.action === "pause") {
      video.pause();
    }

    setTimeout(() => state.ignoreSync = false, 600);
  }
}

$("leaveBtn").onclick = () => {
  stopMedia();

  if (state.ws) state.ws.close();

  location.href = location.pathname;
};

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

    $("micToggle").textContent = "Mute mic";
    $("cameraToggle").textContent = video ? "Turn camera off" : "Turn camera on";

    for (const pc of state.pcs.values()) {
      for (const track of stream.getTracks()) {
        const sender = pc.getSenders().find(s => s.track?.kind === track.kind);

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
  } else {
    state.localStream.getVideoTracks().forEach(t => t.stop());
    $("localVideo").srcObject = null;
    state.cameraOn = false;
    $("cameraToggle").textContent = "Turn camera on";
  }
};

$("micToggle").onclick = async () => {
  if (!state.localStream) await startMedia(false);

  if (!state.localStream) return;

  state.micOn = !state.micOn;

  state.localStream.getAudioTracks().forEach(t => {
    t.enabled = state.micOn;
  });

  $("micToggle").textContent = state.micOn ? "Mute mic" : "Unmute mic";
};

$("switchCamera").onclick = async () => {
  state.facing = state.facing === "user" ? "environment" : "user";

  if (state.cameraOn) await startMedia(true);
};

$("leaveCallBtn").onclick = stopMedia;

function stopMedia() {
  if (state.localStream) {
    state.localStream.getTracks().forEach(t => t.stop());
  }

  state.localStream = null;

  $("localVideo").srcObject = null;
  $("remoteVideo").srcObject = null;

  state.cameraOn = false;

  for (const id of [...state.pcs.keys()]) {
    closePeer(id);
  }
}

function makePeer(id) {
  if (state.pcs.has(id)) return state.pcs.get(id);

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  state.pcs.set(id, pc);

  if (state.localStream) {
    state.localStream.getTracks().forEach(track => {
      pc.addTrack(track, state.localStream);
    });
  }

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
    if (e.streams[0]) $("remoteVideo").srcObject = e.streams[0];
  };

  return pc;
}

async function createOffer(id) {
  const pc = makePeer(id);

  try {
    const offer = await pc.createOffer();

    await pc.setLocalDescription(offer);

    send({
      type: "signal",
      to: id,
      signal: { description: pc.localDescription }
    });
  } catch (e) {
    console.error(e);
  }
}

async function handleSignal(from, signal) {
  const pc = makePeer(from);

  try {
    if (signal.description) {
      await pc.setRemoteDescription(signal.description);

      if (signal.description.type === "offer") {
        const answer = await pc.createAnswer();

        await pc.setLocalDescription(answer);

        send({
          type: "signal",
          to: from,
          signal: { description: pc.localDescription }
        });
      }
    }

    if (signal.candidate) {
      await pc.addIceCandidate(signal.candidate);
    }
  } catch (e) {
    console.error("WebRTC signaling error", e);
  }
}

function closePeer(id) {
  const pc = state.pcs.get(id);

  if (pc) {
    pc.close();
    state.pcs.delete(id);
  }

  $("remoteVideo").srcObject = null;
}

const initialRoom = new URLSearchParams(location.search).get("room");

if (initialRoom) {
  $("inviteInput").value = inviteUrl(initialRoom);
}
