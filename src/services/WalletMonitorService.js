/**
 * WalletMonitorService.js
 * 
 * Background service that periodically runs the SmartWalletAgent
 * and broadcasts alerts to a specific Telegram channel.
 */
class WalletMonitorService {
    /**
     * @param {Telegraf} bot - Telegraf instance
     * @param {BaseAgent} agent - The agent to run (e.g., SmartWalletAgent)
     */
    constructor(bot, agent) {
        this.bot = bot;
        this.agent = agent;
        this.intervalId = null;
        this.intervalMs = 15000; // 15 seconds
        this.alertChannelId = process.env.ALERT_CHANNEL_ID;
    }

    /**
     * Starts the polling loop
     */
    start() {
        console.log(`[WalletMonitorService] Starting background monitor for ${this.agent.name}...`);

        if (!this.alertChannelId) {
            console.warn('⚠️  ALERT_CHANNEL_ID is not defined in .env. Background alerts will skip Telegram broadcasting.');
        }

        this.intervalId = setInterval(async () => {
            try {
                await this._poll();
            } catch (error) {
                console.error(`[WalletMonitorService] Fatal error in polling loop:`, error.message);
            }
        }, this.intervalMs);
    }

    /**
     * Stops the polling loop
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            console.log(`[WalletMonitorService] Monitor stopped.`);
        }
    }

    /**
     * Private poll execution logic
     */
    async _poll() {
        // console.log(`[WalletMonitorService] Running ${this.agent.name}...`);

        // SmartWalletAgent.run doesn't need ctx anymore
        const signal = await this.agent.run();

        if (signal && signal.signalType === "SMART_WALLET_CLUSTER") {
            console.log(`📡 [WalletMonitorService] SIGNAL DETECTED:`, signal);

            if (this.alertChannelId) {
                const message = `🚨 *Smart Wallet Cluster Detected*\n\n` +
                    `💎 *Token:* \`${signal.token}\`\n` +
                    `👥 *Wallets:* ${signal.metadata.count}\n` +
                    `⏱️ *Window:* ${signal.metadata.timeframeMinutes} mins`;

                try {
                    await this.bot.telegram.sendMessage(this.alertChannelId, message, { parse_mode: 'Markdown' });
                    console.log(`✅ Alert sent to channel ${this.alertChannelId}`);
                } catch (tgError) {
                    console.error(`❌ Failed to send Telegram alert:`, tgError.message);
                }
            }
        }
    }
}

module.exports = WalletMonitorService;
