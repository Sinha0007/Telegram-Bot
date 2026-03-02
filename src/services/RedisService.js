const Redis = require('ioredis');
const logger = require('../utils/logger');

class RedisService {
    constructor() {
        this.enabled = !!process.env.REDIS_URL;
        if (!this.enabled) {
            logger.warn('[RedisService] REDIS_URL is not defined in .env. Redis integration will be skipped.');
            return;
        }

        try {
            this.client = new Redis(process.env.REDIS_URL, {
                tls: process.env.REDIS_URL?.startsWith('rediss://') ? {} : undefined,
                retryStrategy: (times) => {
                    if (times > 3) {
                        logger.warn('[RedisService] Redis max retries hit — disabling Redis.');
                        this.enabled = false;
                        return null; // Stop retrying
                    }
                    return Math.min(times * 200, 2000);
                },
                maxRetriesPerRequest: 3,
                enableReadyCheck: false,
                lazyConnect: false,
            });

            this.client.on('connect', () => logger.success('[RedisService] Connected to Redis'));
            this.client.on('error', (err) => {
                logger.error('[RedisService] Connection error:', err.message);
                // Don't let Redis errors crash the bot
            });
        } catch (error) {
            logger.error('[RedisService] Initialization failed:', error.message);
            this.enabled = false;
        }
    }

    /**
     * Set a value with an expiration (TTL)
     * @param {string} key 
     * @param {string|object} value 
     * @param {number} ttlSeconds 
     */
    async set(key, value, ttlSeconds = null) {
        if (!this.enabled) return null;
        const val = typeof value === 'object' ? JSON.stringify(value) : value;
        if (ttlSeconds) {
            return await this.client.set(key, val, 'EX', ttlSeconds);
        }
        return await this.client.set(key, val);
    }

    /**
     * Get a value from Redis
     * @param {string} key 
     */
    async get(key) {
        if (!this.enabled) return null;
        const val = await this.client.get(key);
        try {
            return JSON.parse(val);
        } catch (e) {
            return val;
        }
    }

    /**
     * Delete a key from Redis
     * @param {string} key 
     */
    async del(key) {
        if (!this.enabled) return null;
        return await this.client.del(key);
    }

    /**
     * 1️⃣ Alert Cooldown Control
     * Key: sniffalpha:cooldown:{contract_address} (TTL: 1 hour default)
     */
    async isThrottled(contractAddress, ttl = 3600) {
        if (!this.enabled) return false;
        const key = `sniffalpha:cooldown:${contractAddress}`;
        const exists = await this.client.exists(key);

        if (exists) return true;

        // If not throttled, mark it now
        await this.set(key, '1', ttl);
        return false;
    }

    /**
     * 2️⃣ Real-Time Signal Cache
     * Key: sniffalpha:signals:{contract_address} (TTL: 15 mins)
     */
    async cacheSignals(contractAddress, signals) {
        const key = `sniffalpha:signals:${contractAddress}`;
        return await this.set(key, signals, 15 * 60);
    }

    async getCachedSignals(contractAddress) {
        const key = `sniffalpha:signals:${contractAddress}`;
        return await this.get(key);
    }

    /**
     * 3️⃣ Smart Wallet Cache
     * Key: sniffalpha:wallet:{wallet_address} (TTL: 30 mins)
     */
    async cacheWallet(walletAddress, data) {
        const key = `sniffalpha:wallet:${walletAddress}`;
        return await this.set(key, data, 30 * 60);
    }

    async getCachedWallet(walletAddress) {
        const key = `sniffalpha:wallet:${walletAddress}`;
        return await this.get(key);
    }

    /**
     * 4️⃣ Scoring Lock (Concurrency Control)
     * Key: sniffalpha:scoring_lock:{contract_address} (TTL: 30s)
     */
    async acquireLock(contractAddress, ttl = 30) {
        if (!this.enabled) return true;
        const key = `sniffalpha:scoring_lock:${contractAddress}`;

        // nx: only set if key does not exist
        const result = await this.client.set(key, 'LOCKED', 'EX', ttl, 'NX');
        return result === 'OK';
    }

    async releaseLock(contractAddress) {
        if (!this.enabled) return;
        const key = `sniffalpha:scoring_lock:${contractAddress}`;
        await this.del(key);
    }

    /**
     * 5️⃣ Pub/Sub Channel: sniffalpha:signals_channel
     */
    async publishSignal(signal) {
        if (!this.enabled) return;
        return await this.client.publish('sniffalpha:signals_channel', JSON.stringify(signal));
    }
}

module.exports = new RedisService();
