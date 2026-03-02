const { Telegraf } = require('telegraf');
const config = require('./config/config');
const logger = require('./utils/logger');
const alphaScoringService = require('./services/AlphaScoringService');
const telegramService = require('./services/TelegramService');
const dexService = require('./services/DexScreenerService');

class SniffAlphaBot {
    constructor() {
        if (!process.env.BOT_TOKEN) {
            throw new Error('BOT_TOKEN is missing in .env');
        }
        this.bot = new Telegraf(process.env.BOT_TOKEN);
        this.telegram = this.bot.telegram;
        this._setupCommands();
        this._setupHandlers();
    }

    _setupCommands() {
        this.bot.command('start', (ctx) => {
            ctx.reply('🚀 *Welcome to SniffAlpha Bot*\n\nReal-time Solana intelligence is active. I will alert you here on high-alpha mints.', { parse_mode: 'Markdown' });
        });

        this.bot.command('status', (ctx) => {
            ctx.reply('✅ SniffAlpha Engine is ONLINE and monitoring Helius Webhooks.');
        });

        // /intel $TICKER or /intel ADDR
        this.bot.command('intel', async (ctx) => {
            const args = ctx.message.text.split(' ');
            if (args.length < 2) {
                return ctx.reply('❌ Usage: `/intel $TICKER` or `/intel [MINT_ADDRESS]`', { parse_mode: 'Markdown' });
            }
            const query = args[1].replace('$', '');
            await this.handleTokenAnalysis(ctx, query, 'INTEL');
        });
    }

    _setupHandlers() {
        // $TICKER lookup handler
        this.bot.on('message', async (ctx, next) => {
            const text = ctx.message && ctx.message.text;
            if (!text || text.startsWith('/')) return next();

            const tickerMatch = text.match(/\$([A-Za-z0-9]{1,10})/);
            if (tickerMatch) {
                const ticker = tickerMatch[1].toUpperCase();
                await this.handleTokenAnalysis(ctx, ticker, 'MARKET');
            }
            return next();
        });
    }

    /**
     * Resolve ticker symbol → Solana mint address via DexScreener search.
     * Returns as-is if already a valid address (length > 30).
     */
    async resolveMint(query) {
        if (query.length > 30) return { mint: query, ticker: query, dexData: null };

        try {
            const pairs = await dexService.searchTicker(query);
            if (!pairs || pairs.length === 0) return { mint: null, ticker: query, dexData: null };

            const upperQuery = query.toUpperCase();

            // 1. Exact symbol match on Solana, sorted by liquidity
            const exactSolana = pairs
                .filter(p => p.chainId === 'solana' && p.baseToken?.symbol?.toUpperCase() === upperQuery)
                .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));

            if (exactSolana.length > 0) {
                const best = exactSolana[0];
                return { mint: best.baseToken.address, ticker: best.baseToken.symbol, dexData: best };
            }

            // 2. Exact symbol match on any chain
            const exactAny = pairs
                .filter(p => p.baseToken?.symbol?.toUpperCase() === upperQuery)
                .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));

            if (exactAny.length > 0) {
                const best = exactAny[0];
                return { mint: best.baseToken.address, ticker: best.baseToken.symbol, dexData: best };
            }

            // 3. Fallback: best Solana pair by liquidity (fuzzy match)
            const solanaPairs = pairs
                .filter(p => p.chainId === 'solana')
                .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));

            const best = solanaPairs[0] || pairs[0];
            if (!best) return { mint: null, ticker: query, dexData: null };

            return { mint: best.baseToken?.address, ticker: best.baseToken?.symbol || query, dexData: best };

        } catch (err) {
            logger.error('resolveMint error:', err.message);
            return { mint: null, ticker: query, dexData: null };
        }
    }

    /**
     * Central intelligence handler for both $TICKER and /intel
     */
    async handleTokenAnalysis(ctx, query, mode = 'MARKET') {
        const upperQuery = query.toUpperCase();
        const loadingMsg = mode === 'INTEL'
            ? `🔍 Analyzing *$${upperQuery}*...`
            : `🔍 Looking up *$${upperQuery}* on DexScreener...`;

        ctx.reply(loadingMsg, { parse_mode: 'Markdown' });

        try {
            // 1. Resolve ticker → mint address
            const { mint, ticker, dexData: resolvedDexData } = await this.resolveMint(query);

            if (!mint) {
                return ctx.reply(`❌ Could not find *$${upperQuery}* on DexScreener. Try using the contract address directly.`, { parse_mode: 'Markdown' });
            }

            // 2. Compute Score — no channel broadcast for manual lookups
            const result = await alphaScoringService.computeScore(mint, ticker, null, false);

            if (!result) {
                return ctx.reply(`❌ Analysis already in progress for $${ticker}. Try again shortly.`);
            }

            // 3. Inject pre-fetched dexData if scoring didn't populate it
            if (!result.dexData && resolvedDexData) {
                result.dexData = resolvedDexData;
            }

            // 4. Generate the appropriate report
            const report = mode === 'INTEL'
                ? alphaScoringService.getIntelligenceReport(result.ticker || ticker, result.mint || mint, result)
                : alphaScoringService.getMarketReport(result.ticker || ticker, result.mint || mint, result);

            await ctx.reply(report, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });

        } catch (err) {
            logger.error('Bot lookup error:', err.message);
            ctx.reply('⚠️ Error processing report. Please try again.');
        }
    }

    async launch() {
        await this.bot.launch();
        logger.success('SniffAlpha Telegram Bot launched.');

        // Initialize Telegram User API for social monitoring
        await telegramService.init();
    }

    stop() {
        this.bot.stop();
    }
}

module.exports = SniffAlphaBot;
