require('dotenv').config();
const config = require('./config/config');
const logger = require('./utils/logger');
const api = require('./api');
const SniffAlphaBot = require('./bot');
const VolumeVelocityAgent = require('./agents/VolumeVelocityAgent');
const SocialVelocityAgent = require('./agents/SocialVelocityAgent');
const dexService = require('./services/DexScreenerService');

logger.info('--- 🚀 Starting SniffAlpha Intelligence System ---');

async function main() {
    try {
        // 1. Start the API/Webhook server
        logger.info(`Starting API & Webhook server on port ${config.PORT}...`);
        api.startAPI();
        logger.success(`API server online. Webhook at http://localhost:${config.PORT}/webhook/helius`);

        // 2. Start the Telegram Bot
        logger.info('Starting Telegram Bot...');
        const bot = new SniffAlphaBot();
        module.exports.activeBot = bot;
        await bot.launch();
        logger.success('SniffAlpha Bot is live!');

        // 3. Start Background Monitoring Agents (Periodic Intelligence)
        logger.info('Initializing Background Monitoring Workers...');
        const volumeAgent = new VolumeVelocityAgent(dexService);
        const socialAgent = new SocialVelocityAgent();

        // Run every 5 minutes
        const startMonitoring = () => {
            setInterval(async () => {
                logger.info('[Monitor] Running periodic intelligence cycle...');
                await Promise.allSettled([
                    volumeAgent.run(),
                    socialAgent.run()
                ]);
            }, 5 * 60 * 1000);
        };

        startMonitoring();
        logger.success('Periodic Monitoring Workers are ACTIVE.');

        // 3. Graceful shutdown
        const stopAll = async () => {
            logger.info('Shutting down...');
            bot.stop();
            process.exit(0);
        };

        process.once('SIGINT', stopAll);
        process.once('SIGTERM', stopAll);

    } catch (error) {
        logger.error('Critical failure on startup:', error.message);
        process.exit(1);
    }
}

main();
