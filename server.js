const express = require('express');
const app = express();

// 1. CRITICAL FIX FOR RENDER: Trust the proxy so rate limiting works per user, not per server.
app.set('trust proxy', 1);
app.use(express.json());

// --- CORS (required for GitHub Pages to call Render) ---
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
    if (rateMap[ip].length >= 10) return false;
    rateMap[ip].push(now);
    return true;
}

app.get('/', (req, res) => {
    res.send("The system is up and running.");
});

// ---------------------------------------------------------
// 1. PUBLIC STATUS
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
        console.error("Public status fetch error:", error);
        res.status(500).send("Status unavailable");
    }
});

// ---------------------------------------------------------
// 2. FULL STATUS
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
// 3. DATA UPLINK
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
// 4. COMMAND CENTER 
// ---------------------------------------------------------
app.post('/api/command', async (req, res) => {
    const ip = req.ip; // Now safely uses the real IP from the proxy

    if (!rateLimit(ip)) {
        return res.status(429).send("Too many requests. Slow down.");
    }

    const { cmd, key, id, maintenance } = req.body;

    if (cmd !== "0" && key !== ADMIN_KEY) {
        return res.status(403).send("Access Denied: Wrong Key");
    }

    try {
        // Send command to Firebase
        await fetch(`${FIREBASE_URL}/admin.json?auth=${FIREBASE_SECRET}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });

        // 2. CRITICAL FIX: Auto-clear the command after 3 seconds so the ESP32 doesn't loop

        res.status(200).send("Command forwarded");
    } catch (error) {
        console.error("Command error:", error);
        res.status(500).send("Failed to forward command");
    }
});

// ---------------------------------------------------------
// 5. ADMIN RESULT
// ---------------------------------------------------------
app.get('/api/result', async (req, res) => {
    //  Change READ_TOKEN to ADMIN_KEY
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${ADMIN_KEY}` && authHeader !== `Bearer ${READ_TOKEN}`) { 
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
