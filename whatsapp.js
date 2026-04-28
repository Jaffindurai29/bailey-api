const express = require('express');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const fs = require('fs-extra');
const cors = require('cors');
const path = require('path');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    delay,
} = require('@whiskeysockets/baileys');
const multer = require('multer');

const upload = multer();
const app = express();
app.use(express.json());
app.use(
    cors({
        origin: 'https://whatsapp-auth-d7db6.web.app',
        credentials: true,
    })
);

const sockets = {};
const qrs = {};
const connectionStatus = {};
let user = '';

global.sockets = global.sockets || {};

const PRIVATE_KEY = 'Tf4Q*J592#t#9Az@z0T*Lt5sLIg#1=o';

const templates = {
    accept: '👮🏼{{name}}, தங்கள் {{date}} தேதிக்கான REST-Weekoff கோரிக்கை ஒப்புதல் அளிக்கப்பட்டுள்ளது ✅',
    reject: '👮🏼{{name}}, தங்கள் {{date}} தேதிக்கான REST-Weekoff கோரிக்கை நிராகரிக்கப்பட்டுள்ளது ❌\n📌 காரணம்: {{reason}}',
    apply: '👮🏼{{name}} அவர்கள் {{date}} தேதிக்கு REST-Weekoff விண்ணப்பித்துள்ளார். தயவுசெய்து தேவையான நடவடிக்கைகளை மேற்கொள்ளவும் 📝\n🔗 விண்ணப்பத்தை பார்க்க: https://rest.kkipolice.site/admin/',
};

function generateMessage(type, name, date, reason = '') {
    const template = templates[type];
    if (!template) throw new Error('Invalid template type');
    return template.replace('{{name}}', name).replace('{{date}}', date).replace('{{reason}}', reason);
}

// app.post("/login", async (req, res) => {
//   const { mobile, password } = req.body;
//   if (!mobile || !password)
//     return res.status(400).json({ error: "Missing mobile or password" });

//   try {
//     const [rows] = await db.query("SELECT * FROM users WHERE mobile = ?", [
//       mobile,
//     ]);
//     if (rows.length === 0)
//       return res.status(404).json({ error: "User not found" });

//     const user = rows[0];
//     const passwordMatch = await bcrypt.compare(password, user.password);
//     if (!passwordMatch)
//       return res.status(401).json({ error: "Invalid credentials" });

//     res.json({ success: true, user });
//   } catch (err) {
//     console.error("DB error:", err);
//     res.status(500).json({ error: "Server error" });
//   }
// });

(async () => {
    const baseDir = process.cwd();
    const files = await fs.readdir(baseDir);
    const authFolders = files.filter((f) => f.startsWith('auth_info_'));

    for (const folder of authFolders) {
        const mobile = folder.replace('auth_info_', '');
        initWhatsapp(mobile);
    }
})();

app.post('/delete-session', async (req, res) => {
    const { mobile } = req.body;
    if (!mobile) return res.status(400).json({ error: 'Missing mobile' });

    const sessionPath = `./auth_info_${mobile}`;
    try {
        if (fs.existsSync(sessionPath)) {
            await fs.remove(sessionPath);
            delete sockets[mobile];
            res.json({ success: true, message: 'Session deleted' });
        } else {
            res.json({ success: false, message: 'Session not found' });
        }
    } catch (err) {
        console.error('Error deleting session', err);
        res.status(500).json({ error: 'Failed to delete session' });
    }
});

app.post('/delete-all-sessions', async (req, res) => {
    try {
        const baseDir = process.cwd();

        const files = await fs.readdir(baseDir);

        const authFolders = files.filter((f) => f.startsWith('auth_info_'));

        if (authFolders.length === 0) {
            return res.json({ success: false, message: 'No sessions found' });
        }

        for (const folder of authFolders) {
            const folderPath = path.join(baseDir, folder);
            await fs.remove(folderPath);
        }
        global.sockets = {};

        res.json({
            success: true,
            message: `${authFolders.length} session(s) deleted successfully.`,
        });
    } catch (err) {
        console.error('Error deleting sessions:', err);
        res.status(500).json({ error: 'Failed to delete sessions' });
    }
});

async function initWhatsapp(mobile) {
    const folder = `./auth_info_${mobile}`;
    const { state, saveCreds } = await useMultiFileAuthState(folder);
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({ auth: state, version });

    sockets[mobile] = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, qr, lastDisconnect }) => {
        if (qr) {
            qrs[mobile] = qr;
            console.log(`📲 QR for ${mobile}`);
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.log(`✅ WhatsApp ${mobile} connected.`);
            connectionStatus[mobile] = 'connected';
        }

        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log(`❌ Connection closed for ${mobile}, code: ${code}`);
            connectionStatus[mobile] = 'disconnected';
            if (code !== 401) {
                initWhatsapp(mobile);
            }
        }
    });
}

app.post('/start', async (req, res) => {
    const { mobile } = req.body;
    if (!mobile) return res.status(400).json({ error: 'Missing mobile' });
    user = mobile;
    try {
        initWhatsapp(mobile);
        res.status(200).json({ success: true });
    } catch (err) {
        console.error('Error starting WhatsApp:', err);
        res.status(500).json({ error: 'Failed to start WhatsApp' });
    }
});
app.get('/qr', async (req, res) => {
    const mobile = req.query.mobile;
    const qr = qrs[mobile];
    const qrDataUrl = await QRCode.toDataURL(qr);
    if (qrDataUrl) {
        res.json({ qr: qrDataUrl });
    } else {
        res.status(404).json({ message: 'QR not yet available' });
    }
});

app.get('/status', async (req, res) => {
    try {
        const mobile = req.query.mobile;
        const status = connectionStatus[mobile];
        res.json({ status });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error', message: error.message });
    }
});

app.post('/send', async (req, res) => {
    console.log('hi');
    const { phone, name, date, type, reason } = req.body;

    if (!phone || !name || !date || !type) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const sock = sockets['6369427466'];
    if (!sock) return res.status(400).json({ error: 'Sender not connected to WhatsApp' });

    try {
        const msg = generateMessage(type, name, date, reason || '');
        const jid = `91${phone.replace(/\D/g, '')}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: msg });
        await delay(1000);
        res.json({ success: true });
    } catch (err) {
        console.error('Error sending message:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/message', async (req, res) => {
    try {
        const { targetPhoneNo, message, key, senderPhoneNo } = req.body;

        if (key !== PRIVATE_KEY) {
            return res.status(403).json({ success: false, message: `Unauthorized access` });
        }

        const sock = sockets[senderPhoneNo];
        if (!sock) return res.status(400).json({ error: 'Sender not connected to WhatsApp' });

        const jid = `91${targetPhoneNo.replace(/\D/g, '')}@s.whatsapp.net`;

        await sock.sendMessage(jid, { text: message });
        await delay(1000);

        res.json({ success: true, message: `Message sent to ${targetPhoneNo}` });
    } catch (err) {
        console.error('Error sending message:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/message/image', upload.single('image'), async (req, res) => {
    try {
        const { targetPhoneNo, image, message, key, senderPhoneNo } = req.body;

        if (key !== PRIVATE_KEY) {
            return res.status(403).json({ success: false, message: `Unauthorized access` });
        }

        const sock = sockets[senderPhoneNo];
        if (!sock) return res.status(400).json({ error: 'Sender not connected to WhatsApp' });

        const jid = `91${targetPhoneNo.replace(/\D/g, '')}@s.whatsapp.net`;
        const base64_image = image.replace(/^data:image\/[a-z]+;base64,/, '');
        const imageBuffer = Buffer.from(base64_image, 'base64');

        await sock.sendMessage(jid, { image: imageBuffer, caption: message });
        await delay(1000);

        res.status(200).json({ success: true, message: `Message sent to ${targetPhoneNo}` });
    } catch (err) {
        console.error('Error sending message:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = 3002;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 WhatsApp API running at http://localhost:${PORT}`);
});