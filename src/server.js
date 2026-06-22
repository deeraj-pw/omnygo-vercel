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
  send(ws, { type: 'provider', name: process.env.AI_PROVIDER || 'anthropic' });

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'run') {
        if (currentAgent) {
          send(ws, { type: 'error', message: 'Agent already running' });
          return;
        }

        const config = {
          provider: process.env.AI_PROVIDER || 'anthropic',
          apiKey: process.env.AI_PROVIDER === 'openai' 
            ? process.env.OPENAI_API_KEY 
            : process.env.ANTHROPIC_API_KEY
        };
        
        currentAgent = new Agent(config, async (stepUpdate) => {
          send(ws, stepUpdate);
          
          // Start screencast after browser launches
          if (stepUpdate.type === 'info' && stepUpdate.message === 'Browser launched') {
            try {
              await new Promise(r => setTimeout(r, 500));
              if (currentAgent && currentAgent.browser) {
                await currentAgent.browser.startScreencast((frameData, metadata) => {
                  send(ws, { 
                    type: 'screencast_frame', 
                    base64: frameData
                  });
                });
              }
            } catch(e) {
              console.error('Screencast start failed:', e);
            }
          }
          
          if (stepUpdate.type === 'focus_browser' && currentAgent) {
            try {
              currentAgent.browser.focusWindow();
            } catch(e) {}
          }
        });

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
           currentAgent.stopped = true;  // set flag FIRST
           // Give the loop a moment to notice, then force close
           setTimeout(async () => {
             try {
               if (currentAgent && currentAgent.browser) {
                 await currentAgent.browser.close();
               }
             } catch(e) {}
             currentAgent = null;
           }, 100);
         }
         send(ws, { type: 'stopped', message: 'Task stopped by you' });
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
