const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const MAX_PEOPLE = 10;
const ROOM_IDLE_MS = 30 * 60 * 1000;
const RATE_WINDOW_MS = 4000;
const RATE_MAX_MSGS = 40;
const rooms = new Map();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json"
};

const server = http.createServer((req, res) => {
  let pathname;

  try {
    pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname
    );
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }

  if (pathname === "/") pathname = "/index.html";

  const file = path.resolve(ROOT, "." + pathname);

  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });

    res.end(data);
  });
});

const wss = new WebSocketServer({
  server,
  maxPayload: 1024 * 1024
});

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data, except) {
  for (const client of room.clients) {
    if (client !== except) send(client, data);
  }
}

function removeClient(ws) {
  const id = ws.roomId;
  if (!id) return;

  const room = rooms.get(id);
  ws.roomId = null;

  if (!room) return;

  room.clients.delete(ws);

  broadcast(room, {
    type: "peer-left",
    id: ws.id
  });

  if (room.clients.size === 0) {
    rooms.delete(id);
  } else {
    broadcast(room, {
      type: "count",
      count: room.clients.size
    });
  }
}

wss.on("connection", ws => {
  ws.id = Math.random().toString(36).slice(2, 12);
  ws.roomId = null;
  ws.isAlive = true;
  ws.msgTimes = [];

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", raw => {
    // Simple rate limit (flood protection)
    const now = Date.now();
    ws.msgTimes.push(now);
    ws.msgTimes = ws.msgTimes.filter(t => now - t < RATE_WINDOW_MS);
    if (ws.msgTimes.length > RATE_MAX_MSGS) return;

    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(ws, {
        type: "error",
        message: "Invalid message."
      });
    }

    if (msg.type === "join") {
      if (ws.roomId) {
        return send(ws, {
          type: "error",
          message: "Already joined a room."
        });
      }

      const roomId = String(msg.roomId || "")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 50);

      if (!roomId) {
        return send(ws, {
          type: "error",
          message: "Invalid room link."
        });
      }

      let room = rooms.get(roomId);

      if (!room) {
        if (!msg.create) {
          return send(ws, {
            type: "error",
            message: "Room not found. Ask the host to create a new room."
          });
        }

        room = {
          clients: new Set(),
          createdAt: Date.now(),
          lastActive: Date.now(),
          video: null
        };

        rooms.set(roomId, room);
      }

      if (room.clients.size >= MAX_PEOPLE) {
        return send(ws, {
          type: "error",
          message: "This room is full (maximum 10 people)."
        });
      }

      ws.roomId = roomId;
      ws.name = String(msg.name || "Guest")
        .trim()
        .slice(0, 24) || "Guest";

      room.lastActive = Date.now();

      const peers = [...room.clients].map(c => ({
        id: c.id,
        name: c.name
      }));

      room.clients.add(ws);

      send(ws, {
        type: "joined",
        id: ws.id,
        roomId,
        peers,
        count: room.clients.size,
        video: room.video
      });

      broadcast(room, {
        type: "peer-joined",
        id: ws.id,
        name: ws.name
      }, ws);

      broadcast(room, {
        type: "count",
        count: room.clients.size
      });

      return;
    }

    const room = rooms.get(ws.roomId);
    if (!room) return;

    room.lastActive = Date.now();

    if (msg.type === "signal") {
      const target = [...room.clients].find(c => c.id === msg.to);

      if (target) {
        send(target, {
          type: "signal",
          from: ws.id,
          signal: msg.signal
        });
      }

    } else if (msg.type === "call-ended") {
      broadcast(room, {
        type: "call-ended",
        from: ws.id
      }, ws);

    } else if (msg.type === "chat" && typeof msg.text === "string") {
      broadcast(room, {
        type: "chat",
        from: ws.id,
        name: ws.name,
        text: msg.text.slice(0, 1000)
      }, ws);

    } else if (
      msg.type === "photo" &&
      typeof msg.data === "string" &&
      msg.data.length <= 950000
    ) {
      broadcast(room, {
        type: "photo",
        from: ws.id,
        name: ws.name,
        data: msg.data
      }, ws);

    } else if (msg.type === "youtube" && typeof msg.url === "string") {
      const url = msg.url.slice(0, 2000);

      room.video = { kind: "yt", url, time: 0, action: "pause" };

      broadcast(room, {
        type: "youtube",
        from: ws.id,
        name: ws.name,
        url
      }, ws);

    } else if (msg.type === "sync") {
      // Room ki current video state naye joiner ke liye save karo
      if (msg.kind === "direct" && typeof msg.url === "string") {
        room.video = {
          kind: "direct",
          url: msg.url.slice(0, 2000),
          time: 0,
          action: "pause"
        };
      } else if (
        msg.kind === "direct-control" &&
        room.video &&
        room.video.kind === "direct"
      ) {
        room.video.time = Number(msg.time) || 0;
        room.video.action = msg.action === "play" ? "play" : "pause";
      } else if (
        msg.kind === "yt" &&
        room.video &&
        room.video.kind === "yt"
      ) {
        room.video.time = Number(msg.time) || 0;
        room.video.action = msg.action === "play" ? "play" : "pause";
      }

      broadcast(room, {
        type: "sync",
        from: ws.id,
        ...msg
      }, ws);
    }
  });

  ws.on("close", () => removeClient(ws));
  ws.on("error", () => removeClient(ws));
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }

    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

// Ab ACTUAL idle time check hota hai (lastActive), na ki creation time
const roomSweep = setInterval(() => {
  const now = Date.now();

  for (const [id, room] of rooms) {
    if (
      room.clients.size === 0 ||
      now - room.lastActive > ROOM_IDLE_MS
    ) {
      for (const client of room.clients) {
        send(client, {
          type: "error",
          message: "This room has expired. Create a new room."
        });

        client.close();
      }

      rooms.delete(id);
    }
  }
}, 60000);

server.on("close", () => {
  clearInterval(heartbeat);
  clearInterval(roomSweep);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`WatchTogether running on ${PORT}`);
});
