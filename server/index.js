
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const path = require('path');
const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from the React app
app.use(express.static(path.join(__dirname, '../client/dist')));


const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 5e7, // 50MB
});

// userId -> Set of socketId
const users = new Map();
const messageQueue = new Map(); // userId -> Array of messages

io.on('connection', (socket) => {
  const userId = socket.handshake.query.userId;
  
  if (userId) {
    socket.join(userId); // Join a room named after the userId for multi-device delivery
    
    if (!users.has(userId)) {
      users.set(userId, new Set());
      console.log(`[presence] ${userId} FIRST connection. Broadcasting Online.`);
      io.to(`tracking:${userId}`).emit('status:update', { isOnline: true });
    }
    
    users.get(userId).add(socket.id);
    console.log(`[connect] ${userId} | socket ${socket.id} | active sockets: ${users.get(userId).size}`);

    // Flush queued messages
    if (messageQueue.has(userId)) {
      const queued = messageQueue.get(userId);
      queued.forEach(payload => socket.emit('message:receive', payload));
      messageQueue.delete(userId);
      console.log(`[connect] flushed ${queued.length} queued messages to ${userId}`);
    }
  }


  // ── PAIRING FLOW ──────────────────────────────────────────────────────────
  socket.on('pair:init', ({ myId }) => {
    socket.join(`pair:${myId}`);
  });

  socket.on('pair:connect', ({ partnerId, myId, publicKey, nick, avatar }) => {
    io.to(`pair:${partnerId}`).emit('pair:received', { partnerId: myId, publicKey, nick, avatar });
    socket.join(`pair:${myId}`);
  });

  socket.on('pair:confirm', ({ to, myId, publicKey, nick, avatar }) => {
    io.to(`pair:${to}`).emit('pair:confirmed', { myId, publicKey, nick, avatar });
  });

  // ── MESSAGING ─────────────────────────────────────────────────────────────
  socket.on('message:send', ({ to, encrypted, iv, senderId, messageId }) => {
    const payload = { encrypted, iv, senderId, timestamp: Date.now(), messageId };
    
    if (users.has(to)) {
      // Emit to ALL sockets of that user
      io.to(to).emit('message:receive', payload);
    } else {
      console.log(`[message] recipient ${to} offline. Queuing message.`);
      if (!messageQueue.has(to)) messageQueue.set(to, []);
      messageQueue.get(to).push(payload);
    }
  });

  socket.on('status:subscribe', ({ partnerId }) => {
    socket.join(`tracking:${partnerId}`);
    const isOnline = users.has(partnerId);
    socket.emit('status:update', { isOnline });
  });

  socket.on('disconnect', () => {
    if (userId && users.has(userId)) {
      const socketSet = users.get(userId);
      socketSet.delete(socket.id);
      
      console.log(`[disconnect] ${userId} socket ${socket.id} closed. Remaining: ${socketSet.size}`);
      
      if (socketSet.size === 0) {
        users.delete(userId);
        console.log(`[presence] ${userId} LAST connection closed. Broadcasting Offline.`);
        io.to(`tracking:${userId}`).emit('status:update', { isOnline: false });
      }
    }
  });
});

app.get('/health', (req, res) => res.json({
  status: 'ok',
  connectedUsersCount: users.size,
  users: [...users.keys()],
}));

// Client-side routing catch-all (Extreme compatibility for Express 5+)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist', 'index.html'));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`SecureLove server on port ${PORT}`));
