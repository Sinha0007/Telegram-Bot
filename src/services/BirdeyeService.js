const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');

class BirdeyeService {
    constructor() {
        this.apiKey = config.BIRDEYE_API_KEY;
        this.baseURL = config.BIRDEYE_BASE_URL;
    }

    async getTokenOverview(address) {
        if (!this.apiKey || !address) return null;
        try {
            const response = await axios.get(`${this.baseURL}/defi/token_overview?address=${address}`, {
                headers: {
                    'X-API-KEY': this.apiKey,
                    'x-chain': 'solana'
                },
                timeout: 5000
            });
            return response.data.data;
        } catch (error) {
            logger.error(`[BirdeyeService] getTokenOverview failed for ${address}:`, error.message);
            return null;
        }
    }

    async getTopTraders(address) {
        if (!this.apiKey || !address) return [];
        try {
            // Birdeye Public API for top traders
            const response = await axios.get(`${this.baseURL}/defi/v3/token/market-data/top-traders?address=${address}`, {
                headers: {
                    'X-API-KEY': this.apiKey,
                    'x-chain': 'solana'
                },
                timeout: 5000
            });
            return response.data.data.items || [];
        } catch (error) {
            logger.error(`[BirdeyeService] getTopTraders failed for ${address}:`, error.message);
            return [];
        }
    }

    async getTokenSecurity(address) {
        if (!this.apiKey || !address) return null;
        try {
            const response = await axios.get(`${this.baseURL}/defi/token_security?address=${address}`, {
                headers: {
                    'X-API-KEY': this.apiKey,
                    'x-chain': 'solana'
                },
                timeout: 5000
            });
            return response.data.data;
        } catch (error) {
            logger.error(`[BirdeyeService] getTokenSecurity failed for ${address}:`, error.message);
            return null;
        }
    }
}

module.exports = new BirdeyeService();
