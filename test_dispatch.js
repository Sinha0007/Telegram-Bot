/**
 * test_dispatch.js
 * 
 * Manual end-to-end test for the AlertDispatcher.
 * 
 * Usage:
 *   1. Make sure the bot server is running: npm run dev
 *   2. Run this script: node test_dispatch.js
 * 
 * This will:
 *   - Hit the POST /dispatch endpoint
 *   - The dispatcher enriches data via DexScreener
 *   - Sends a formatted alert to your ALERT_CHANNEL_ID in Telegram
 */

const axios = require('axios');

const API_URL = 'http://localhost:3000';

// ─────────────────────────────────────────────
// Test payload — real BONK token on Solana
// ─────────────────────────────────────────────
const testSignal = {
    token_name: "Bonk",
    ticker: "BONK",
    contract_address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    alphaScore: 78,
    confidence: 85,
    signalsUsed: [
        "SOCIAL_ACCELERATION",
        "VOLUME_SPIKE",
        "SMART_WALLET_CLUSTER"
    ],
    breakdown: {
        "Social Velocity": "94/100",
        "Volume Score": "80/100",
        "Rug Score": "12/100 ✅",
        "Smart Wallets": "3 clusters detected"
    }
};

async function runTest() {
    console.log('📡 Sending test dispatch request...\n');
    console.log('Payload:', JSON.stringify(testSignal, null, 2), '\n');

    try {
        const res = await axios.post(`${API_URL}/dispatch`, testSignal);
        console.log(`✅ Response [${res.status}]:`, res.data);

        if (res.data.sent) {
            console.log('\n🎉 Check your Telegram channel — the alert should have arrived!');
        } else {
            console.log(`\n⏳ Alert not sent. Reason: "${res.data.reason}"`);
            console.log('   If reason is "cooldown", wait 2 hours or temporarily set ALERT_COOLDOWN_MINUTES=0 in .env');
        }
    } catch (err) {
        if (err.code === 'ECONNREFUSED') {
            console.error('❌ Server is not running. Start it with: npm run dev');
        } else {
            console.error('❌ Error:', err.response?.data || err.message);
        }
    }
}

runTest();
