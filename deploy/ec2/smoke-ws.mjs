const origin = new URL(process.argv[2] ?? '');
const ticketResponse = await fetch(new URL('/v1/auth/ticket', origin), {
  method: 'POST',
});

if (!ticketResponse.ok) {
  throw new Error(`ticket request failed: ${ticketResponse.status}`);
}

const payload = await ticketResponse.json();
if (typeof payload.ticket !== 'string' || payload.ticket.length === 0) {
  throw new Error('ticket response did not include a ticket');
}

const socketUrl = new URL('/v1/ws', origin);
socketUrl.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
socketUrl.searchParams.set('ticket', payload.ticket);

await new Promise((resolve, reject) => {
  const socket = new WebSocket(socketUrl);
  const timeout = setTimeout(() => {
    socket.close();
    reject(new Error('websocket hello timed out'));
  }, 10_000);

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type === 'hello') {
      clearTimeout(timeout);
      socket.close();
      resolve();
    }
  });
  socket.addEventListener('error', () => {
    clearTimeout(timeout);
    reject(new Error('websocket connection failed'));
  });
  socket.addEventListener('close', () => clearTimeout(timeout));
});

console.log('ticketed websocket smoke passed');
