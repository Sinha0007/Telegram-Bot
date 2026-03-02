/**
 * Handler for /status command
 */
const statusHandler = (ctx) => {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    return ctx.reply(`✅ Bot is online and running!\n\nUptime: ${hours}h ${minutes}m ${seconds}s`);
};

module.exports = statusHandler;
