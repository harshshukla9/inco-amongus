import { io } from 'socket.io-client';
import { SOCKET_URL } from './constants';

let socket = null;

export const connectSocket = (room, name = 'Crewmate') => {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  socket = io(SOCKET_URL, {
    query: { room, name },
  });

  return socket;
};

export const getSocket = () => socket;

export const disconnectSocket = () => {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
};
