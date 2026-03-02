const BaseAgent = require('./BaseAgent');
const securityService = require('../services/SecurityService');
const dexService = require('../services/DexScreenerService');
const db = require('../services/DatabaseService');

/**
 * RugFilterAgent
 * 
 * Evaluates rug risk of a token using multiple metrics:
 * - Dev wallet percentage
 * - LP Lock duration
 * - Mint function status
 * - Ownership status
 * - Top holder distribution
 * - Honeypot status
 */
class RugFilterAgent extends BaseAgent {
    constructor() {
        super('RugFilterAgent');
        this.cacheDuration = 30 * 60 * 1000; // 30 minutes
    }

    async run(context) {
        // This agent is typically called by other agents or API
        return null;
    }

    /**
     * Analyze a token for rug risks
     * @param {string} address - Contract address
     * @param {string} ticker - Token ticker (for display)
     * @param {string} chain - 'solana', 'eth', 'bsc' etc.
     */
    async analyzeToken(address, ticker, chain = 'solana') {
        try {
            // 1. Check Cache (Database)
            const cachedResult = await this._fetchFromCache(address);
            if (cachedResult) {
                console.log(`[RugFilterAgent] Returning cached result for ${ticker}`);
                return cachedResult;
            }

            console.log(`[RugFilterAgent] Analyzing ${ticker} (${address})...`);

            // 2. Fetch Data from APIs
            const [securityData, dexData, honeypotData] = await Promise.all([
                securityService.getGoPlusSecurity(chain, address),
                dexService.getTokens(address),
                chain !== 'solana' ? securityService.checkHoneypot(address) : null // Honeypot.is is mostly EVM
            ]);

            if (!securityData) {
                throw new Error('Failed to fetch security data from GoPlus');
            }

            // 3. Extract Metrics
            const metrics = this._extractMetrics(chain, securityData, dexData, honeypotData);

            // 4. Calculate Risks
            const risks = this._calculateRisks(metrics);

            // 5. Final Score Calculation
            // rugScore = (devRisk * 0.3) + (lpRisk * 0.25) + (mintRisk * 0.2) + (ownerRisk * 0.15) + (holderRisk * 0.1)
            const rugScore = (risks.devRisk * 0.3) +
                (risks.lpRisk * 0.25) +
                (risks.mintRisk * 0.2) +
                (risks.ownerRisk * 0.15) +
                (risks.holderRisk * 0.1);

            // 6. Block Conditions
            const result = this._evaluateBlockConditions(metrics, risks, rugScore, ticker, address);

            // 7. Store in DB
            await this._saveToCache(result);

            return result;
        } catch (error) {
            console.error(`[RugFilterAgent] Analysis failed for ${ticker}:`, error.message);
            return {
                agent: this.name,
                ticker,
                contract_address: address,
                error: error.message,
                blockAlert: true, // Default to block on error for safety
                reasons: ['Analysis failed']
            };
        }
    }

    _extractMetrics(chain, security, dex, honeypot) {
        const pair = dex && dex.length > 0 ? dex[0] : null;

        let metrics = {
            devWalletPercent: 0,
            lpLockDays: 0,
            mintEnabled: false,
            ownershipRenounced: true,
            top5Percent: 0,
            top10Percent: 0,
            honeypotDetected: false,
            liquidityUsd: pair ? pair.liquidity?.usd || 0 : 0,
            lpOwner: 'unknown',
            token_name: security.token_name || security.name || 'Unknown'
        };

        if (chain === 'solana') {
            metrics.devWalletPercent = parseFloat(security.creator_percent || 0);
            metrics.mintEnabled = security.mintable === '1' || security.mint_address !== '';
            metrics.ownershipRenounced = security.is_renounced === '1';

            // Holder distribution for Solana (GoPlus provides top_10_holders)
            if (security.top_10_holders) {
                const holders = security.top_10_holders;
                metrics.top5Percent = holders.slice(0, 5).reduce((acc, h) => acc + parseFloat(h.percent * 100), 0);
                metrics.top10Percent = holders.reduce((acc, h) => acc + parseFloat(h.percent * 100), 0);
            }
        } else {
            // EVM metrics from GoPlus
            metrics.devWalletPercent = parseFloat(security.creator_percent || 0);
            metrics.mintEnabled = security.is_mintable === '1';
            metrics.ownershipRenounced = security.owner_address === '0x0000000000000000000000000000000000000000' || security.can_take_back_ownership !== '1';

            if (security.holders) {
                // ... calculate from security.holders
                metrics.top5Percent = security.holders.slice(0, 5).reduce((acc, h) => acc + parseFloat(h.percent * 100), 0);
                metrics.top10Percent = security.holders.slice(0, 10).reduce((acc, h) => acc + parseFloat(h.percent * 100), 0);
            }

            if (honeypot && honeypot.honeypotResult) {
                metrics.honeypotDetected = honeypot.honeypotResult.isHoneypot;
            }
        }

        return metrics;
    }

    _calculateRisks(metrics) {
        let risks = {
            devRisk: 20,
            lpRisk: 10,
            mintRisk: 0,
            ownerRisk: 0,
            holderRisk: 10
        };

        // Dev Wallet Risk
        if (metrics.devWalletPercent > 30) risks.devRisk = 100;
        else if (metrics.devWalletPercent >= 15) risks.devRisk = 60;
        else risks.devRisk = 20;

        // LP Lock Risk (Simplified as GoPlus/DexScreener info varies)
        // This is a placeholder as real LP lock check requires specialized APIs or parsing
        if (metrics.liquidityUsd < 1000) risks.lpRisk = 100;
        else risks.lpRisk = 10; // Defaulting to 10 if liquidity exists, needs real lock check

        // Mint Risk
        risks.mintRisk = metrics.mintEnabled ? 100 : 0;

        // Owner Risk
        risks.ownerRisk = metrics.ownershipRenounced ? 0 : 60;

        // Holder Risk
        if (metrics.top5Percent > 50) risks.holderRisk = 80;
        else if (metrics.top10Percent > 70) risks.holderRisk = 60;
        else risks.holderRisk = 10;

        return risks;
    }

    _evaluateBlockConditions(metrics, risks, rugScore, ticker, address) {
        const reasons = [];
        let blockAlert = false;

        if (metrics.honeypotDetected) {
            reasons.push('Honeypot detected');
            blockAlert = true;
        }

        if (metrics.mintEnabled && !metrics.ownershipRenounced) {
            reasons.push('Mint enabled and ownership NOT renounced');
            blockAlert = true;
        }

        // if rugScore > 60
        if (rugScore > 60) {
            reasons.push(`High Rug Score: ${rugScore.toFixed(0)}`);
            blockAlert = true;
        }

        return {
            agent: this.name,
            token_name: metrics.token_name,
            ticker,
            contract_address: address,
            devWalletPercent: metrics.devWalletPercent,
            lpLockDays: metrics.lpLockDays,
            mintEnabled: metrics.mintEnabled,
            ownershipRenounced: metrics.ownershipRenounced,
            top5Percent: metrics.top5Percent,
            rugScore: Math.round(rugScore),
            blockAlert,
            reasons,
            full_report: { metrics, risks }
        };
    }

    async _fetchFromCache(address) {
        const result = await db.query(
            'SELECT * FROM rug_scans WHERE contract_address = $1 AND timestamp > NOW() - INTERVAL \'30 minutes\'',
            [address]
        );
        if (result.rows.length > 0) {
            const row = result.rows[0];
            return {
                ...row.full_report, // We spread the stored full report
                ticker: row.ticker,
                contract_address: row.contract_address,
                rugScore: row.rug_score,
                blockAlert: row.block_alert,
                reasons: row.reasons
            };
        }
        return null;
    }

    async _saveToCache(result) {
        try {
            await db.query(`
                INSERT INTO rug_scans (ticker, contract_address, rug_score, block_alert, reasons, full_report)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (contract_address) DO UPDATE SET
                    rug_score = EXCLUDED.rug_score,
                    block_alert = EXCLUDED.block_alert,
                    reasons = EXCLUDED.reasons,
                    full_report = EXCLUDED.full_report,
                    timestamp = CURRENT_TIMESTAMP
            `, [
                result.ticker,
                result.contract_address,
                result.rugScore,
                result.blockAlert,
                JSON.stringify(result.reasons),
                JSON.stringify(result)
            ]);
        } catch (error) {
            console.error('[RugFilterAgent] Failed to save cache:', error.message);
        }
    }
}

module.exports = RugFilterAgent;
