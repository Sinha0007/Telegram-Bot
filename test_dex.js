const DexScreenerService = require('./src/services/DexScreenerService');

async function test() {
    console.log('Testing DexScreenerService...');
    const service = new DexScreenerService();
    // Test Bonk
    const tokens = await service.getTokens('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');
    console.log(`Found ${tokens.length} pairs for Bonk.`);
    if (tokens.length > 0) {
        console.log('Sample pair:', tokens[0].baseToken.symbol, '/', tokens[0].quoteToken.symbol);
        console.log('Volume 24h:', tokens[0].volume.h24);
    }
}

test();
