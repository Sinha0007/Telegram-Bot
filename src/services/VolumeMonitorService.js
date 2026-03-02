/**
 * VolumeMonitorService.js
 * 
 * Periodically runs the VolumeVelocityAgent and alerts on spikes.
 */
class VolumeMonitorService {
    constructor(bot, agent) {
        this.bot = bot;
        this.agent = agent;
        this.intervalId = null;
        this.intervalMs = 2 * 60 * 1000; // 2 minutes
        this.alertChannelId = process.env.ALERT_CHANNEL_ID;
    }

    start() {
        console.log(`[VolumeMonitorService] Starting background monitor...`);

        this.intervalId = setInterval(async () => {
            await this._poll();
        }, this.intervalMs);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            console.log(`[VolumeMonitorService] Stopped.`);
        }
    }

    async _poll() {
        const signals = await this.agent.run();

        if (signals) {
            // Handle array of signals
            const list = Array.isArray(signals) ? signals : [signals];

            for (const signal of list) {
                if (signal.signalType === 'VOLUME_SPIKE') {
                    console.log(`📈 [VolumeMonitorService] SPIKE DETECTED:`, signal);

                    if (this.alertChannelId) {
                        const message = `📈 *Volume Spike Detected*\n\n` +
                            `🪙 *Token:* \`${signal.token}\`\n` +
                            `🚀 *Increase:* ${signal.metadata.pctIncrease}\n` +
                            `⚡ *Velocity:* ${signal.metadata.velocity}\n` +
                            `💰 *24h Vol:* $${signal.metadata.volume.toLocaleString()}`;

                        try {
                            await this.bot.telegram.sendMessage(this.alertChannelId, message, { parse_mode: 'Markdown' });
                        } catch (err) {
                            console.error('❌ Telegram Send Error:', err.message);
                        }
                    }
                }
            }
        }
    }
}

module.exports = VolumeMonitorService;
