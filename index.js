// SBS Webhook Server v3 - Fixed Base44 + Auto-registers Twilio
const express = require('express');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const VERIFY_TOKEN = 'SBS_MESSENGER_2024';
const BASE44_APP_ID = '6976d8da5cff3ee3ec3c69d2';
const BASE44_API_KEY = process.env.BASE44_API_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const RENDER_URL = 'https://sbs-messenger-webhook.onrender.com';
const SMS_WEBHOOK_URL = `${RENDER_URL}/webhook/sms`;

async function base44Post(entity, data) {
  try {
    const res = await fetch(`https://api.base44.com/api/apps/${BASE44_APP_ID}/entities/${entity}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api_key': BASE44_API_KEY, 'Accept': 'application/json' },
      body: JSON.stringify(data)
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) {
      console.error(`Base44 POST (${entity}) HTTP ${res.status}:`, text.substring(0, 300));
      return null;
    }
  } catch (e) { console.error(`Base44 POST error:`, e.message); return null; }
}

async function base44Get(entity, query = '') {
  try {
    const res = await fetch(`https://api.base44.com/api/apps/${BASE44_APP_ID}/entities/${entity}${query}`, {
      headers: { 'api_key': BASE44_API_KEY, 'Accept': 'application/json' }
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) {
      console.error(`Base44 GET (${entity}) HTTP ${res.status}:`, text.substring(0, 300));
      return [];
    }
  } catch (e) { console.error(`Base44 GET error:`, e.message); return []; }
}

function twilioAuth() {
  return 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
}

async function registerWebhookOnAllNumbers() {
  try {
    console.log('Registering SMS webhook on all Twilio numbers...');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json?PageSize=100`, {
      headers: { 'Authorization': twilioAuth() }
    });
    const data = await res.json();
    if (!data.incoming_phone_numbers) { console.log('No numbers found:', JSON.stringify(data)); return; }
    console.log(`Found ${data.incoming_phone_numbers.length} number(s)`);
    for (const number of data.incoming_phone_numbers) {
      if (number.sms_url === SMS_WEBHOOK_URL) { console.log(`Already set: ${number.phone_number}`); continue; }
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers/${number.sid}.json`, {
        method: 'POST',
        headers: { 'Authorization': twilioAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ SmsUrl: SMS_WEBHOOK_URL, SmsMethod: 'POST' }).toString()
      });
      const result = await r.json();
      console.log(result.sid ? `Registered: ${number.phone_number}` : `Failed: ${JSON.stringify(result)}`);
    }
    console.log('All Twilio numbers configured!');
  } catch (e) { console.error('Twilio registration error:', e.message); }
}

app.get('/', (req, res) => res.send(`<h2>SBS Webhook Server Running</h2><p>SMS: ${SMS_WEBHOOK_URL}</p>`));

app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === VERIFY_TOKEN) { console.log('FB webhook verified!'); res.status(200).send(challenge); }
  else res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object === 'page') {
    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        if (event.message && event.sender) {
          console.log(`FB message from ${event.sender.id}: ${event.message.text}`);
          await base44Post('IncomingMessage', {
            psid: event.sender.id, message: event.message.text || '',
            timestamp: new Date(event.timestamp).toISOString(), processed: false, channel: 'messenger'
          });
        }
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } else res.sendStatus(404);
});

app.post('/webhook/sms', async (req, res) => {
  const { From, To, Body, MessageSid } = req.body;
  console.log(`SMS from ${From}: ${Body}`);
  try {
    const convs = await base44Get('SMSConversation', `?phone_number=${encodeURIComponent(From)}`);
    let cid;
    if (convs && convs.length > 0) {
      cid = convs[0]._id;
      await fetch(`https://api.base44.com/api/apps/${BASE44_APP_ID}/entities/SMSConversation/${cid}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'api_key': BASE44_API_KEY },
        body: JSON.stringify({ last_message: Body, last_message_time: new Date().toISOString(), unread_count: (convs[0].unread_count || 0) + 1 })
      });
    } else {
      const nc = await base44Post('SMSConversation', { contact_name: From, phone_number: From, last_message: Body, last_message_time: new Date().toISOString(), unread_count: 1, twilio_number: To, ai_enabled: false, label: 'new' });
      cid = nc?._id;
    }
    if (cid) await base44Post('SMSMessage', { conversation_id: cid, body: Body, direction: 'inbound', from_number: From, to_number: To, timestamp: new Date().toISOString(), status: 'received', twilio_sid: MessageSid });
    console.log('SMS stored!');
  } catch (e) { console.error('SMS error:', e.message); }
  res.set('Content-Type', 'text/xml');
  res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) await registerWebhookOnAllNumbers();
  else console.log('No Twilio credentials - skipping auto-registration');
});
