const cron = require('node-cron');
const SocialVelocityAgent = require('../agents/SocialVelocityAgent');
const db = require('../services/DatabaseService');
const telegramService = require('../services/TelegramService');

class SocialMonitorService {
    constructor() {
        this.agent = new SocialVelocityAgent();
        this.task = null;
    }

    async start() {
        console.log('[SocialMonitorService] Initializing...');

        if (!db.enabled) {
            console.warn('[SocialMonitorService] Database disabled. Skipping initialization.');
            return;
        }

        // 1. Initialize Database
        try {
            await db.init();
        } catch (e) {
            console.error('[SocialMonitorService] Database init failed:', e.message);
            return;
        }

        // 2. Initialize Telegram Service (Client API)
        if (!process.env.TELEGRAM_API_ID || !process.env.TELEGRAM_API_HASH) {
            console.warn('[SocialMonitorService] Telegram User API credentials missing. Skipping User API features.');
            // We can still continue if other parts work
        } else {
            await telegramService.init();
        }

        // 3. Schedule Cron Task: Every 5 minutes
        // cron.schedule('*/5 * * * *', ...)
        this.task = cron.schedule('*/5 * * * *', async () => {
            await this.agent.run();
        });

        console.log('[SocialMonitorService] Background task scheduled (every 5 minutes)');

        // Run once immediately on start
        this.agent.run();
    }

    stop() {
        if (this.task) {
            this.task.stop();
        }
        console.log('[SocialMonitorService] Background task stopped');
    }
}

module.exports = new SocialMonitorService();
