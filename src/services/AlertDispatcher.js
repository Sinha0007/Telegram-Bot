const axios = require('axios');
const db = require('./DatabaseService');
require('dotenv').config();

// ─────────────────────────────────────────────────────────────────
// Redis Cooldown Cache
// Falls back to a simple in-memory Map if REDIS_URL is not set.
// ─────────────────────────────────────────────────────────────────
let redis = null;
try {
    if (process.env.REDIS_URL) {
        const Redis = require('ioredis');
        redis = new Redis(process.env.REDIS_URL, {
            maxRetriesPerRequest: 2,
            enableReadyCheck: false,
            lazyConnect: true
        });
        redis.connect().catch(e => {
            console.warn('[AlertDispatcher] Redis connect failed — using in-memory fallback:', e.message);
            redis = null;
        });
    }
} catch (e) {
    console.warn('[AlertDispatcher] ioredis not available — using in-memory fallback');
    redis = null;
}

// In-memory fallback: Map<ticker, { cooldownUntil, lastAlphaScore }>
const memoryCache = new Map();

// ─────────────────────────────────────────────────────────────────
// AlertDispatcher
// ─────────────────────────────────────────────────────────────────
class AlertDispatcher {
    constructor() {
        this.botToken = process.env.BOT_TOKEN;
        this.channelId = process.env.ALERT_CHANNEL_ID;
        this.cooldownMs = parseInt(process.env.ALERT_COOLDOWN_MINUTES || '120') * 60 * 1000;
        this.scoreThreshold = parseInt(process.env.ALERT_SCORE_THRESHOLD || '10');
        this.telegramBase = `https://api.telegram.org/bot${this.botToken}`;
    }

    // ─────────────────────────────────────────────
    // Public entry point
    // ─────────────────────────────────────────────
    async dispatch(input) {
        const { token_name, ticker, contract_address, alphaScore, confidence, breakdown = {}, signalsUsed = [] } = input;
        const upperTicker = (ticker || 'UNKNOWN').toUpperCase();

        console.log(`[AlertDispatcher] 📨 Dispatch request for $${upperTicker} — alphaScore=${alphaScore}`);

        // 1. Cooldown check
        const cooldownResult = await this._checkCooldown(upperTicker, alphaScore);
        if (!cooldownResult.pass) {
            console.log(`[AlertDispatcher] ⏳ Skipped $${upperTicker}: ${cooldownResult.reason}`);
            return { sent: false, reason: cooldownResult.reason };
        }

        // 2. Enrich with market data
        const market = await this._enrichMarketData(contract_address, upperTicker);

        // 3. Format message
        const message = this._formatMessage({
            token_name, ticker: upperTicker, contract_address,
            alphaScore, confidence, breakdown, signalsUsed, market
        });

        // 4. Send to Telegram (with retry)
        const sent = await this._sendWithRetry(message);
        if (!sent) {
            return { sent: false, reason: 'telegram_error' };
        }

        // 5. Store alert in DB
        await this._storeAlert({
            ticker: upperTicker,
            token_name,
            contract_address,
            alpha_score: alphaScore,
            confidence,
            signals_used: signalsUsed,
            price_at_alert: market.price,
            mc_at_alert: market.marketCap,
            liquidity_at_alert: market.liquidityUSD
        });

        // 6. Update cooldown
        await this._setCooldown(upperTicker, alphaScore);

        console.log(`[AlertDispatcher] ✅ Alert sent for $${upperTicker}`);
        return { sent: true, reason: 'success' };
    }

    // ─────────────────────────────────────────────
    // Market Enrichment
    // Priority: DexScreener (free, no key needed)
    // Fallback chain: Birdeye (if key exists)
    // ─────────────────────────────────────────────
    async _enrichMarketData(address, ticker) {
        const market = {
            price: null,
            marketCap: null,
            liquidityUSD: null,
            pairAgeDays: null,
            dexUrl: null
        };

        if (!address || address === 'UNKNOWN') return market;

        // Try DexScreener first (no API key needed)
        try {
            const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${address}`, { timeout: 5000 });
            const pair = res.data?.pairs?.[0];
            if (pair) {
                market.price = pair.priceUsd ? `$${parseFloat(pair.priceUsd).toFixed(8)}` : null;
                market.marketCap = pair.fdv ? this._formatNumber(pair.fdv) : null;
                market.liquidityUSD = pair.liquidity?.usd ? this._formatNumber(pair.liquidity.usd) : null;
                market.dexUrl = pair.url || `https://dexscreener.com/solana/${address}`;
                if (pair.pairCreatedAt) {
                    const ageDays = (Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60 * 24);
                    market.pairAgeDays = ageDays < 1
                        ? `${Math.floor(ageDays * 24)}h`
                        : `${Math.floor(ageDays)}d`;
                }
            }
        } catch (e) {
            console.warn(`[AlertDispatcher] DexScreener enrichment failed for ${ticker}:`, e.message);
        }

        // Try Birdeye for market cap if DexScreener didn't have it and we have an API key
        if (!market.marketCap && process.env.BIRDEYE_API_KEY) {
            try {
                const res = await axios.get(
                    `https://public-api.birdeye.so/defi/token_overview?address=${address}`,
                    { headers: { 'X-API-KEY': process.env.BIRDEYE_API_KEY, 'x-chain': 'solana' }, timeout: 5000 }
                );
                const data = res.data?.data;
                if (data) {
                    market.marketCap = data.mc ? this._formatNumber(data.mc) : market.marketCap;
                    market.price = data.price ? `$${parseFloat(data.price).toFixed(8)}` : market.price;
                    market.liquidityUSD = data.liquidity ? this._formatNumber(data.liquidity) : market.liquidityUSD;
                }
            } catch (e) {
                console.warn(`[AlertDispatcher] Birdeye enrichment failed for ${ticker}:`, e.message);
            }
        }

        return market;
    }

    // ─────────────────────────────────────────────
    // Message Formatter
    // ─────────────────────────────────────────────
    _formatMessage({ token_name, ticker, contract_address, alphaScore, confidence, breakdown, signalsUsed, market }) {
        const scoreEmoji = alphaScore >= 80 ? '🔥' : alphaScore >= 60 ? '⚡' : '💡';
        const confBar = this._confidenceBar(confidence);

        let msg = `${scoreEmoji} *ALPHA SIGNAL — $${ticker}* ${scoreEmoji}\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

        msg += `🪙 *Token:* ${token_name || ticker}\n`;

        if (market.marketCap) msg += `📊 *Market Cap:* $${market.marketCap}\n`;
        if (market.liquidityUSD) msg += `💧 *Liquidity:* $${market.liquidityUSD}\n`;
        if (market.price) msg += `💲 *Price:* ${market.price}\n`;
        if (market.pairAgeDays) msg += `🕐 *Pair Age:* ${market.pairAgeDays}\n`;

        msg += `\n`;

        // Signals used
        if (signalsUsed.length > 0) {
            msg += `📡 *Signals Detected:*\n`;
            signalsUsed.forEach(s => { msg += `  • ${s}\n`; });
            msg += `\n`;
        }

        // Score breakdown
        if (Object.keys(breakdown).length > 0) {
            msg += `📈 *Score Breakdown:*\n`;
            for (const [key, val] of Object.entries(breakdown)) {
                msg += `  • ${key}: ${val}\n`;
            }
            msg += `\n`;
        }

        msg += `⭐ *Alpha Score: ${alphaScore}/100*\n`;
        msg += `🎯 *Confidence:* ${confBar} (${confidence}%)\n`;

        if (contract_address && contract_address !== 'UNKNOWN') {
            msg += `\n📋 *CA:* \`${contract_address}\`\n`;
        }

        if (market.dexUrl) {
            msg += `🔗 [View on DexScreener](${market.dexUrl})\n`;
        }

        msg += `\n_⚠️ Not financial advice. DYOR._`;
        return msg;
    }

    // ─────────────────────────────────────────────
    // Telegram sender with retry (3 attempts)
    // ─────────────────────────────────────────────
    async _sendWithRetry(message, retries = 3) {
        if (!this.botToken || !this.channelId) {
            console.warn('[AlertDispatcher] BOT_TOKEN or ALERT_CHANNEL_ID not set.');
            return false;
        }

        for (let i = 1; i <= retries; i++) {
            try {
                await axios.post(`${this.telegramBase}/sendMessage`, {
                    chat_id: this.channelId,
                    text: message,
                    parse_mode: 'Markdown',
                    disable_web_page_preview: false
                }, { timeout: 8000 });
                return true;
            } catch (e) {
                const status = e.response?.status;
                const errMsg = e.response?.data?.description || e.message;

                // 429 = rate limit — respect Retry-After header
                if (status === 429) {
                    const retryAfter = parseInt(e.response?.data?.parameters?.retry_after || 5);
                    console.warn(`[AlertDispatcher] Rate limited — waiting ${retryAfter}s`);
                    await this._sleep(retryAfter * 1000);
                } else {
                    console.error(`[AlertDispatcher] Send attempt ${i}/${retries} failed (${status}): ${errMsg}`);
                    if (i < retries) await this._sleep(1500 * i);
                }
            }
        }
        return false;
    }

    // ─────────────────────────────────────────────
    // Cooldown & Duplicate Logic
    // ─────────────────────────────────────────────
    async _checkCooldown(ticker, newAlphaScore) {
        const now = Date.now();

        if (redis) {
            const raw = await redis.get(`alert:${ticker}`);
            if (raw) {
                const { cooldownUntil, lastAlphaScore } = JSON.parse(raw);
                if (now < cooldownUntil) {
                    const remainMin = Math.ceil((cooldownUntil - now) / 60000);
                    return { pass: false, reason: `cooldown (${remainMin}m remaining)` };
                }
                if (Math.abs(newAlphaScore - lastAlphaScore) < this.scoreThreshold) {
                    return { pass: false, reason: `duplicate (score delta < ${this.scoreThreshold})` };
                }
            }
        } else {
            const cached = memoryCache.get(ticker);
            if (cached) {
                if (now < cached.cooldownUntil) {
                    const remainMin = Math.ceil((cached.cooldownUntil - now) / 60000);
                    return { pass: false, reason: `cooldown (${remainMin}m remaining)` };
                }
                if (Math.abs(newAlphaScore - cached.lastAlphaScore) < this.scoreThreshold) {
                    return { pass: false, reason: `duplicate (score delta < ${this.scoreThreshold})` };
                }
            }
        }

        return { pass: true };
    }

    async _setCooldown(ticker, alphaScore) {
        const payload = {
            cooldownUntil: Date.now() + this.cooldownMs,
            lastAlphaScore: alphaScore
        };
        const ttlSeconds = Math.ceil(this.cooldownMs / 1000);

        if (redis) {
            await redis.set(`alert:${ticker}`, JSON.stringify(payload), 'EX', ttlSeconds);
        } else {
            memoryCache.set(ticker, payload);
            // Auto-clean after TTL
            setTimeout(() => memoryCache.delete(ticker), this.cooldownMs);
        }
    }

    // ─────────────────────────────────────────────
    // DB Storage
    // ─────────────────────────────────────────────
    async _storeAlert(data) {
        try {
            await db.query(`
                INSERT INTO alerts
                    (ticker, token_name, contract_address, alpha_score, confidence,
                     signals_used, price_at_alert, mc_at_alert, liquidity_at_alert)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [
                data.ticker,
                data.token_name,
                data.contract_address,
                data.alpha_score,
                data.confidence,
                JSON.stringify(data.signals_used),
                data.price_at_alert,
                data.mc_at_alert,
                data.liquidity_at_alert
            ]);
        } catch (e) {
            console.error('[AlertDispatcher] DB store failed:', e.message);
        }
    }

    // ─────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────
    _formatNumber(n) {
        if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
        if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
        return n.toFixed(2);
    }

    _confidenceBar(pct) {
        const filled = Math.round((pct / 100) * 5);
        return '█'.repeat(filled) + '░'.repeat(5 - filled);
    }

    _sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
}

module.exports = new AlertDispatcher();
