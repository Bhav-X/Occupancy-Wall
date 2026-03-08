const express = require('express'); // ehehehehhe
const app = express();
app.use(express.json());

// Allow requests from any origin (required for GitHub Pages)
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});

// --- Environment Variables (Set these in your Render Dashboard) ---
const FIREBASE_URL     = process.env.FIREBASE_URL;
const FIREBASE_SECRET  = process.env.FIREBASE_SECRET;
const ESP_TOKEN        = process.env.ESP_TOKEN;
const READ_TOKEN       = process.env.READ_TOKEN;
const ADMIN_KEY        = process.env.ADMIN_KEY;  // NEW: admin key verified server-side too

// --- Rate Limiter (max 10 requests per minute per IP) ---
const rateMap = {};

function rateLimit(ip) {
    const now = Date.now();
    if (!rateMap[ip]) rateMap[ip] = [];
    rateMap[ip] = rateMap[ip].filter(t => now - t < 60000);
    if (rateMap[ip].length >= 10) return false;
    rateMap[ip].push(now);
    return true;
}

// Root route
app.get('/', (req, res) => {
    res.send("The system is up and running.");
});

// ---------------------------------------------------------
// 1. PUBLIC STATUS: Website reads only roomStatus (no tokens, no admin data exposed)
// ---------------------------------------------------------
app.get('/api/public-status', async (req, res) => {
    try {
        const response = await fetch(`${FIREBASE_URL}/roomStatus.json?auth=${FIREBASE_SECRET}`);
        const roomStatus = await response.json();
        // Only returns roomStatus — no admin fields, no tokens, no heartbeat exposed
        res.status(200).json({ roomStatus: roomStatus || "UNKNOWN" });
    } catch (error) {
        console.error("Public status fetch error:", error);
        res.status(500).send("Status unavailable");
    }
});

// ---------------------------------------------------------
// 2. FULL STATUS: ESP8266 reads full DB (requires read token)
// ---------------------------------------------------------
app.get('/api/status', async (req, res) => {
    if (req.headers.authorization !== `Bearer ${READ_TOKEN}`) {
        return res.status(403).send("Access Denied");
    }
    try {
        const response = await fetch(`${FIREBASE_URL}/.json?auth=${FIREBASE_SECRET}`);
        const data = await response.json();
        res.status(200).json(data || {});
    } catch (error) {
        console.error("Database fetch error:", error);
        res.status(500).send("Database Unreachable");
    }
});

// ---------------------------------------------------------
// 3. DATA UPLINK: ESP32 pushes status/heartbeat/result
// ---------------------------------------------------------
app.post('/api/update', async (req, res) => {
    if (req.headers.authorization !== `Bearer ${ESP_TOKEN}`) {
        return res.status(403).send("Access Denied: Invalid Uplink Token");
    }
    const { roomStatus, heartbeat, adminResult } = req.body;
    try {
        if (roomStatus) {
            await fetch(`${FIREBASE_URL}/roomStatus.json?auth=${FIREBASE_SECRET}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(roomStatus)
            });
        }
        if (heartbeat) {
            await fetch(`${FIREBASE_URL}/admin/heartbeat.json?auth=${FIREBASE_SECRET}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(heartbeat)
            });
        }
        if (adminResult) {
            await fetch(`${FIREBASE_URL}/admin/result.json?auth=${FIREBASE_SECRET}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(adminResult)
            });
        }
        res.status(200).send("Data synced");
    } catch (error) {
        console.error("Firebase sync error:", error);
        res.status(500).send("Sync failed");
    }
});

// ---------------------------------------------------------
// 4. COMMAND CENTER: Website sends admin commands
// ---------------------------------------------------------
app.post('/api/command', async (req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // Rate limit
    if (!rateLimit(ip)) {
        return res.status(429).send("Too many requests. Slow down.");
    }

    const { cmd, key, id, maintenance } = req.body;

    // Server-side key verification (skip check for reset command cmd="0")
    if (cmd !== "0" && key !== ADMIN_KEY) {
        return res.status(403).send("Access Denied: Wrong Key");
    }

    try {
        await fetch(`${FIREBASE_URL}/admin.json?auth=${FIREBASE_SECRET}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        res.status(200).send("Command forwarded");
    } catch (error) {
        console.error("Command error:", error);
        res.status(500).send("Failed to forward command");
    }
});

// ---------------------------------------------------------
// 5. ADMIN RESULT: Website polls for ESP32 response
// ---------------------------------------------------------
app.get('/api/result', async (req, res) => {
    if (req.headers.authorization !== `Bearer ${READ_TOKEN}`) {
        return res.status(403).send("Access Denied");
    }
    try {
        const response = await fetch(`${FIREBASE_URL}/admin.json?auth=${FIREBASE_SECRET}`);
        const data = await response.json();
        res.status(200).json({
            result: data?.result || "",
            heartbeat: data?.heartbeat || 0
        });
    } catch (error) {
        res.status(500).send("Unavailable");
    }
});

// --- Keep alive ---
const SELF_URL = process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";
setInterval(async () => {
    try {
        await fetch(`${SELF_URL}/`);
    } catch (e) {}
}, 10 * 60 * 1000);

// --- Server Startup ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Wall active on port ${PORT}`);
});
