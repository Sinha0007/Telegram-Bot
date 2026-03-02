const BaseAgent = require('./BaseAgent');

/**
 * SmartWalletAgent.js
 * 
 * Tracks "Smart Wallets" for token purchase clusters.
 * If multiple wallets buy the same token within a 30-minute window, it emits a signal.
 */
class SmartWalletAgent extends BaseAgent {
    constructor(heliusService) {
        super('SmartWalletAgent');
        this.heliusService = heliusService;

        // In-memory map to store recent buys
        // Key: tokenAddress, Value: Array of { walletAddress, timestamp }
        this.recentBuys = new Map();

        // Config
        this.CLUSTER_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
        this.MIN_WALLETS_FOR_SIGNAL = 2;
    }

    /**
   * Main logic triggered by the WalletMonitorService.
   */
    async run() {
        // console.log(`[${this.name}] Scanning for smart wallet activity...`);

        try {
            const trackedWallets = await this._getTrackedWallets();
            const allNewBuys = [];

            // Check each wallet for new activity
            for (const wallet of trackedWallets) {
                const buys = await this._fetchHeliusActivity(wallet);
                if (buys && buys.length > 0) {
                    allNewBuys.push(...buys);
                }
            }

            const signals = [];

            for (const buy of allNewBuys) {
                this._recordBuy(buy.tokenAddress, buy.walletAddress);

                const cluster = this._getCluster(buy.tokenAddress);
                if (cluster.length >= this.MIN_WALLETS_FOR_SIGNAL) {
                    const signal = this.emitSignal(
                        buy.tokenAddress,
                        'SMART_WALLET_CLUSTER',
                        25,
                        {
                            wallets: cluster.map(b => b.walletAddress),
                            count: cluster.length,
                            timeframeMinutes: 30
                        }
                    );
                    signals.push(signal);
                }
            }

            return signals.length > 0 ? signals[0] : null;

        } catch (error) {
            console.error(`[${this.name}] Error:`, error.message);
            return null;
        }
    }

    /**
     * Placeholder for DB call to get tracked wallets
     */
    async _getTrackedWallets() {
        // Mocking wallets from "DB"
        return [
            '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1' // Known active wallet for testing
        ];
    }

    /**
     * Placeholder for real Helius API integration
     * @param {string} walletAddress 
     */
    async _fetchHeliusActivity(walletAddress) {
        if (!this.heliusService) {
            console.warn(`[${this.name}] No HeliusService provided. Skipping fetch.`);
            return [];
        }

        try {
            const transactions = await this.heliusService.getParsedTransactions(walletAddress);

            // Filter for SWAP transactions
            const recentSwaps = transactions.filter(tx =>
                tx.type === 'SWAP' &&
                tx.timestamp * 1000 > (Date.now() - this.CLUSTER_WINDOW_MS)
            );

            return recentSwaps.map(tx => {
                // simple heuristic to find the token bought: 
                // look at tokenTransfers, find the one where destination is the wallet
                const tokenTransfer = tx.tokenTransfers.find(t => t.toUserAccount === walletAddress);

                if (tokenTransfer) {
                    return {
                        walletAddress,
                        tokenAddress: tokenTransfer.mint,
                        signature: tx.signature,
                        timestamp: tx.timestamp * 1000 // Helius uses seconds
                    };
                }
                return null;
            }).filter(Boolean);

        } catch (error) {
            console.error(`[${this.name}] Failed to fetch activity for ${walletAddress}:`, error.message);
            return [];
        }
    }

    /**
     * Records a buy and cleans up expired entries
     */
    _recordBuy(tokenAddress, walletAddress) {
        const now = Date.now();
        if (!this.recentBuys.has(tokenAddress)) {
            this.recentBuys.set(tokenAddress, []);
        }

        const buys = this.recentBuys.get(tokenAddress);

        // Add new buy if not already tracked for this wallet in this window
        if (!buys.some(b => b.walletAddress === walletAddress)) {
            buys.push({ walletAddress, timestamp: now });
        }

        // Cleanup: Remove buys older than 30 minutes
        const validBuys = buys.filter(b => now - b.timestamp <= this.CLUSTER_WINDOW_MS);
        this.recentBuys.set(tokenAddress, validBuys);
    }

    /**
     * Returns valid buys for a token
     */
    _getCluster(tokenAddress) {
        return this.recentBuys.get(tokenAddress) || [];
    }
}

module.exports = SmartWalletAgent;
