const BaseAgent = require('./BaseAgent');
const twitterService = require('../services/TwitterService');
const telegramService = require('../services/TelegramService');
const db = require('../services/DatabaseService');
const signalService = require('../services/SignalService');
const RugFilterAgent = require('./RugFilterAgent');
const SolanaRugFilterAgent = require('./SolanaRugFilterAgent');
const alphaEngine = require('./AlphaScoringEngine');
require('dotenv').config();

/**
 * SocialVelocityAgent
 * 
 * Detects early-stage social acceleration for tokens.
 * Periodically fetches mentions, stores in DB, and computes velocity/acceleration.
 */
class SocialVelocityAgent extends BaseAgent {
    constructor() {
        super('SocialVelocityAgent');
        this.intervalMinutes = 5;
        this.rugFilter = new RugFilterAgent();
        this.solanaRugFilter = new SolanaRugFilterAgent();
    }

    /**
     * Main run loop - called every 5 minutes by the monitor service or its own cron
     */
    async run() {
        console.log(`[SocialVelocityAgent] Running scheduled check at ${new Date().toISOString()}`);

        try {
            // 1. Fetch all tokens to monitor
            const tokens = await db.query('SELECT * FROM token_configs');

            for (const config of tokens.rows) {
                await this.processToken(config);
            }
        } catch (error) {
            console.error('[SocialVelocityAgent] Error in run loop:', error);
        }
    }

    /**
     * Process a single token
     */
    async processToken(config) {
        const { ticker, token_name, contract_address, velocity_threshold, early_limit, webhook_url } = config;

        // Search queries
        const queries = [token_name, `$${ticker}`];
        if (contract_address) queries.push(contract_address);

        let totalMentions = 0;
        let totalEngagement = 0;

        // 2. Fetch from Twitter & Telegram
        for (const query of queries) {
            const twData = await twitterService.fetchMentions(query);
            const tgData = await telegramService.fetchMentions(query);

            totalMentions += twData.totalMentions + tgData.totalMentions;
            totalEngagement += twData.engagementScore;
        }

        // 3. Store mentions in database
        await db.query(
            'INSERT INTO mentions (ticker, source, mention_count, engagement_score) VALUES ($1, $2, $3, $4)',
            [ticker, 'AGGREGATED', totalMentions, totalEngagement]
        );

        // 4. Compute Metrics (Velocity & Acceleration)
        // Fetch last 3 buckets (15 mins) to compute acceleration
        const lastBuckets = await db.query(
            'SELECT mention_count, timestamp FROM mentions WHERE ticker = $1 ORDER BY timestamp DESC LIMIT 3',
            [ticker]
        );

        if (lastBuckets.rows.length < 2) return;

        const currentBucket = lastBuckets.rows[0];
        const prevBucket = lastBuckets.rows[1];

        // Velocity: mentions in current bucket (5 mins)
        const currentVelocity = currentBucket.mention_count;
        const prevVelocity = prevBucket.mention_count;

        // Acceleration: Change in velocity
        const acceleration = currentVelocity - prevVelocity;

        // 5. Aggregate Total Mentions (Historical)
        const totalHistoricalResult = await db.query(
            'SELECT SUM(mention_count) as total FROM mentions WHERE ticker = $1',
            [ticker]
        );
        const totalMentionsAllTime = parseInt(totalHistoricalResult.rows[0].total || 0);

        // 6. Trigger condition
        // if (mentionVelocity > VELOCITY_THRESHOLD) AND (totalMentions < EARLY_LIMIT)
        if (currentVelocity > velocity_threshold && totalMentionsAllTime < early_limit) {

            // --- Rug Filter Check ---
            console.log(`[SocialVelocityAgent] Trigger met for ${ticker}. Checking rug risk...`);

            // Assume Solana for now unless specified otherwise in config
            const isSolana = !contract_address.startsWith('0x');
            const rugReport = isSolana
                ? await this.solanaRugFilter.analyzeToken(contract_address, ticker)
                : await this.rugFilter.analyzeToken(contract_address, ticker);

            if (rugReport.blockAlert) {
                console.warn(`[SocialVelocityAgent] 🛑 Signal BLOCKED for ${ticker} due to rug risk:`, rugReport.reasons);
                return;
            }

            // Alpha Scoring
            const alphaResult = alphaEngine.computeAlphaScore({
                socialScore: 80, // High social velocity base score
                rugScore: rugReport.rugScore,
                engagement: totalEngagement > 1000 ? 50 : 20
            });

            const signalData = {
                ticker,
                totalMentions: totalMentionsAllTime,
                mentionVelocity: currentVelocity,
                mentionAcceleration: acceleration,
                engagementScore: totalEngagement,
                rugScore: rugReport.rugScore,
                alphaScore: alphaResult.totalScore,
                isAlpha: alphaResult.isAlpha,
                reasons: rugReport.reasons
            };

            await signalService.broadcastSignal(ticker, 'SOCIAL_ACCELERATION', signalData, webhook_url);
        }
    }
}

module.exports = SocialVelocityAgent;
