const BaseAgent = require('./BaseAgent');
const heliusService = require('../services/HeliusService');
const dexService = require('../services/DexScreenerService');
const db = require('../services/DatabaseService');

/**
 * SolanaRugFilterAgent
 *
 * Solana-native rug detection using:
 *   - Helius RPC   → mint authority, freeze authority, top holders
 *   - DexScreener  → LP address, liquidity USD, pair creation time
 *
 * No Birdeye key required.
 */
class SolanaRugFilterAgent extends BaseAgent {
    constructor() {
        super('SolanaRugFilterAgent');
        this.helius = heliusService;
    }

    // ─────────────────────────────────────────────
    // Public entry point
    // ─────────────────────────────────────────────
    async analyzeToken(address, ticker) {
        // 1. Cache check (30 min)
        const cached = await this._fetchFromCache(address);
        if (cached) {
            console.log(`[SolanaRugFilterAgent] Cache hit for ${ticker}`);
            return cached;
        }

        console.log(`[SolanaRugFilterAgent] 🔍 Deep scan: ${ticker} (${address})`);

        try {
            // 2. Parallel data fetch — Helius + DexScreener only
            const [mintInfo, holders, dexPairs] = await Promise.all([
                this._retryFetch(() => this.helius.getMintInfo(address)),
                this._retryFetch(() => this.helius.getTokenHolders(address)),
                this._retryFetch(() => dexService.getTokens(address))
            ]);

            // 3. Extract metrics
            const metrics = this._extractMetrics(mintInfo, holders, dexPairs);

            // 4. Compute individual risks
            const riskBreakdown = this._computeRisks(metrics);

            // 5. Weighted rug score
            // rugScore = (mintRisk×0.30) + (lpRisk×0.25) + (devRisk×0.20) + (holderRisk×0.15) + (freezeRisk×0.10)
            const rugScore =
                (riskBreakdown.mintRisk * 0.30) +
                (riskBreakdown.lpRisk * 0.25) +
                (riskBreakdown.devRisk * 0.20) +
                (riskBreakdown.holderRisk * 0.15) +
                (riskBreakdown.freezeRisk * 0.10);

            // 6. Block conditions
            const { blockAlert, reasons } = this._evaluateBlockConditions(riskBreakdown, rugScore, metrics);

            // 7. Build result
            const result = {
                agent: this.name,
                token_name: ticker,
                ticker,
                contract_address: address,
                rugScore: Math.round(rugScore),
                blockAlert,
                riskBreakdown,
                metrics: {
                    mintAuthority: metrics.mintAuthority,
                    freezeAuthority: metrics.freezeAuthority,
                    totalSupply: metrics.totalSupply,
                    decimals: metrics.decimals,
                    top5Percent: metrics.top5Percent?.toFixed(2),
                    top10Percent: metrics.top10Percent?.toFixed(2),
                    liquidityUSD: metrics.liquidityUSD,
                    pairCreatedAt: metrics.pairCreatedAt
                },
                reasons,
                timestamp: new Date().toISOString()
            };

            // 8. Structured log
            console.log(`[SolanaRugFilterAgent] ${ticker} → rugScore=${result.rugScore} blockAlert=${blockAlert}`);
            console.log(`[SolanaRugFilterAgent] Breakdown:`, riskBreakdown);
            if (reasons.length) console.warn(`[SolanaRugFilterAgent] Risk reasons:`, reasons);

            // 9. Persist to DB
            await this._saveToCache(result);

            return result;

        } catch (error) {
            console.error(`[SolanaRugFilterAgent] Scan failed for ${ticker}:`, error.message);
            return this._failSafe(address, ticker, error.message);
        }
    }

    // ─────────────────────────────────────────────
    // Metric Extraction
    // ─────────────────────────────────────────────
    _extractMetrics(mintInfo, holders, dexPairs) {
        // Mint account
        const mintAuthority = mintInfo?.mintAuthority || null;
        const freezeAuthority = mintInfo?.freezeAuthority || null;
        const decimals = mintInfo?.decimals ?? 9;
        const rawSupply = parseFloat(mintInfo?.supply || 0);
        const totalSupply = rawSupply / Math.pow(10, decimals);

        // Holder concentration
        let top5Percent = 0;
        let top10Percent = 0;
        if (holders.length > 0 && totalSupply > 0) {
            const top5 = holders.slice(0, 5).reduce((s, h) => s + parseFloat(h.uiAmount || 0), 0);
            const top10 = holders.slice(0, 10).reduce((s, h) => s + parseFloat(h.uiAmount || 0), 0);
            top5Percent = (top5 / totalSupply) * 100;
            top10Percent = (top10 / totalSupply) * 100;
        }

        // LP info from DexScreener
        const bestPair = dexPairs?.[0] || null;
        const liquidityUSD = bestPair?.liquidity?.usd || 0;
        const lpAddress = bestPair?.pairAddress || null;
        const pairCreatedAt = bestPair?.pairCreatedAt || null;

        return {
            mintAuthority,
            freezeAuthority,
            totalSupply,
            decimals,
            top5Percent,
            top10Percent,
            liquidityUSD,
            lpAddress,
            pairCreatedAt
        };
    }

    // ─────────────────────────────────────────────
    // Risk Computation
    // ─────────────────────────────────────────────
    _computeRisks(m) {
        // mintRisk: if mint authority exists, unlimited supply is possible → instant 100
        const mintRisk = m.mintAuthority ? 100 : 0;

        // freezeRisk: authority can freeze wallets → 60
        const freezeRisk = m.freezeAuthority ? 60 : 0;

        // lpRisk: based on liquidity depth and age
        let lpRisk = 0;
        if (m.liquidityUSD < 500) lpRisk = 100;              // Essentially no liquidity
        else if (m.liquidityUSD < 5_000) lpRisk = 70;        // Very thin
        else if (m.liquidityUSD < 25_000) lpRisk = 40;        // Low but tradeable
        else lpRisk = 10;         // Decent liquidity

        // New pair (< 1 day old) is extra risky
        if (m.pairCreatedAt) {
            const ageHours = (Date.now() - m.pairCreatedAt) / (1000 * 60 * 60);
            if (ageHours < 1) lpRisk = Math.min(100, lpRisk + 30);
            else if (ageHours < 24) lpRisk = Math.min(100, lpRisk + 15);
        }

        // devRisk: top-1 holder (often deployer) concentration
        let devRisk = 0;
        if (m.top5Percent > 70) devRisk = 100;
        else if (m.top5Percent > 50) devRisk = 75;
        else if (m.top5Percent > 30) devRisk = 50;
        else if (m.top5Percent > 15) devRisk = 25;
        else devRisk = 10;

        // holderRisk: top-10 concentration
        let holderRisk = 0;
        if (m.top10Percent > 80) holderRisk = 90;
        else if (m.top10Percent > 60) holderRisk = 60;
        else if (m.top10Percent > 40) holderRisk = 35;
        else holderRisk = 10;

        return { mintRisk, freezeRisk, lpRisk, devRisk, holderRisk };
    }

    // ─────────────────────────────────────────────
    // Block Conditions
    // ─────────────────────────────────────────────
    _evaluateBlockConditions(risks, rugScore, metrics) {
        const reasons = [];
        let blockAlert = false;

        if (risks.mintRisk === 100) {
            reasons.push('⚠️ Mint authority is active — unlimited supply risk');
            blockAlert = true;
        }
        if (risks.freezeRisk === 60) {
            reasons.push('🧊 Freeze authority exists — wallets can be frozen');
        }
        if (metrics.liquidityUSD < 500) {
            reasons.push(`💧 Liquidity critically low ($${metrics.liquidityUSD.toFixed(0)})`);
            blockAlert = true;
        }
        if (metrics.top5Percent > 50) {
            reasons.push(`🐳 Top 5 wallets hold ${metrics.top5Percent.toFixed(1)}% of supply`);
        }
        if (rugScore > 60 && !blockAlert) {
            reasons.push(`🚨 High rug score: ${Math.round(rugScore)}/100`);
            blockAlert = true;
        }

        return { blockAlert, reasons };
    }

    // ─────────────────────────────────────────────
    // Cache helpers
    // ─────────────────────────────────────────────
    async _fetchFromCache(address) {
        const result = await db.query(
            `SELECT full_report FROM rug_scans
             WHERE contract_address = $1
               AND timestamp > NOW() - INTERVAL '30 minutes'
             ORDER BY timestamp DESC LIMIT 1`,
            [address]
        );
        return result.rows.length > 0 ? result.rows[0].full_report : null;
    }

    async _saveToCache(result) {
        await db.query(`
            INSERT INTO rug_scans (ticker, contract_address, rug_score, block_alert, reasons, full_report)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (contract_address) DO UPDATE SET
                rug_score    = EXCLUDED.rug_score,
                block_alert  = EXCLUDED.block_alert,
                reasons      = EXCLUDED.reasons,
                full_report  = EXCLUDED.full_report,
                timestamp    = CURRENT_TIMESTAMP
        `, [
            result.ticker,
            result.contract_address,
            result.rugScore,
            result.blockAlert,
            JSON.stringify(result.reasons),
            JSON.stringify(result)
        ]);
    }

    // ─────────────────────────────────────────────
    // Retry wrapper (max 2 retries, 500ms delay)
    // ─────────────────────────────────────────────
    async _retryFetch(fn, retries = 2, delayMs = 500) {
        for (let i = 0; i <= retries; i++) {
            try {
                return await fn();
            } catch (err) {
                if (i < retries) {
                    console.warn(`[SolanaRugFilterAgent] Retry ${i + 1}/${retries}: ${err.message}`);
                    await new Promise(r => setTimeout(r, delayMs));
                } else {
                    throw err;
                }
            }
        }
    }

    // ─────────────────────────────────────────────
    // Fail-safe response (block on uncertainty)
    // ─────────────────────────────────────────────
    _failSafe(address, ticker, errorMsg) {
        return {
            agent: this.name,
            ticker,
            contract_address: address,
            rugScore: 100,
            blockAlert: true,
            riskBreakdown: {},
            reasons: [`Scan error — blocked for safety: ${errorMsg}`],
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = SolanaRugFilterAgent;
