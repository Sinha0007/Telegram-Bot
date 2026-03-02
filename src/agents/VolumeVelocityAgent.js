const BaseAgent = require('./BaseAgent');
const signalService = require('../services/SignalService');
const RugFilterAgent = require('./RugFilterAgent');
const SolanaRugFilterAgent = require('./SolanaRugFilterAgent');
const alphaEngine = require('./AlphaScoringEngine');

/**
 * VolumeVelocityAgent
 * 
 * Tracks volume changes over time to detect spikes.
 * Formula: Velocity = (Current Volume - Previous Volume) / Time
 * Signal: If % change > 300%
 */
class VolumeVelocityAgent extends BaseAgent {
    constructor(dexScreenerService) {
        super('VolumeVelocityAgent');
        this.dexService = dexScreenerService;
        this.rugFilter = new RugFilterAgent();
        this.solanaRugFilter = new SolanaRugFilterAgent();

        // key: pairAddress, value: { volume: number, timestamp: number }
        this.lastSnapshots = new Map();

        // key: pairAddress, value: timestamp
        this.lastSignalTime = new Map();

        // Config
        this.THROTTLE_MS = 30 * 60 * 1000; // 30 minutes cooldown
        this.trackedTokens = [
            'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' // Bonk (Example)
        ];
    }

    async run() {
        try {
            // Fetch data for tracked tokens
            const pairs = await this.dexService.getTokens(this.trackedTokens.join(','));
            const now = Date.now();

            for (const pair of pairs) {
                const pairId = pair.pairAddress;
                const ticker = pair.baseToken.symbol;
                const contractAddress = pair.baseToken.address;
                const currentVolume = pair.volume.h24;

                if (this.lastSnapshots.has(pairId)) {
                    const last = this.lastSnapshots.get(pairId);
                    const timeDiffSeconds = (now - last.timestamp) / 1000;

                    if (timeDiffSeconds > 0) {
                        const volumeDiff = currentVolume - last.volume;
                        const velocity = volumeDiff / timeDiffSeconds;
                        let pctIncrease = last.volume > 0 ? (volumeDiff / last.volume) * 100 : 0;

                        if (pctIncrease > 300 && this._canEmit(pairId, now)) {
                            console.log(`[VolumeVelocityAgent] Spike detected for ${ticker} (${pctIncrease.toFixed(1)}%)`);

                            // Auto-detect chain: Solana addresses don't start with 0x
                            const isSolana = !contractAddress.startsWith('0x');
                            const rugReport = isSolana
                                ? await this.solanaRugFilter.analyzeToken(contractAddress, ticker)
                                : await this.rugFilter.analyzeToken(contractAddress, ticker);

                            if (rugReport.blockAlert) {
                                console.warn(`[VolumeVelocityAgent] 🛑 Signal BLOCKED for ${ticker} (Rug Risk): ${rugReport.reasons?.join(', ')}`);
                                continue;
                            }

                            // Compute Alpha Score
                            const alphaResult = alphaEngine.computeAlphaScore({
                                volumeScore: 90, // High volume spike base score
                                rugScore: rugReport.rugScore,
                                engagement: 30
                            });

                            const signalData = {
                                ticker,
                                volume: currentVolume,
                                pctIncrease: pctIncrease.toFixed(1) + "%",
                                velocity: velocity.toFixed(2) + " / sec",
                                rugScore: rugReport.rugScore,
                                alphaScore: alphaResult.totalScore,
                                isAlpha: alphaResult.isAlpha,
                                reasons: rugReport.reasons
                            };

                            await signalService.broadcastSignal(ticker, 'VOLUME_SPIKE', signalData);
                            this._throttle(pairId, now);
                        }
                    }
                }

                // Update snapshot
                this.lastSnapshots.set(pairId, {
                    volume: currentVolume,
                    timestamp: now
                });
            }
        } catch (error) {
            console.error(`[${this.name}] Error:`, error.message);
        }
        return null;
    }

    _canEmit(pairId, now) {
        if (!this.lastSignalTime.has(pairId)) return true;
        const last = this.lastSignalTime.get(pairId);
        return (now - last) > this.THROTTLE_MS;
    }

    _throttle(pairId, now) {
        this.lastSignalTime.set(pairId, now);
    }
}

module.exports = VolumeVelocityAgent;
