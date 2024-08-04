const Database = require('better-sqlite3');
const OpenAI = require('openai');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('node:fs');

// Config
const config = {
    gptModel: "gpt-4o-mini",
    prePrompt: process.env.PRE_PROMPT
};

// Setup and initialize database
const db = new Database('./db/messages.db');
const init = fs.readFileSync('init.sql', 'utf8');
db.pragma('journal_mode = WAL');
db.exec(init);

// Setup OpenAI
const openai = new OpenAI();

// Setup whatsapp client
const client = new Client({
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
    authStrategy: new LocalAuth({
        dataPath: './cache'
    })
});
client.once('ready', () => {
    console.log('Client is ready!');
});
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
});
client.initialize();

// Listening to all incoming messages
client.on('message', async (msg) => {
    let session;
    const exists = db.prepare(`SELECT EXISTS(SELECT 1 FROM sessions WHERE phone_number = ?) AS value`).get(msg.from);
    if (exists.value === 0) {
        session = db.prepare(`INSERT INTO sessions (phone_number, messages)
        VALUES (?, jsonb(?))
        RETURNING id, phone_number, json(messages) AS messages`)
            .get(msg.from, JSON.stringify([{ role: "system", content: config.prePrompt }]));
    } else {
        session = db.prepare(`SELECT id, phone_number, json(messages) AS messages
        FROM sessions
        WHERE phone_number = ?`)
            .get(msg.from);
    }
    const messages = [...JSON.parse(session.messages), { role: "user", content: msg.body }];
    const completion = await openai.chat.completions.create({
        messages,
        model: config.gptModel,
    });
    const newMessage = completion.choices[0]?.message || {};
    const newMessages = [...messages, newMessage];
    db.prepare(`UPDATE sessions SET messages = jsonb(?) WHERE phone_number = ?`).run(JSON.stringify(newMessages), msg.from)
    msg.reply(newMessage?.content || "");
});
