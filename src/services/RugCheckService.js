const heliusService = require('./HeliusService');
const dexService = require('./DexScreenerService');
const logger = require('../utils/logger');

class RugCheckService {
    /**
     * Analyze token for rug risks
     * @param {string} mint 
     * @param {string} ticker 
     * @param {string} deployer 
     */
    async analyzeToken(mint, ticker, deployer = null) {
        logger.info(`[RugCheckService] Analyzing ${ticker} (${mint})...`);

        try {
            const [mintInfo, holders, dexPairs, deployerHistory] = await Promise.all([
                heliusService.getMintInfo(mint),
                heliusService.getTokenHolders(mint),
                dexService.getTokenPairs(mint),
                deployer ? heliusService.getDeployerHistory(deployer) : Promise.resolve({ count: 0, failedCount: 0 })
            ]);

            const metrics = this._extractMetrics(mintInfo, holders, dexPairs);
            const riskBreakdown = this._computeRisks(metrics, deployerHistory);

            // Weighted rug score
            const rugScore = Math.round(
                (riskBreakdown.mintRisk * 0.30) +
                (riskBreakdown.lpRisk * 0.25) +
                (riskBreakdown.devRisk * 0.20) +
                (riskBreakdown.holderRisk * 0.15) +
                (riskBreakdown.freezeRisk * 0.10)
            );

            const { blockAlert, reasons } = this._evaluateBlockConditions(riskBreakdown, rugScore, metrics);

            return {
                rugScore,
                blockAlert,
                reasons,
                metrics,
                riskBreakdown
            };
        } catch (error) {
            logger.error(`[RugCheckService] Analysis failed for ${mint}:`, error.message);
            return {
                rugScore: 100,
                blockAlert: true,
                reasons: ['Analysis failed - blocked for safety'],
                metrics: {},
                riskBreakdown: {}
            };
        }
    }

    _extractMetrics(mintInfo, holders, dexPairs) {
        const decimals = mintInfo?.decimals ?? 9;
        const rawSupply = parseFloat(mintInfo?.supply || 0);
        const totalSupply = rawSupply / Math.pow(10, decimals);

        let top5Percent = 0;
        let top10Percent = 0;
        if (holders.length > 0 && totalSupply > 0) {
            const top5 = holders.slice(0, 5).reduce((s, h) => s + parseFloat(h.uiAmount || 0), 0);
            const top10 = holders.slice(0, 10).reduce((s, h) => s + parseFloat(h.uiAmount || 0), 0);
            top5Percent = (top5 / totalSupply) * 100;
            top10Percent = (top10 / totalSupply) * 100;
        }

        const bestPair = dexPairs?.[0] || null;

        return {
            mintAuthority: mintInfo?.mintAuthority || null,
            freezeAuthority: mintInfo?.freezeAuthority || null,
            totalSupply,
            top5Percent,
            top10Percent,
            liquidityUSD: bestPair?.liquidity?.usd || 0,
            isLiquidityLocked: false // Default to false, would need deeper LP burn check
        };
    }

    _computeRisks(m, devHistory) {
        const mintRisk = m.mintAuthority ? 100 : 0;
        const freezeRisk = m.freezeAuthority ? 60 : 0;

        let lpRisk = 0;
        if (m.liquidityUSD < 1000) lpRisk = 100;
        else if (m.liquidityUSD < 10000) lpRisk = 50;

        let devRisk = 0;
        if (devHistory.failedCount > 0) devRisk = 100;
        else if (devHistory.count > 5) devRisk = 30; // Serial deployer

        let holderRisk = 0;
        if (m.top10Percent > 70) holderRisk = 100;
        else if (m.top10Percent > 40) holderRisk = 50;

        return { mintRisk, freezeRisk, lpRisk, devRisk, holderRisk };
    }

    _evaluateBlockConditions(risks, rugScore, metrics) {
        const reasons = [];
        let blockAlert = false;

        if (risks.mintRisk === 100) {
            reasons.push('Mint authority active');
            blockAlert = true;
        }
        if (risks.freezeRisk === 60) {
            reasons.push('Freeze authority active');
        }
        if (metrics.liquidityUSD < 500) {
            reasons.push('Insufficient liquidity');
            blockAlert = true;
        }
        if (rugScore > 75) {
            reasons.push('High overall risk score');
            blockAlert = true;
        }

        return { blockAlert, reasons };
    }
}

module.exports = new RugCheckService();
