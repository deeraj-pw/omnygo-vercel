require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const Agent = require('./agent');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Serve static files from public folder
app.use(express.static(path.join(__dirname, '../public')));

// Global state
let currentAgent = null;
let currentClient = null;

// Helper function to send data over WebSocket
function send(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  currentClient = ws;
  send(ws, { type: 'info', message: 'OmnyGO is ready. What would you like me to do?' });

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'run') {
        // Start a new agent run
        if (currentAgent) {
          send(ws, { type: 'error', message: 'Agent already running' });
          return;
        }

         // Create new agent with onStep callback
         currentAgent = new Agent(process.env.ANTHROPIC_API_KEY, (stepUpdate) => {
           send(ws, stepUpdate);
           if (stepUpdate.type === 'focus_browser' && currentAgent) {
             try {
               currentAgent.browser.focusWindow();
             } catch(e) {}
           }
         });


        // Run agent in background
        currentAgent.run(data.goal)
          .then((result) => {
            currentAgent = null;
          })
          .catch((error) => {
            send(ws, { type: 'error', message: error.message });
            currentAgent = null;
          });
      } else if (data.type === 'reply') {
        // Send user reply to agent
        if (currentAgent) {
          currentAgent.receiveUserReply(data.text);
        } else {
          send(ws, { type: 'error', message: 'No agent running' });
        }
      } else if (data.type === 'stop') {
        // Stop the agent
        if (currentAgent) {
          try {
            await currentAgent.browser.close();
          } catch (error) {
            console.error('Error closing browser:', error);
          }
          currentAgent = null;
        }
        send(ws, { type: 'info', message: 'Agent stopped' });
      } else {
        send(ws, { type: 'error', message: `Unknown message type: ${data.type}` });
      }
    } catch (error) {
      send(ws, { type: 'error', message: `Server error: ${error.message}` });
    }
  });

  ws.on('close', () => {
    currentClient = null;
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Browser Agent server running on http://localhost:${PORT}`);
});
