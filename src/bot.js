const { Telegraf } = require('telegraf');
const config = require('./config/config');
const logger = require('./utils/logger');
const alphaScoringService = require('./services/AlphaScoringService');
const telegramService = require('./services/TelegramService');

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
     * Central intelligence handler for both $TICKER and /intel
     */
    async handleTokenAnalysis(ctx, query, mode = 'MARKET') {
        const loadingMsg = mode === 'INTEL'
            ? `🔍 Analyzing *$${query}*...`
            : `🔍 Looking up *$${query}* on DexScreener...`;

        ctx.reply(loadingMsg, { parse_mode: 'Markdown' });

        try {
            const isAddress = query.length > 30;
            const mint = isAddress ? query : query;

            // 1. Compute Score
            const result = await alphaScoringService.computeScore(mint, isAddress ? null : query);

            if (!result) {
                return ctx.reply(`❌ Analysis failed or already in progress for ${query}.`);
            }

            // 2. Generate the appropriate report
            const report = mode === 'INTEL'
                ? alphaScoringService.getIntelligenceReport(result.ticker || query, result.mint || mint, result)
                : alphaScoringService.getMarketReport(result.ticker || query, result.mint || mint, result);

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
