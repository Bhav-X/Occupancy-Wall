const express = require('express');
const app = express();

app.set('trust proxy', 1);
app.use(express.json());

// --- CORS ---
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PATCH, PUT");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});

// --- Environment Variables ---
const FIREBASE_URL     = process.env.FIREBASE_URL;
const FIREBASE_SECRET  = process.env.FIREBASE_SECRET;
const ESP_TOKEN        = process.env.ESP_TOKEN;
const READ_TOKEN       = process.env.READ_TOKEN;
const ADMIN_KEY        = process.env.ADMIN_KEY;  

// --- Rate Limiter ---
const rateMap = {};
function rateLimit(ip) {
    const now = Date.now();
    if (!rateMap[ip]) rateMap[ip] = [];
    rateMap[ip] = rateMap[ip].filter(t => now - t < 60000);
    if (rateMap[ip].length >= 75) return false; 
    rateMap[ip].push(now);
    return true;
}

app.get('/', (req, res) => res.send("System is up and running."));

// ---------------------------------------------------------
// 1. STATUS ENDPOINTS
// ---------------------------------------------------------
app.get('/api/public-status', async (req, res) => {
    try {
        const response = await fetch(`${FIREBASE_URL}/.json?auth=${FIREBASE_SECRET}`);
        const data = await response.json();
        res.status(200).json({ 
            roomStatus: data?.roomStatus || "UNKNOWN",
            heartbeat: data?.admin?.heartbeat || 0
        });
    } catch (error) {
        res.status(500).send("Status unavailable");
    }
});

app.get('/api/status', async (req, res) => {
    if (req.headers.authorization !== `Bearer ${READ_TOKEN}`) return res.status(403).send("Access Denied");
    try {
        const response = await fetch(`${FIREBASE_URL}/.json?auth=${FIREBASE_SECRET}`);
        const data = await response.json();
        res.status(200).json(data || {});
    } catch (error) {
        res.status(500).send("Database Unreachable");
    }
});

// ---------------------------------------------------------
// 2. SSE STREAMING MANAGER (ESP32 Pipeline)
// ---------------------------------------------------------
let sseClients = [];

app.get('/api/sse-command', async (req, res) => {
    if (req.headers.authorization !== `Bearer ${READ_TOKEN}`) {
        return res.status(403).send("Access Denied");
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.push(res);

    // RACE-CONDITION FIX: Instantly check Firebase on connect in case a command was sent during the 500ms cycle
    try {
        const fbRes = await fetch(`${FIREBASE_URL}/admin.json?auth=${FIREBASE_SECRET}`);
        const fbData = await fbRes.json();
        
        if (fbData) {
            // Include kill_switch in the payload sent to the Transmitter
            res.write(`data: ${JSON.stringify({ admin: { 
                cmd: fbData.cmd || "000", 
                key: fbData.key || "0",
                kill_switch: fbData.kill_switch || false 
            } })}\n\n`);
        }
    } catch(e) { console.error("Initial SSE fetch failed"); }
    
    // Watchdog: Ping every 15s to prevent silent socket drops
    const pingInterval = setInterval(() => {
        if (!res.writableEnded) res.write(': ping\n\n'); 
    }, 15000);

    // Cleanup when ESP32 cycles connection
    req.on('close', () => {
        clearInterval(pingInterval);
        sseClients = sseClients.filter(client => client !== res);
        res.end();
    });
});

// ---------------------------------------------------------
// 3. COMMAND CENTER (Intercepts & Pushes to SSE)
// ---------------------------------------------------------
app.post('/api/command', async (req, res) => {
    const ip = req.ip;
    if (!rateLimit(ip)) return res.status(429).send("Too many requests.");

    const { cmd, key } = req.body;

    if (cmd !== "000" && key !== ADMIN_KEY) {
        return res.status(403).send("Access Denied: Wrong Key");
    }

    try {
        // ECHO-LOOP FIX: Only push active commands to SSE, ignore "000" clears from the ESP32
        if (cmd !== "000") {
            const ssePayload = JSON.stringify({ admin: { cmd, key } });
            sseClients.forEach(client => {
                if (!client.writableEnded) client.write(`data: ${ssePayload}\n\n`);
            });
        }

        // Persist to Firebase and instantly clear frontend result backlog
        const payload = { ...req.body, result: "" }; 
        await fetch(`${FIREBASE_URL}/admin.json?auth=${FIREBASE_SECRET}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // 7-Second Auto-Clear Firebase State
        if (cmd !== "000") {
            setTimeout(async () => {
                try {
                    await fetch(`${FIREBASE_URL}/admin.json?auth=${FIREBASE_SECRET}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ cmd: "000" })
                    });
                } catch (e) {}
            }, 7000); 
        }

        res.status(200).send("Command processed");
    } catch (error) {
        res.status(500).send("Failed to forward command");
    }
});

// ---------------------------------------------------------
// 4. DATA UPLINK & RESULTS
// ---------------------------------------------------------
app.post('/api/update', async (req, res) => {
    if (req.headers.authorization !== `Bearer ${ESP_TOKEN}`) return res.status(403).send("Access Denied");
    const { roomStatus, heartbeat, adminResult } = req.body;
    try {
        if (roomStatus) await fetch(`${FIREBASE_URL}/roomStatus.json?auth=${FIREBASE_SECRET}`, { method: 'PUT', body: JSON.stringify(roomStatus) });
        if (heartbeat) await fetch(`${FIREBASE_URL}/admin/heartbeat.json?auth=${FIREBASE_SECRET}`, { method: 'PUT', body: JSON.stringify(heartbeat) });
        if (adminResult) await fetch(`${FIREBASE_URL}/admin/result.json?auth=${FIREBASE_SECRET}`, { method: 'PUT', body: JSON.stringify(adminResult) });
        res.status(200).send("Data synced");
    } catch (error) {
        res.status(500).send("Sync failed");
    }
});

app.get('/api/result', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${ADMIN_KEY}` && authHeader !== `Bearer ${READ_TOKEN}`) return res.status(403).send("Access Denied");
    try {
        const response = await fetch(`${FIREBASE_URL}/admin.json?auth=${FIREBASE_SECRET}`);
        const data = await response.json();
        res.status(200).json({ result: data?.result || "", heartbeat: data?.heartbeat || 0 });
    } catch (error) {
        res.status(500).send("Unavailable");
    }
});

// --- Keep alive ---
const SELF_URL = process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";
setInterval(async () => { try { await fetch(`${SELF_URL}/`); } catch (e) {} }, 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Wall active on port ${PORT}`));
