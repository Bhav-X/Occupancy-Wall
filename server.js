const express = require('express');
const app = express();
app.use(express.json());

// These variables will be injected secretly by Render
const ESP_TOKEN = process.env.ESP_TOKEN || "FallbackSecret123";
const KILL_SWITCH = process.env.KILL_SWITCH === 'true'; // Set to 'true' in Render to drop traffic
const FIREBASE_URL = process.env.FIREBASE_URL; 
const FIREBASE_SECRET = process.env.FIREBASE_SECRET;

app.post('/api/update', async (req, res) => {
    // 1. Check Kill Switch
    if (KILL_SWITCH) return res.status(503).json({ error: "System Offline: Maintenance Mode" });
    
    // 2. The Bouncer (Check ESP Auth)
    if (req.headers.authorization !== `Bearer ${ESP_TOKEN}`) {
        return res.status(401).json({ error: "Access Denied: Invalid Token" });
    }

    const { room_id, headcount } = req.body;
    if (!room_id || headcount === undefined) return res.status(400).json({ error: "Missing data" });

    // 3. Forward securely to Firebase Realtime DB (OVERWRITE data, zero storage bloat)
    try {
        // We use PUT to replace the value, keeping DB size at near 0MB
        const fbResponse = await fetch(`${FIREBASE_URL}/rooms/${room_id}.json?auth=${FIREBASE_SECRET}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ headcount: headcount, last_updated: Date.now() })
        });
        
        if (!fbResponse.ok) throw new Error("Firebase rejected the request");
        
        res.status(200).json({ success: true, message: "Wall Passed. Database updated." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Database connection failed" });
    }
});

app.listen(process.env.PORT || 3000, () => console.log("Invisible Wall is UP!"));
