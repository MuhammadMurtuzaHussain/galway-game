import { defineConfig } from 'vite';
import { attachRooms } from './server/rooms.mjs';

// Runs the multiplayer rooms on the same port as the game in dev and preview.
const multiplayer = {
  name: 'galway-multiplayer',
  configureServer(server) { attachRooms(server.httpServer); },
  configurePreviewServer(server) { attachRooms(server.httpServer); },
};

export default defineConfig({
  plugins: [multiplayer],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: { port: 5288 },
});
