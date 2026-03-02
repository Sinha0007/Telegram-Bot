require('dotenv').config();

module.exports = {
    HELIUS_API_KEY: process.env.HELIUS_API_KEY || '',
    BIRDEYE_API_KEY: process.env.BIRDEYE_API_KEY || '',
    TWITTER_BEARER_TOKEN: process.env.TWITTER_BEARER_TOKEN || '',
    TELEGRAM_API_ID: process.env.TELEGRAM_API_ID || '',
    TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH || '',
    PORT: process.env.PORT || 3000,
    HELIUS_RPC_URL: `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
    HELIUS_BASE_URL: 'https://api-mainnet.helius-rpc.com/v0',
    BIRDEYE_BASE_URL: 'https://public-api.birdeye.so',
};
