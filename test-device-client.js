// Test Device Client - Simulates Android App
const WebSocket = require('ws');
const http = require('http');

const RELAY_URL = 'ws://localhost:8080/ws';
const DEVICE_ID = 'test-device';
const AGENT_ID = 'test-agent';

// Get token from relay server
async function getToken() {
  const response = await fetch('http://localhost:8080/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'device',
      device_id: DEVICE_ID
    })
  });
  const data = await response.json();
  return data.token;
}

async function main() {
  console.log('[Device] Getting JWT token...');
  const token = await getToken();
  console.log('[Device] Token received:', token.substring(0, 30) + '...');

  console.log('[Device] Connecting to relay server...');
  const ws = new WebSocket(RELAY_URL);

  ws.on('open', () => {
    console.log('[Device] WebSocket connected');

    // Send auth message
    const authMsg = {
      id: generateId(),
      event: 'auth.login',
      payload: { token }
    };
    console.log('[Device] Sending auth.login...');
    ws.send(JSON.stringify(authMsg));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('[Device] Received:', msg.event, msg.payload || '');

    if (msg.event === 'auth.ok') {
      console.log('[Device] ✅ Authentication successful');

      // Bind to project
      setTimeout(() => {
        const bindMsg = {
          id: generateId(),
          event: 'project.bind',
          payload: {
            project_id: 'test-project-001',
            agent_id: AGENT_ID
          }
        };
        console.log('[Device] Binding to project...');
        ws.send(JSON.stringify(bindMsg));
      }, 500);
    }

    if (msg.event === 'project.bind.ok') {
      console.log('[Device] ✅ Project bound successfully');

      // Send test message to agent
      setTimeout(() => {
        const testMsg = {
          id: generateId(),
          event: 'message.send',
          project_id: 'test-project-001',
          payload: {
            type: 'command',
            command: 'echo "Hello from Android App!"'
          }
        };
        console.log('[Device] Sending test command to agent...');
        ws.send(JSON.stringify(testMsg));
      }, 500);
    }

    if (msg.event === 'message.chunk' || msg.event === 'message.done') {
      console.log('[Device] ✅ Received response from agent:', msg.payload);
    }

    if (msg.event === 'error') {
      console.error('[Device] ❌ Error:', msg.payload);
    }
  });

  ws.on('error', (err) => {
    console.error('[Device] WebSocket error:', err.message);
  });

  ws.on('close', () => {
    console.log('[Device] WebSocket closed');
  });
}

function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

main().catch(console.error);
