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
        logger.info(`Starting API & Webhook server on port ${config.PORT}...`);
        api.startAPI();
        logger.success(`API server online. Webhook at http://localhost:${config.PORT}/webhook/helius`);

        // 2. Start the Telegram Bot
        logger.info('Starting Telegram Bot...');
        if (!process.env.BOT_TOKEN) {
            logger.error('BOT_TOKEN is not set in environment variables! Bot cannot start.');
        } else {
            try {
                const bot = new SniffAlphaBot();
                module.exports.activeBot = bot;
                await bot.launch();
                logger.success('SniffAlpha Bot is live!');

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

        // 4. Graceful shutdown
        const stopAll = async () => {
            logger.info('Shutting down...');
            bot.stop();
            process.exit(0);
        };

        process.once('SIGINT', stopAll);
        process.once('SIGTERM', stopAll);

    } catch (error) {
        logger.error('Critical failure on startup:', error.message);
        // Don't exit — let Railway keep the container alive for debugging
    }
}

main();
