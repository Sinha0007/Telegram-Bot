const BaseAgent = require('./BaseAgent');

/**
 * AlphaScoringEngine
 * 
 * Aggregates scores from various agents to determine final "Alpha" quality.
 */
class AlphaScoringEngine extends BaseAgent {
    constructor() {
        super('AlphaScoringEngine');
    }

    /**
     * Compute a final alpha score based on social, volume, and rug metrics.
     * @param {object} params - { socialScore, volumeScore, rugScore, engagement }
     */
    computeAlphaScore(params) {
        const { socialScore = 0, volumeScore = 0, rugScore = 0, engagement = 0 } = params;

        // Rug risk reduces the alpha score
        // If rugScore is high (e.g. 50), we penalize heavily
        const rugPenalty = rugScore > 40 ? (rugScore - 40) * 2 : 0;

        // Base score aggregation
        let totalScore = (socialScore * 0.4) + (volumeScore * 0.4) + (engagement * 0.2);

        // Apply penalty
        totalScore = Math.max(0, totalScore - rugPenalty);

        return {
            totalScore: Math.round(totalScore),
            isAlpha: totalScore > 70, // Threshold for "High Quality" alpha
            breakdown: {
                socialScore,
                volumeScore,
                rugScore,
                rugPenalty
            }
        };
    }
}

module.exports = new AlphaScoringEngine();
