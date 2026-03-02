const express = require('express');
const bodyParser = require('body-parser');
const alphaScoringService = require('../services/AlphaScoringService');
const config = require('../config/config');
const logger = require('../utils/logger');

const router = express.Router();

// Middleware to parse body if not already done in app.js
router.use(bodyParser.json());

/**
 * Helius Webhook Endpoint
 * POST /webhook/helius
 */
router.post('/helius', async (req, res) => {
    try {
        const events = req.body;

        // Helius sends an array of events
        if (!Array.isArray(events)) {
            return res.status(400).send('Invalid webhook structure');
        }

        logger.info(`[HeliusWebhook] Received ${events.length} event(s)`);

        // Process each event asynchronously (non-blocking)
        for (const event of events) {
            processEvent(event).catch(err => {
                logger.error(`[HeliusWebhook] Event processing failed:`, err.message);
            });
        }

        // Return 200 immediately to confirm receipt
        res.status(200).send('Webhook received');
    } catch (error) {
        logger.error(`[HeliusWebhook] Critical error:`, error.message);
        res.status(500).send('Internal server error');
    }
});

/**
 * Handle individual Helius event
 * Supports: TOKEN_MINT, INITIALIZE_MINT
 */
async function processEvent(event) {
    const { type, tokenTransfers, instructions, nativeTransfers, events } = event;

    // 1. Identify token-minting events
    // Case A: Standard Mint Event type
    let mint = null;
    let deployer = null;

    if (type === 'TOKEN_MINT' || type === 'INITIALIZE_MINT') {
        // Try to extract from instruction (common for spl-token)
        const initMint = instructions?.find(inst => inst.programId === 'TokenkegQfeZyiNwAJbV6t4X71QXag9D3J7ubz6f');
        if (initMint) {
            mint = initMint.accounts?.[0]; // Usually first account in initMint
            deployer = event.feePayer;
        }
    }

    // Case B: Fallback to token transfers or native tx details
    if (!mint && event.description && event.description.includes('minted')) {
        // Simple regex fallback for description-based detection if enabled in Helius
        const match = event.description.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
        if (match) mint = match[0];
        deployer = event.feePayer;
    }

    if (!mint) return;

    // 2. Trigger analysis pipeline
    logger.info(`[HeliusWebhook] New Token Detected: ${mint}`);

    // Fetch basic metadata first for ticker if possible
    // (Assuming HeliusService or BirdeyeService might have this later, for now we pass CA)
    const result = await alphaScoringService.computeScore(mint, mint.substring(0, 4), deployer);

    // 3. Log results
    logger.token(mint, result);

    // 4. Future: If Alpha Score > threshold, send to Telegram channel
    // (This would be integrated with the TelegramService/Bot instance later)
}

module.exports = router;
