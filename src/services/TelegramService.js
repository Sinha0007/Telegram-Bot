const logger = require('../utils/logger');

/**
 * TelegramService
 * 
 * Placeholder for Telegram MTProto social monitoring.
 * Currently disabled — social signals are sourced via Apify.
 * Enable this by providing TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION
 * and installing the 'telegram' package.
 */
class TelegramService {
    constructor() {
        this.enabled = false;
        logger.warn('[TelegramService] Telegram social monitoring is disabled. Using Apify for social signals.');
    }

    async init() {
        // Not implemented — Apify handles social monitoring
    }

    async fetchMentions(query) {
        // Returns zeros gracefully — scoring engine handles this safely
        return { totalMentions: 0, engagementScore: 0 };
    }
}

module.exports = new TelegramService();
