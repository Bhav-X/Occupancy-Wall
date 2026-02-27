const express = require('express');
const app = express();

// Allows the server to read JSON data from the ESPs and the Website
app.use(express.json());

// --- Environment Variables (Set these in your Render Dashboard) ---
const FIREBASE_URL = process.env.FIREBASE_URL;    // Your Firebase Realtime DB URL
const FIREBASE_SECRET = process.env.FIREBASE_SECRET; // Your Firebase Database Secret
const ESP_TOKEN = process.env.ESP_TOKEN;          // Secret for ESP32 to write data
const READ_TOKEN = process.env.READ_TOKEN;        // Secret for Receiver/Website to read data

// Root route to check if server is alive
app.get('/', (req, res) => {
    res.send("🛡️ The Invisible Wall is UP and running!");
});

// ---------------------------------------------------------
// 1. DATA UPLINK: ESP32 -> Render -> Firebase
// ---------------------------------------------------------
app.post('/api/update', async (req, res) => {
    // Security check: Only your ESP32 should have this token
    if (req.headers.authorization !== `Bearer ${ESP_TOKEN}`) {
        return res.status(403).send("Access Denied: Invalid Uplink Token");
    }

    const { roomStatus, heartbeat, adminResult } = req.body;

    try {
        // We update specific nodes in Firebase using the Master Secret
        if (roomStatus) {
            await fetch(`${FIREBASE_URL}/roomStatus.json?auth=${FIREBASE_SECRET}`, {
                method: 'PUT',
                body: JSON.stringify(roomStatus)
            });
        }
        if (heartbeat) {
            await fetch(`${FIREBASE_URL}/admin/heartbeat.json?auth=${FIREBASE_SECRET}`, {
                method: 'PUT',
                body: JSON.stringify(heartbeat)
            });
        }
        if (adminResult) {
            await fetch(`${FIREBASE_URL}/admin/result.json?auth=${FIREBASE_SECRET}`, {
                method: 'PUT',
                body: JSON.stringify(adminResult)
            });
        }
        res.status(200).send("Data synced to Firebase");
    } catch (error) {
        console.error("Firebase Sync Error:", error);
        res.status(500).send("Internal Sync Error");
    }
});

// ---------------------------------------------------------
// 2. DATA DOWNLINK: ESP8266/Website <- Render <- Firebase
// ---------------------------------------------------------
app.get('/api/status', async (req, res) => {
    // Security check: Verify the Read Token
    if (req.headers.authorization !== `Bearer ${READ_TOKEN}`) {
        return res.status(403).send("Access Denied: Invalid Read Token");
    }

    try {
        // Fetch the entire database tree so the ESPs/Web get everything in one go
        const response = await fetch(`${FIREBASE_URL}/.json?auth=${FIREBASE_SECRET}`);
        const data = await response.json();
        
        res.status(200).json(data || {});
    } catch (error) {
        console.error("Database Fetch Error:", error);
        res.status(500).send("Database Unreachable");
    }
});

// ---------------------------------------------------------
// 3. COMMAND CENTER: Website -> Render -> Firebase
// ---------------------------------------------------------
app.post('/api/command', async (req, res) => {
    // Note: Security here is handled by the 'key' (Admin Password) inside the body 
    // which the ESP32 verifies before acting on 'cmd'.
    
    try {
        // We use PATCH so we don't overwrite the heartbeat or result by accident
        await fetch(`${FIREBASE_URL}/admin.json?auth=${FIREBASE_SECRET}`, {
            method: 'PATCH',
            body: JSON.stringify(req.body) 
        });
        res.status(200).send("Command/Maintenance flag forwarded");
    } catch (error) {
        console.error("Command Error:", error);
        res.status(500).send("Failed to forward command");
    }
});

// --- Server Startup ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🛡️ Wall active on port ${PORT}`);
});
