const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    magenta: "\x1b[35m",
};

const logger = {
    info: (msg, data = '') => {
        console.log(`${colors.cyan}[INFO]${colors.reset} ${msg}`, data);
    },
    success: (msg, data = '') => {
        console.log(`${colors.green}[SUCCESS]${colors.reset} ${msg}`, data);
    },
    warn: (msg, data = '') => {
        console.warn(`${colors.yellow}[WARN]${colors.reset} ${msg}`, data);
    },
    error: (msg, data = '') => {
        console.error(`${colors.red}[ERROR]${colors.reset} ${msg}`, data);
    },
    token: (mint, data) => {
        console.log(`\n${colors.magenta}${colors.bright}--- [NEW TOKEN DETECTED] ---${colors.reset}`);
        console.log(`${colors.magenta}Mint:${colors.reset} ${mint}`);
        console.log(`${colors.magenta}Liquidity:${colors.reset} $${data.liquidity?.toLocaleString() || 'N/A'}`);
        console.log(`${colors.magenta}Alpha Score:${colors.reset} ${data.alphaScore}`);
        console.log(`${colors.magenta}Risk Score:${colors.reset} ${data.riskScore}`);
        console.log(`${colors.magenta}Recommendation:${colors.reset} ${colors.bright}${data.recommendation}${colors.reset}\n`);
    }
};

module.exports = logger;
