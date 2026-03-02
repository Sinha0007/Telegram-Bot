const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');

class HeliusService {
    constructor() {
        this.apiKey = config.HELIUS_API_KEY;
        this.rpcUrl = config.HELIUS_RPC_URL;
        this.baseUrl = config.HELIUS_BASE_URL;
    }

    /**
     * Get largest token holders
     * @param {string} mintAddress 
     */
    async getTokenHolders(mintAddress) {
        if (!this.apiKey || !mintAddress) return [];
        try {
            const response = await axios.post(this.rpcUrl, {
                jsonrpc: '2.0',
                id: 'helius-holders',
                method: 'getTokenLargestAccounts',
                params: [mintAddress]
            }, { timeout: 5000 });
            return response.data.result?.value || [];
        } catch (error) {
            logger.error(`[HeliusService] getTokenHolders failed for ${mintAddress}:`, error.message);
            return [];
        }
    }

    /**
     * Fetch parsed transaction history for a given address
     * @param {string} address 
     */
    async getTransactionHistory(address) {
        if (!this.apiKey || !address) return [];
        try {
            const url = `${this.baseUrl}/addresses/${address}/transactions/?api-key=${this.apiKey}`;
            const response = await axios.get(url, { timeout: 7000 });
            return response.data;
        } catch (error) {
            logger.error(`[HeliusService] getTransactionHistory failed for ${address}:`, error.message);
            return [];
        }
    }

    /**
     * Get Token Metadata/Mint Info (Helius DASH API or RPC)
     * @param {string} mintAddress 
     */
    async getTokenMetadata(mintAddress) {
        if (!this.apiKey || !mintAddress) return null;
        try {
            // Using DAS API (Digital Asset Standard)
            const response = await axios.post(this.rpcUrl, {
                jsonrpc: '2.0',
                id: 'helius-metadata',
                method: 'getAsset',
                params: { id: mintAddress }
            }, { timeout: 5000 });
            return response.data.result;
        } catch (error) {
            logger.error(`[HeliusService] getTokenMetadata failed for ${mintAddress}:`, error.message);
            return null;
        }
    }

    /**
     * Analyze deployer history to find previous tokens
     * @param {string} wallet 
     */
    async getDeployerHistory(wallet) {
        if (!wallet) return { count: 0, failedCount: 0 };
        try {
            const txs = await this.getTransactionHistory(wallet);
            // This is a simplified heuristic: looking for instructions that initialize new accounts or mints
            // In a production app, we'd more deeply parse for token program interactions.
            const mintTxs = txs.filter(tx =>
                JSON.stringify(tx).includes('InitializeMint') ||
                JSON.stringify(tx).includes('CreateAccount')
            );

            return {
                count: mintTxs.length,
                failedCount: 0 // Deep logic for "failed" would involve checking volume/liquidity of past mints
            };
        } catch (error) {
            logger.error(`[HeliusService] getDeployerHistory error for ${wallet}:`, error.message);
            return { count: 0, failedCount: 0 };
        }
    }

    /**
     * Get mint info using RPC account info
     * @param {string} mintAddress 
     */
    async getMintInfo(mintAddress) {
        if (!this.apiKey || !mintAddress) return null;
        try {
            const response = await axios.post(this.rpcUrl, {
                jsonrpc: '2.0',
                id: 'helius-mint-info',
                method: 'getAccountInfo',
                params: [mintAddress, { encoding: 'jsonParsed' }]
            }, { timeout: 5000 });
            return response.data.result?.value?.data?.parsed?.info;
        } catch (error) {
            logger.error(`[HeliusService] getMintInfo failed for ${mintAddress}:`, error.message);
            return null;
        }
    }
}

module.exports = new HeliusService();
