// SBS Webhook Server v2 - Auto-registers on all Twilio numbers
const express = require('express');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const VERIFY_TOKEN = 'SBS_MESSENGER_2024';
const BASE44_APP_ID = '6976d8da5cff3ee3ec3c69d2';
const BASE44_API_KEY = process.env.BASE44_API_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

// Base44 API helper
async function base44Post(entity, data) {
  const res = await fetch(`https://api.base44.com/api/apps/${BASE44_APP_ID}/entities/${entity}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api_key': BASE44_API_KEY
    },
    body: JSON.stringify(data)
  });
  return res.json();
}

async function base44Get(entity, query = '') {
  const res = await fetch(`https://api.base44.com/api/apps/${BASE44_APP_ID}/entities/${entity}${query}`, {
    headers: { 'api_key': BASE44_API_KEY }
  });
  return res.json();
}

// Facebook webhook verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Facebook webhook verified!');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Facebook incoming messages
app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object === 'page') {
    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        if (event.message && event.sender) {
          try {
            await base44Post('IncomingMessage', {
              psid: event.sender.id,
              message: event.message.text || '',
              timestamp: new Date(event.timestamp).toISOString(),
              processed: false,
              channel: 'messenger'
            });
          } catch (e) {
            console.error('Error storing FB message:', e);
          }
        }
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

// Twilio incoming SMS
app.post('/webhook/sms', async (req, res) => {
  const { From, To, Body, MessageSid } = req.body;
  console.log(`Incoming SMS from ${From}: ${Body}`);

  try {
    // Find or create SMS conversation
    const conversations = await base44Get('SMSConversation', `?phone_number=${encodeURIComponent(From)}`);
    let conversationId;

    if (conversations && conversations.length > 0) {
      conversationId = conversations[0]._id;
      // Update last message
      await fetch(`https://api.base44.com/api/apps/${BASE44_APP_ID}/entities/SMSConversation/${conversationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'api_key': BASE44_API_KEY },
        body: JSON.stringify({
          last_message: Body,
          last_message_time: new Date().toISOString(),
          unread_count: (conversations[0].unread_count || 0) + 1
        })
      });
    } else {
      // Create new conversation
      const newConv = await base44Post('SMSConversation', {
        contact_name: From,
        phone_number: From,
        last_message: Body,
        last_message_time: new Date().toISOString(),
        unread_count: 1,
        twilio_number: To,
        ai_enabled: false,
        label: 'new'
      });
      conversationId = newConv._id;
    }

    // Store the message
    await base44Post('SMSMessage', {
      conversation_id: conversationId,
      body: Body,
      direction: 'inbound',
      from_number: From,
      to_number: To,
      timestamp: new Date().toISOString(),
      status: 'received',
      twilio_sid: MessageSid
    });

    // Check if AI is enabled for this conversation
    if (conversations && conversations[0] && conversations[0].ai_enabled) {
      // AI response will be handled by the frontend polling
      // For server-side AI, add Anthropic API call here
    }

  } catch (e) {
    console.error('Error processing SMS:', e);
  }

  // Respond with empty TwiML
  res.set('Content-Type', 'text/xml');
  res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});

// Health check
app.get('/', (req, res) => res.send('SBS Webhook Server Running ✅'));

app.listen(process.env.PORT || 3000, () => console.log('Webhook server running on port', process.env.PORT || 3000));
