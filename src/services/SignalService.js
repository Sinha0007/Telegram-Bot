const axios = require('axios');
const db = require('./DatabaseService');
require('dotenv').config();

class SignalService {
    constructor() {
        this.botToken = process.env.BOT_TOKEN;
        this.alertChannelId = process.env.ALERT_CHANNEL_ID;
    }

    /**
     * Broadcast a signal to all configured channels (Telegram, DB, Webhook)
     * @param {string} ticker - Token ticker
     * @param {string} signalType - e.g. 'SOCIAL_ACCELERATION', 'VOLUME_SPIKE'
     * @param {object} data - The full signal data including alpha score and rug report
     * @param {string} webhookUrl - Optional webhook
     */
    async broadcastSignal(ticker, signalType, data, webhookUrl = null) {
        console.log(`[SignalService] 📢 Broadcasting ${signalType} for ${ticker}`);

        // 1. Store in Database
        try {
            await db.query(
                'INSERT INTO signals (ticker, signal_type, score, meta_data) VALUES ($1, $2, $3, $4)',
                [ticker, signalType, data.alphaScore || 20, JSON.stringify(data)]
            );
        } catch (e) {
            console.error('[SignalService] DB Store failed:', e.message);
        }

        // 2. Telegram Alert
        if (this.botToken && this.alertChannelId) {
            const message = this._formatTelegramMessage(ticker, signalType, data);
            const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
            try {
                await axios.post(url, {
                    chat_id: this.alertChannelId,
                    text: message,
                    parse_mode: 'Markdown'
                });
            } catch (e) {
                console.error('[SignalService] Telegram Alert failed:', e.response?.data || e.message);
            }
        }

        // 3. Webhook Trigger
        const targetWebhook = webhookUrl || process.env.DEFAULT_WEBHOOK_URL;
        if (targetWebhook) {
            try {
                await axios.post(targetWebhook, {
                    event: signalType,
                    ticker: ticker,
                    timestamp: new Date().toISOString(),
                    data: data
                });
            } catch (e) {
                console.error('[SignalService] Webhook Trigger failed:', e.message);
            }
        }
    }

    _formatTelegramMessage(ticker, signalType, data) {
        let header = `🚀 *SIGNAL DETECTED: ${signalType.replace(/_/g, ' ')}* 🚀\n\n`;
        if (data.isAlpha) header = `🔥 *HIGH QUALITY ALPHA DETECTED* 🔥\n\n`;

        let body = `Token: $${ticker}\n`;

        if (signalType === 'SOCIAL_ACCELERATION') {
            body += `Velocity: +${data.mentionVelocity} mentions/5m\n` +
                `Total Mentions: ${data.totalMentions}\n` +
                `Engagement: ${data.engagementScore?.toFixed(2)}\n`;
        } else if (signalType === 'VOLUME_SPIKE') {
            body += `Volume (24h): $${data.volume?.toLocaleString()}\n` +
                `Increase: ${data.pctIncrease}\n` +
                `Velocity: ${data.velocity}\n`;
        }

        body += `\n🛡️ *Security Report*\n` +
            `Rug Score: ${data.rugScore}/100\n` +
            `Block Status: ${data.blockAlert ? '🛑 BLOCKED' : '✅ PASSED'}\n`;

        if (data.reasons && data.reasons.length > 0) {
            body += `Notes: ${data.reasons.join(', ')}\n`;
        }

        body += `\n⭐ *Alpha Score: ${data.alphaScore}/100*`;

        return header + body;
    }
}

module.exports = new SignalService();
