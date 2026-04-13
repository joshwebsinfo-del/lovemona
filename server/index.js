
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Initialize Web-Push
webpush.setVapidDetails(
  'mailto:support@securelove.app',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

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

async function sendPushNotification(userId, messageData) {
  try {
    const { data: subData } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('user_id', userId)
      .single();

    if (subData && subData.subscription) {
      const payload = JSON.stringify({
        title: messageData.title || 'New Match Message',
        body: messageData.body || 'You have a new encrypted message.',
        icon: '/pwa-192x192.png',
        data: { url: '/' }
      });

      await webpush.sendNotification(subData.subscription, payload);
      console.log(`[push] Sent notification to ${userId}`);
    }
  } catch (error) {
    console.error(`[push] Error sending to ${userId}:`, error.message);
    if (error.statusCode === 410 || error.statusCode === 404) {
      // Subscription expired or no longer valid, delete it
      await supabase.from('push_subscriptions').delete().eq('user_id', userId);
    }
  }
}

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
  socket.on('message:send', async ({ to, encrypted, iv, senderId, messageId }) => {
    const payload = { encrypted, iv, senderId, timestamp: Date.now(), messageId };
    
    if (users.has(to)) {
      // Emit to ALL sockets of that user
      io.to(to).emit('message:receive', payload);
    } else {
      console.log(`[message] recipient ${to} offline. Queuing and sending push.`);
      if (!messageQueue.has(to)) messageQueue.set(to, []);
      messageQueue.get(to).push(payload);
      
      // Trigger Web Push
      sendPushNotification(to, { 
        title: 'SecureLove', 
        body: 'New message received in your private world.' 
      });
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

app.post('/api/push/subscribe', async (req, res) => {
  const { userId, subscription } = req.body;
  if (!userId || !subscription) return res.status(400).json({ error: 'Missing userId or subscription' });

  try {
    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      subscription: subscription,
      created_at: Date.now()
    });

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('[api] subscription error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test endpoint to trigger a push notification manually
app.get('/api/push/test/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    await sendPushNotification(userId, {
      title: 'SecureLove Test',
      body: 'This is a test notification from your world! ❤️'
    });
    res.json({ success: true, message: `Test push sent to ${userId}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
