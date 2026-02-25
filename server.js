const express = require('express');
const app = express();
app.use(express.json());

// These variables will be injected secretly by Render
const ESP_TOKEN = process.env.ESP_TOKEN || "Firewall@1153";
const KILL_SWITCH = process.env.KILL_SWITCH === 'true'; 
const FIREBASE_URL = process.env.FIREBASE_URL; 
const FIREBASE_SECRET = process.env.FIREBASE_SECRET;

app.post('/api/update', async (req, res) => {
    // 1. Check Kill Switch
    if (KILL_SWITCH) return res.status(503).json({ error: "System Offline: Maintenance Mode" });
    
    // 2. The Bouncer (Check ESP Auth)
    if (req.headers.authorization !== `Bearer ${ESP_TOKEN}`) {
        return res.status(401).json({ error: "Access Denied: Invalid Token" });
    }

    // 3. Grab the exact data your ESP32 is sending
    const { roomStatus, heartbeat, adminResult } = req.body;
    
    // If there's no status at all, reject it
    if (!roomStatus) return res.status(400).json({ error: "Missing roomStatus data" });

    // 4. Forward securely to Firebase
    try {
        // Update the main FREE/BUSY status
        const statusRes = await fetch(`${FIREBASE_URL}/roomStatus.json?auth=${FIREBASE_SECRET}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(roomStatus)
        });
        if (!statusRes.ok) throw new Error("Firebase rejected the status update");

        // Update heartbeat if the ESP32 sent one
        if (heartbeat) {
            await fetch(`${FIREBASE_URL}/heartbeat.json?auth=${FIREBASE_SECRET}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(heartbeat)
            });
        }

        // Update admin logs if the ESP32 sent one
        if (adminResult) {
            await fetch(`${FIREBASE_URL}/admin/result.json?auth=${FIREBASE_SECRET}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(adminResult)
            });
        }
        
        res.status(200).json({ success: true, message: "Wall Passed. Database updated." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Database connection failed" });
    }
});

app.listen(process.env.PORT || 3000, () => console.log("Invisible Wall is UP!"));
