/**
 * Middleware to log all incoming messages
 */
const loggerMiddleware = async (ctx, next) => {
  const start = Date.now();
  
  // Log basic info about the incoming message
  const from = ctx.from ? `${ctx.from.first_name} (@${ctx.from.username || 'N/A'})` : 'Unknown';
  const text = ctx.message && ctx.message.text ? ctx.message.text : '[Non-text message]';
  
  console.log(`[${new Date().toISOString()}] Incoming message from ${from}: "${text}"`);

  await next(); // Proceed to next middleware/handler

  const ms = Date.now() - start;
  console.log(`Response time: ${ms}ms`);
};

module.exports = loggerMiddleware;
