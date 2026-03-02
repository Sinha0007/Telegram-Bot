const axios = require('axios');
const logger = require('../utils/logger');

class DexScreenerService {
    constructor() {
        this.baseUrl = 'https://api.dexscreener.com/latest/dex';
    }

    /**
     * Search for pairs by ticker symbol
     * @param {string} symbol 
     */
    async searchTicker(symbol) {
        if (!symbol || typeof symbol !== 'string' || symbol.trim() === '') {
            return [];
        }

        try {
            const response = await axios.get(`${this.baseUrl}/search?q=${encodeURIComponent(symbol.trim())}`, {
                timeout: 5000
            });

            if (response.status !== 200) {
                logger.error(`[DexScreenerService] Search failed: ${response.status}`);
                return [];
            }

            return response.data.pairs || [];
        } catch (error) {
            logger.error('[DexScreenerService] Search error:', error.message);
            return [];
        }
    }

    /**
     * Get tokens by token address (can return multiple pairs)
     * @param {string} mint 
     */
    async getTokenPairs(mint) {
        if (!mint) return [];

        try {
            const response = await axios.get(`${this.baseUrl}/tokens/${mint}`, {
                timeout: 5000
            });

            if (response.status !== 200) {
                return [];
            }

            return response.data.pairs || [];
        } catch (error) {
            logger.error(`[DexScreenerService] getTokenPairs error for ${mint}:`, error.message);
            return [];
        }
    }
}

module.exports = new DexScreenerService();
