const express = require('express');
const app = express();
app.use(express.json());

const VERIFY_TOKEN = 'SBS_MESSENGER_2024';
const BASE44_APP_ID = '6976d8da5cff3ee3ec3c69d2';

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified!');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object === 'page') {
    for (const entry of body.entry) {
      for (const event of entry.messaging || []) {
        if (event.message) {
          await fetch(`https://api.base44.com/api/apps/${BASE44_APP_ID}/entities/IncomingMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              psid: event.sender.id,
              message: event.message.text || '',
              timestamp: new Date(event.timestamp).toISOString(),
              processed: false
            })
          });
        }
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

app.listen(process.env.PORT || 3000, () => console.log('Webhook server running'));
