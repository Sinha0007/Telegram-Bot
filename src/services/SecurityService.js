const axios = require('axios');

class SecurityService {
    constructor() {
        this.goPlusBase = 'https://api.gopluslabs.io/api/v1';
        this.honeypotBase = 'https://api.honeypot.is/v2';
    }

    /**
     * Get security info from GoPlus
     * @param {string} chainId - Chain ID (e.g. '1' for ETH, '56' for BSC, 'solana' for Solana)
     * @param {string} address - Token address
     */
    async getGoPlusSecurity(chainId, address) {
        try {
            // For Solana, the endpoint is different
            const endpoint = chainId === 'solana'
                ? `${this.goPlusBase}/solana/token_security?address=${address}`
                : `${this.goPlusBase}/token_security/${chainId}?contract_addresses=${address}`;

            const response = await axios.get(endpoint);

            if (chainId === 'solana') {
                return response.data.result;
            } else {
                return response.data.result[address.toLowerCase()];
            }
        } catch (error) {
            console.error(`[SecurityService] GoPlus Error:`, error.message);
            return null;
        }
    }

    /**
     * Check honeypot status
     * @param {string} address - Token address
     * @param {string} chainId - Chain ID (default 'eth')
     */
    async checkHoneypot(address, chainId = 'eth') {
        try {
            // Note: Honeypot.is v2 API
            const response = await axios.get(`${this.honeypotBase}/IsHoneypot`, {
                params: { address }
            });
            return response.data;
        } catch (error) {
            console.error(`[SecurityService] Honeypot.is Error:`, error.message);
            return null;
        }
    }
}

module.exports = new SecurityService();
