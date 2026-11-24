const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const rooms = new Map();
const MAX_PEOPLE = 10;

const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent((req.url || "/").split("?")[0]);
  if (pathname === "/") pathname = "/index.html";
  const file = path.join(ROOT, pathname);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end("Not found");
      return;
    }
    const ext = path.extname(file);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json"
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

function send(client, data) {
  if (client.readyState === 1) client.send(JSON.stringify(data));
}
function broadcast(room, data, except) {
  for (const client of room.clients) if (client !== except) send(client, data);
}
function cleanup(client) {
  const room = rooms.get(client.roomId);
  if (!room) return;
  room.clients.delete(client);
  broadcast(room, { type: "peer-left", id: client.id });
  if (room.clients.size === 0) rooms.delete(client.roomId);
  else broadcast(room, { type: "count", count: room.clients.size });
}

wss.on("connection", (ws) => {
  ws.id = Math.random().toString(36).slice(2, 10);
  ws.roomId = null;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "join") {
      const roomId = String(msg.roomId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
      if (!roomId) return send(ws, { type: "error", message: "Invalid room link." });

      let room = rooms.get(roomId);
      if (!room) {
        if (!msg.create) return send(ws, { type: "error", message: "Room not found or already closed." });
        room = { clients: new Set(), createdAt: Date.now() };
        rooms.set(roomId, room);
      }
      if (room.clients.size >= MAX_PEOPLE) return send(ws, { type: "error", message: "Room is full (maximum 10 people)." });

      ws.roomId = roomId;
      const existing = [...room.clients].map(c => ({ id: c.id, name: c.name }));
      ws.name = String(msg.name || "Guest").slice(0, 24);
      room.clients.add(ws);
      send(ws, { type: "joined", id: ws.id, peers: existing, count: room.clients.size });
      broadcast(room, { type: "peer-joined", id: ws.id, name: ws.name }, ws);
      broadcast(room, { type: "count", count: room.clients.size });
      return;
    }

    const room = rooms.get(ws.roomId);
    if (!room) return;

    if (msg.type === "signal") {
      const target = [...room.clients].find(c => c.id === msg.to);
      if (target) send(target, { type: "signal", from: ws.id, signal: msg.signal });
    } else if (["chat", "sync", "youtube", "photo", "facecam"].includes(msg.type)) {
      broadcast(room, { ...msg, from: ws.id, name: ws.name }, ws);
    }
  });

  ws.on("close", () => cleanup(ws));
  ws.on("error", () => cleanup(ws));
});

server.listen(PORT, () => console.log(`WatchTogether running on ${PORT}`));