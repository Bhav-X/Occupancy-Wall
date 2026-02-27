const express = require('express');
const app = express();

// Allows the server to read JSON data from the ESP32
app.use(express.json());

// Pulling your secret passwords from Render's Environment Variables
const FIREBASE_URL = process.env.FIREBASE_URL; // e.g., https://your-project.firebaseio.com
const FIREBASE_SECRET = process.env.FIREBASE_SECRET;
const ESP_TOKEN = process.env.ESP_TOKEN;
const READ_TOKEN = process.env.READ_TOKEN;

// Fixes the "Cannot GET /" error so you know it's alive
app.get('/', (req, res) => {
    res.send("🛡️ The Invisible Wall is UP and running!");
});

// ---------------------------------------------------------
// ESP32 -> Render -> Firebase (Writing Data)
// ---------------------------------------------------------
app.post('/api/update', async (req, res) => {
    // 1. Check the ESP32's VIP Pass
    if (req.headers.authorization !== `Bearer ${ESP_TOKEN}`) {
        return res.status(403).send("Access Denied: Wrong Token");
    }

    // 2. Unpack the box
    const { roomStatus, heartbeat, adminResult } = req.body;

    try {
        // 3. Send to Firebase using the Master Secret
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
        res.status(200).send("Data saved to vault");
    } catch (error) {
        console.error("Firebase Error:", error);
        res.status(500).send("Failed to reach vault");
    }
});

// ---------------------------------------------------------
// ESP32 <- Render <- Firebase (Reading Data)
// ---------------------------------------------------------
app.get('/api/status', async (req, res) => {
    // 1. Check the ESP8266/ESP32's Read Pass
    if (req.headers.authorization !== `Bearer ${READ_TOKEN}`) {
        return res.status(403).send("Access Denied: Wrong Token");
    }

    try {
        // Fetch the whole database tree to send to the boards
        const response = await fetch(`${FIREBASE_URL}/.json?auth=${FIREBASE_SECRET}`);
        const data = await response.json();
        
        res.status(200).json(data || {});
    } catch (error) {
        console.error("Firebase Error:", error);
        res.status(500).send("Database error");
    }
});

// Start up the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🛡️ Wall listening on port ${PORT}`);
});
