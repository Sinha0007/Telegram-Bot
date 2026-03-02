/**
 * Handler for /start command
 */
const startHandler = (ctx) => {
    const userName = ctx.from.first_name || 'there';
    return ctx.reply(`Welcome, ${userName}! 👋\n\nI am your Telegram Bot built with Telegraf.\nUse /status to check if I'm running.`);
};

module.exports = startHandler;
