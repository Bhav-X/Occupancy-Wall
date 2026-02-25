const express = require('express');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors()); // Makes the Wall invisible to browser security blocks

const ESP_TOKEN = process.env.ESP_TOKEN || "SuperSecureSchoolProject2026";
const FIREBASE_URL = process.env.FIREBASE_URL; 
const FIREBASE_SECRET = process.env.FIREBASE_SECRET;

// 🛑 1. THE WRITER (ESP32 sends data here)
app.post('/api/update', async (req, res) => {
    // Invisible Bouncer
    if (req.headers.authorization !== `Bearer ${ESP_TOKEN}`) {
        return res.status(401).send("Denied");
    }

    const { roomStatus, heartbeat, adminResult } = req.body;
    if (!roomStatus) return res.status(400).send("Bad Data");

    try {
        // Render uses its God-Mode secret to overwrite the locked DB
        await fetch(`${FIREBASE_URL}/roomStatus.json?auth=${FIREBASE_SECRET}`, {
            method: 'PUT', body: JSON.stringify(roomStatus)
        });
        if (heartbeat) {
            await fetch(`${FIREBASE_URL}/heartbeat.json?auth=${FIREBASE_SECRET}`, {
                method: 'PUT', body: JSON.stringify(heartbeat)
            });
        }
        if (adminResult) {
            await fetch(`${FIREBASE_URL}/admin/result.json?auth=${FIREBASE_SECRET}`, {
                method: 'PUT', body: JSON.stringify(adminResult)
            });
        }
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).send("Proxy Error");
    }
});

// 🟢 2. THE READER (Website & ESP8266 get data here)
app.get('/api/status', async (req, res) => {
    try {
        // Render fetches the whole DB state using its secret and hands it to the user
        const response = await fetch(`${FIREBASE_URL}/.json?auth=${FIREBASE_SECRET}`);
        const data = await response.json();
        res.status(200).json(data);
    } catch (error) {
        res.status(500).send("Proxy Error");
    }
});

// 3. ADMIN COMMANDS (Website sends commands to ESP32 via here)
app.post('/api/command', async (req, res) => {
    const { key, cmd } = req.body;
    // Basic password for your website UI
    if (key !== "AdminKey2026") return res.status(401).send("Denied");

    try {
        await fetch(`${FIREBASE_URL}/admin/cmd.json?auth=${FIREBASE_SECRET}`, {
            method: 'PUT', body: JSON.stringify(cmd)
        });
        await fetch(`${FIREBASE_URL}/admin/key.json?auth=${FIREBASE_SECRET}`, {
            method: 'PUT', body: JSON.stringify(key)
        });
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).send("Proxy Error");
    }
});

app.listen(process.env.PORT || 3000, () => console.log("Invisible Proxy is UP!"));
