// Standalone multiplayer server for hosting (Render, Fly.io…): `npm run server`.
// In development the same rooms run inside the Vite dev server instead.
import { createServer } from 'node:http';
import { attachRooms } from './rooms.mjs';

const port = process.env.PORT || 2567;
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(`galway multiplayer ok, ${wss.clients.size} connected\n`);
});
const wss = attachRooms(server);
server.listen(port, () => console.log(`multiplayer server on :${port}`));
