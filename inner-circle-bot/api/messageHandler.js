const express = require('express');
const router = express.Router();
const { processMasterChannelMessage } = require('../services/masterChannelService');

// Middleware to verify API token
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    if (token !== process.env.BOT_API_TOKEN) {
        return res.status(401).json({ error: 'Invalid token' });
    }

    next();
};

// Endpoint to receive messages from user bot
router.post('/message', verifyToken, async (req, res) => {
    try {
        const { message, source } = req.body;

        if (!message || !source) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Create a mock message object that matches Telegram message format
        const mockMsg = {
            chat: { id: process.env.MASTER_CHAT_ID },
            from: { id: process.env.FIRST_LEDGER_BOT_ID },
            text: message
        };

        // Process the message using existing master channel service
        await processMasterChannelMessage(global.bot, mockMsg);

        res.json({ success: true });
    } catch (error) {
        console.error('Error processing forwarded message:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router; 