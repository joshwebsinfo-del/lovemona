
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;

let socket: Socket | null = null;
let currentUserId: string | null = null;

export function initSocket(userId: string): Socket {
  // If already connected with the same userId, reuse
  if (socket && socket.connected && currentUserId === userId) {
    return socket;
  }

  // Disconnect old socket if userId changed or socket is stale
  if (socket) {
    socket.disconnect();
    socket = null;
  }

  currentUserId = userId;
  socket = io(SOCKET_URL, {
    query: { userId },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  socket.on('connect', () => {
    console.log(`[socket] Connected as ${userId} (${socket?.id})`);
  });

  socket.on('connect_error', (err) => {
    console.error('[socket] Connection error:', err.message);
  });

  socket.on('disconnect', (reason) => {
    console.warn('[socket] Disconnected:', reason);
  });

  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
    currentUserId = null;
  }
}
