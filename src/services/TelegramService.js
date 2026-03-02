const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const config = require('../config/config');
const logger = require('../utils/logger');

class TelegramService {
    constructor() {
        // Only initialize if credentials are set — skip entirely otherwise
        this.enabled = !!(process.env.TELEGRAM_API_ID && process.env.TELEGRAM_API_HASH);
        if (!this.enabled) {
            logger.warn('[TelegramService] TELEGRAM_API_ID/HASH not set — Telegram social monitoring disabled.');
            return;
        }
        this.apiId = parseInt(process.env.TELEGRAM_API_ID);
        this.apiHash = process.env.TELEGRAM_API_HASH;
        this.stringSession = new StringSession(process.env.TELEGRAM_SESSION || '');
        this.client = null;
    }

    async init() {
        if (!this.enabled) return;
        try {
            this.client = new TelegramClient(this.stringSession, this.apiId, this.apiHash, {
                connectionRetries: 5,
            });
            await this.client.connect();
        } catch (error) {
            logger.error('Telegram client connection failed:', error.message);
        }
    }

    /**
     * Search for mentions in Telegram messages.
     * Note: Telegram's global search is limited. Usually, we search specific channels.
     */
    async fetchMentions(query) {
        if (!this.client || !query) return { totalMentions: 0 };
        try {
            // Global search for messages in the last 1 hour
            const oneHourAgo = Math.floor(Date.now() / 1000) - (60 * 60);

            const result = await this.client.getMessages(null, {
                search: query,
                limit: 100,
            });

            let count = 0;
            for (const msg of result) {
                if (msg.date >= oneHourAgo) {
                    count++;
                }
            }

            return { totalMentions: count };
        } catch (error) {
            logger.error(`Error fetching Telegram mentions for ${query}:`, error.message);
            return { totalMentions: 0 };
        }
    }
}

module.exports = new TelegramService();
