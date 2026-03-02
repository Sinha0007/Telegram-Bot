const dexService = require('./DexScreenerService');
const birdeyeService = require('./BirdeyeService');
const heliusService = require('./HeliusService');
const twitterService = require('./TwitterService');
const telegramService = require('./TelegramService');
const rugCheckService = require('./RugCheckService');
const redisService = require('./RedisService');
const db = require('./DatabaseService');
const logger = require('../utils/logger');

class AlphaScoringService {
    /**
     * Compute Alpha score by aggregating all metrics
     * @param {string} mint 
     * @param {string} ticker 
     * @param {string} deployer 
     */
    async computeScore(mint, ticker = null, deployer = null) {
        // 1. Concurrency Control (Redis Lock)
        const locked = await redisService.acquireLock(mint);
        if (!locked) {
            logger.warn(`[AlphaScoringService] Skipping ${mint} - Analysis already in progress.`);
            return null;
        }

        try {
            logger.info(`[AlphaScoringService] Scoring ${ticker || mint} (${mint})...`);

            // 2. Persist/Fetch Token from DB
            const tokenResult = await db.query(`
                INSERT INTO tokens (contract_address, ticker, deployer_address)
                VALUES ($1, $2, $3)
                ON CONFLICT (contract_address) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
                RETURNING id
            `, [mint, ticker || 'UNKNOWN', deployer]);

            const tokenId = tokenResult.rows[0]?.id; // Fixed: using optional chaining to prevent crash when DB is disabled
            // 0. Fetch Metadata if ticker is missing
            let name = ticker;
            let metadata = null;
            if (!ticker || ticker === mint.substring(0, 4)) {
                metadata = await heliusService.getTokenMetadata(mint);
                ticker = metadata?.content?.metadata?.symbol || ticker || 'UNKNOWN';
                name = metadata?.content?.metadata?.name || ticker;
            }

            // 1. Initial Rug Check (Blocking)
            const rugReport = await rugCheckService.analyzeToken(mint, ticker, deployer);
            if (rugReport.blockAlert) {
                return {
                    alphaScore: 0,
                    riskScore: rugReport.rugScore,
                    recommendation: 'AVOID',
                    reasons: rugReport.reasons,
                    liquidity: rugReport.metrics?.liquidityUSD || 0,
                    smartMoneyWallets: 0,
                    ticker: ticker || mint,
                    name: name || ticker || 'Unknown',
                    mint,
                    dexData: null
                };
            }

            // 2. Parallel Data Fetch for non-blocking analysis
            const [
                dexPairs,
                birdeyeOverview,
                topTraders,
                holders,
                socialTwitter,
                socialTelegram
            ] = await Promise.all([
                dexService.getTokenPairs(mint),
                birdeyeService.getTokenOverview(mint),
                birdeyeService.getTopTraders(mint),
                heliusService.getTokenHolders(mint),
                twitterService.fetchMentions(`$${ticker}`),
                telegramService.fetchMentions(`$${ticker}`)
            ]);

            // 3. Score Components (0-100 each)
            const liquidity = dexPairs[0]?.liquidity?.usd || 0;
            const volume24h = dexPairs[0]?.volume?.h24 || 0;

            // a) Market Score (Volume + Liquidity depth)
            const marketScore = Math.min(100, (liquidity / 10000) * 30 + (volume24h / 50000) * 70);

            // b) Smart Money Score (Profitability of top traders)
            const smartMoneyCount = topTraders.filter(t => t.profit && t.profit > 1000).length;
            const smartMoneyScore = Math.min(100, (smartMoneyCount / 5) * 100);

            // c) Holder Distribution Score (Lower = centralized, Higher = distributed)
            const holderScore = Math.max(0, 100 - (rugReport.metrics?.top10Percent || 100));

            // d) Social Sentiment Score
            const totalMentions = (socialTwitter?.totalMentions || 0) + (socialTelegram?.totalMentions || 0);
            const engagementScore = socialTwitter?.engagementScore || 0;
            const socialScore = Math.min(100, (totalMentions / 10) * 50 + (engagementScore / 1000) * 50);

            // 4. Final Weighted Alpha Score
            // Weightings: Market (30%), Smart Money (30%), Holders (20%), Social (20%)
            const alphaScore = Math.round(
                (marketScore * 0.3) +
                (smartMoneyScore * 0.3) +
                (holderScore * 0.2) +
                (socialScore * 0.2)
            );

            // 5. Generate Recommendation
            let recommendation = 'WATCH';
            if (alphaScore > 75) recommendation = 'BUY';
            else if (alphaScore < 40) recommendation = 'AVOID';

            const finalResult = {
                alphaScore,
                riskScore: rugReport.rugScore,
                recommendation,
                reasons: rugReport.reasons,
                topHolders: holders.length,
                rugReport,
                ticker,
                name: name || ticker,
                mint,
                liquidity,
                smartMoneyWallets: smartMoneyCount,
                dexData: dexPairs[0] || null // Send full DexScreener data for the report
            };

            // 5. Persist Alert to DB
            if (tokenId) {
                await db.query(`
                    INSERT INTO alpha_alerts (token_id, alpha_score, risk_score, recommendation, market_data, signals_summary)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [
                    tokenId,
                    alphaScore,
                    rugReport.rugScore,
                    recommendation,
                    JSON.stringify({ priceUsd: dexPairs[0]?.priceUsd, liquidity, volume24h }),
                    JSON.stringify([
                        { type: 'MARKET', score: marketScore },
                        { type: 'SMART_MONEY', score: smartMoneyScore },
                        { type: 'SOCIAL', score: socialScore }
                    ])
                ]);
            }

            // 6. Automated Telegram Alert
            await this.sendAutomatedAlert(mint, ticker, alphaScore, rugReport, liquidity, recommendation);

            return finalResult;

        } catch (error) {
            logger.error(`[AlphaScoringService] Score computation failed for ${mint}:`, error.message);
            return {
                alphaScore: 0,
                riskScore: 100,
                recommendation: 'AVOID',
                reasons: [`Error: ${error.message}`],
                liquidity: 0,
                smartMoneyWallets: 0,
                ticker: ticker || mint,
                mint
            };
        } finally {
            // Always release the lock
            await redisService.releaseLock(mint);
        }
    }

    /**
     * getMarketReport - Returns the market-focused dashboard ($ticker command)
     */
    getMarketReport(ticker, mint, result) {
        const { alphaScore, recommendation, liquidity, dexData, name } = result;
        const price = dexData?.priceUsd ? `$${parseFloat(dexData.priceUsd).toFixed(8)}` : '$0.000000';
        const changes = dexData?.priceChange || { m5: 0, h1: 0, h24: 0 };
        const volume = dexData?.volume?.h24 || 0;
        const fdv = dexData?.fdv || 0;
        const dex = dexData?.dexId ? dexData.dexId.charAt(0).toUpperCase() + dexData.dexId.slice(1) : 'Unknown';

        return [
            `📈 *$${ticker}* — ${name || 'N/A'}`,
            `🔗 Chain: Solana | DEX: ${dex}`,
            ``,
            `💵 Price:      ${price}`,
            `📈 5m/1h/24h:  +${changes.m5}% / +${changes.h1}% / +${changes.h24}%`,
            `💧 Liquidity:  $${liquidity?.toLocaleString() || 'N/A'}`,
            `📦 Volume 24h: $${volume > 1000 ? (volume / 1000).toFixed(1) + 'K' : volume}`,
            `🏦 FDV:        $${fdv > 1000000 ? (fdv / 1000000).toFixed(2) + 'M' : (fdv / 1000).toFixed(1) + 'K'}`,
            `Prediction:    ${alphaScore}% (${alphaScore > 75 ? 'HIGH' : alphaScore > 40 ? 'MODERATE' : 'LOW'})`,
            ``,
            `� [View on DexScreener](https://dexscreener.com/solana/${mint})`
        ].join('\n');
    }

    /**
     * getIntelligenceReport - Returns the intelligence-focused scoring report (/intel command)
     */
    getIntelligenceReport(ticker, mint, result) {
        const { alphaScore, riskScore, recommendation, reasons, liquidity, smartMoneyWallets } = result;
        return [
            `📊 *SniffAlpha Intelligence Report: $${ticker}*`,
            `──────────────────`,
            `🔥 *Alpha Score:* ${alphaScore}/100`,
            `�🛡️ *Risk Score:* ${riskScore}/100`,
            `💧 *Liquidity:* $${liquidity?.toLocaleString() || '0'}`,
            `🐋 *Smart Wallets:* ${smartMoneyWallets || 0}`,
            `💡 *Recommendation:* *${recommendation}*`,
            `──────────────────`,
            `⚠️ *Risk Analysis:*`,
            reasons && reasons.length > 0 ? reasons.map(r => `• ${r}`).join('\n') : '• No critical risks detected.',
            `──────────────────`,
            `🔗 [DexScreener](https://dexscreener.com/solana/${mint}) | [Helius RPC](https://explorer.solana.com/address/${mint})`
        ].join('\n');
    }

    /**
     * Broadcast the "signal" alert to the main channel
     */
    async sendAutomatedAlert(mint, ticker, alphaScore, rugReport, liquidity, recommendation) {
        const alertChannelId = process.env.ALERT_CHANNEL_ID;
        if (!alertChannelId) return;

        // Skip if throttled (prevents spam)
        if (await redisService.isThrottled(mint)) return;

        try {
            const { activeBot } = require('../index');
            if (activeBot) {
                const alertMsg = [
                    `🚀 *SniffAlpha Highly Potent Signal*`,
                    `──────────────────`,
                    `🪙 *Token:* ${ticker} (${mint.substring(0, 6)}...)`,
                    `🔥 *Alpha Score:* ${alphaScore}/100`,
                    `🛡️ *Risk Score:* ${rugReport.rugScore}/100`,
                    `💧 *Liquidity:* $${liquidity?.toLocaleString()}`,
                    `🐋 *Top 10 Holders:* ${rugReport.metrics?.top10Percent?.toFixed(1)}%`,
                    `💡 *Recommendation:* *${recommendation}*`,
                    `──────────────────`,
                    `[🔎 View on DexScreener](https://dexscreener.com/solana/${mint})`
                ].join('\n');

                await activeBot.telegram.sendMessage(alertChannelId, alertMsg, {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true
                });
                logger.success(`[AlphaScoringService] Automated alert broadcast for ${ticker}`);
            }
        } catch (alertErr) {
            logger.error(`[AlphaScoringService] Automated alert failed:`, alertErr.message);
        }
    }

    /**
     * Future placeholder for trade execution
     * @param {string} mint 
     */
    async executeTrade(mint) {
        // Future Jupiter swap integration hook
        return null;
    }
}

module.exports = new AlphaScoringService();
