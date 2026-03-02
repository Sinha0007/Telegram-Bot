require('dotenv').config();
const config = require('./config/config');
const logger = require('./utils/logger');
const api = require('./api');
const SniffAlphaBot = require('./bot');
const VolumeVelocityAgent = require('./agents/VolumeVelocityAgent');
const SocialVelocityAgent = require('./agents/SocialVelocityAgent');
const dexService = require('./services/DexScreenerService');
const db = require('./services/DatabaseService');

logger.info('--- 🚀 Starting SniffAlpha Intelligence System ---');

async function main() {
    // 0. Check for critical environment variables
    const requiredEnv = ['BOT_TOKEN', 'HELIUS_API_KEY', 'ALERT_CHANNEL_ID', 'DATABASE_URL'];
    const missingEnv = requiredEnv.filter(key => !process.env[key]);

    if (missingEnv.length > 0) {
        logger.warn(`Missing environment variables: ${missingEnv.join(', ')}`);
        logger.info('Note: Bot may not function correctly if critical variables are missing.');
    }

    // 0. Initialize Database (non-fatal — bot works without DB)
    logger.info('Initializing Database...');
    try {
        await db.init();
        logger.success('Database ready.');
    } catch (dbErr) {
        logger.warn(`Database unavailable: ${dbErr.message} — continuing without DB.`);
    }

    try {
        // 1. Start the API/Webhook server
        const port = process.env.PORT || config.PORT || 3000;
        logger.info(`Starting API & Webhook server on port ${port}...`);
        api.startAPI(port);

        const host = process.env.RAILWAY_STATIC_URL ? `https://${process.env.RAILWAY_STATIC_URL}` : `http://localhost:${port}`;
        logger.success(`API server online. Webhook receiver at ${host}/webhook/helius`);

        // 2. Start the Telegram Bot
        logger.info('Starting Telegram Bot...');
        if (!process.env.BOT_TOKEN) {
            logger.error('BOT_TOKEN is not set in environment variables! Telegram Bot CANNOT start.');
        } else {
            try {
                const bot = new SniffAlphaBot();
                module.exports.activeBot = bot;
                await bot.launch();
                logger.success('SniffAlpha Telegram Bot is LIVE and POLLING.');

                process.once('SIGINT', () => bot.stop('SIGINT'));
                process.once('SIGTERM', () => bot.stop('SIGTERM'));
            } catch (botErr) {
                logger.error(`Bot launch failed: ${botErr.message}`);
                logger.warn('Check that BOT_TOKEN in Railway Variables is correct and has no spaces.');
            }
        }

        // 3. Start Background Monitoring Agents (Periodic Intelligence)
        logger.info('Initializing Background Monitoring Workers...');
        const volumeAgent = new VolumeVelocityAgent(dexService);
        const socialAgent = new SocialVelocityAgent();

        setInterval(async () => {
            logger.info('[Monitor] Running periodic intelligence cycle...');
            await Promise.allSettled([
                volumeAgent.run(),
                socialAgent.run()
            ]);
        }, 5 * 60 * 1000);

        logger.success('Periodic Monitoring Workers are ACTIVE.');

        // 4. Graceful shutdown handler
        const stopAll = async (signal) => {
            logger.info(`Received ${signal}. Shutting down...`);
            if (module.exports.activeBot) {
                module.exports.activeBot.stop(signal);
            }
            process.exit(0);
        };

        process.once('SIGINT', () => stopAll('SIGINT'));
        process.once('SIGTERM', () => stopAll('SIGTERM'));

    } catch (error) {
        logger.error('Critical failure on startup:', error.message);
        // Don't exit — let Railway keep the container alive for debugging logs
    }
}

main();
