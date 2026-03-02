const express = require('express');
const bodyParser = require('body-parser');
const db = require('./services/DatabaseService');
const RugFilterAgent = require('./agents/RugFilterAgent');
const SolanaRugFilterAgent = require('./agents/SolanaRugFilterAgent');
const alertDispatcher = require('./services/AlertDispatcher');

const app = express();
app.use(bodyParser.json());

// Routes
const heliusWebhook = require('./webhook/heliusWebhook');
app.use('/webhook', heliusWebhook);

const rugAgent = new RugFilterAgent();
const solanaRugAgent = new SolanaRugFilterAgent();

// ═══════════════════════════════════════════════════════
// RUG SCAN ENDPOINTS
// ═══════════════════════════════════════════════════════

/**
 * GET /rug/:address?ticker=XYZ&chain=solana
 * Run a rug scan (auto-routes Solana vs EVM)
 */
app.get('/rug/:address', async (req, res) => {
    const { address } = req.params;
    const { ticker, chain } = req.query;
    const targetChain = (chain || 'solana').toLowerCase();

    try {
        const result = targetChain === 'solana'
            ? await solanaRugAgent.analyzeToken(address, ticker || 'UNKNOWN')
            : await rugAgent.analyzeToken(address, ticker || 'UNKNOWN', targetChain);
        res.json(result);
    } catch (error) {
        console.error('[API] Rug scan error:', error.message);
        res.status(500).json({ error: 'Failed to perform rug scan' });
    }
});

/**
 * GET /rug/:address/history
 * All historical rug scans for a contract
 */
app.get('/rug/:address/history', async (req, res) => {
    const { address } = req.params;
    try {
        const result = await db.query(
            'SELECT * FROM rug_scans WHERE contract_address = $1 ORDER BY timestamp DESC',
            [address]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('[API] Rug history error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ═══════════════════════════════════════════════════════
// ALERT DISPATCHER ENDPOINTS
// ═══════════════════════════════════════════════════════

/**
 * POST /dispatch
 * Receive an approved alpha signal and send a Telegram alert.
 *
 * Body: { token_name, ticker, contract_address, alphaScore, confidence, breakdown, signalsUsed }
 */
app.post('/dispatch', async (req, res) => {
    const { token_name, ticker, contract_address, alphaScore, confidence = 50, breakdown = {}, signalsUsed = [] } = req.body;

    if (!ticker || alphaScore === undefined) {
        return res.status(400).json({ error: '`ticker` and `alphaScore` are required' });
    }

    try {
        const outcome = await alertDispatcher.dispatch({
            token_name,
            ticker,
            contract_address,
            alphaScore: parseInt(alphaScore),
            confidence: parseFloat(confidence),
            breakdown,
            signalsUsed
        });
        const status = outcome.sent ? 200 : 202; // 202 = accepted but not sent (duplicate/cooldown)
        res.status(status).json(outcome);
    } catch (error) {
        console.error('[API] Dispatch error:', error.message);
        res.status(500).json({ error: 'Alert dispatch failed', detail: error.message });
    }
});

/**
 * GET /alerts/:token
 * Most recent alert for a ticker
 */
app.get('/alerts/:token', async (req, res) => {
    const { token } = req.params;
    try {
        const result = await db.query(
            'SELECT * FROM alerts WHERE ticker = $1 ORDER BY timestamp DESC LIMIT 1',
            [token.toUpperCase()]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: `No alerts found for ${token.toUpperCase()}` });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('[API] Alerts fetch error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /alerts/history
 * Paginated alert history (most recent first)
 */
app.get('/alerts/history', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '50'), 200);
    const offset = parseInt(req.query.offset || '0');

    try {
        const result = await db.query(
            'SELECT * FROM alerts ORDER BY timestamp DESC LIMIT $1 OFFSET $2',
            [limit, offset]
        );
        res.json({ total: result.rows.length, limit, offset, rows: result.rows });
    } catch (error) {
        console.error('[API] Alert history error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ═══════════════════════════════════════════════════════
// SIGNAL ENDPOINTS
// ═══════════════════════════════════════════════════════

/**
 * GET /signals/:token
 * Latest signal for a ticker
 */
app.get('/signals/:token', async (req, res) => {
    const { token } = req.params;
    try {
        const result = await db.query(
            'SELECT * FROM signals WHERE ticker = $1 ORDER BY timestamp DESC LIMIT 1',
            [token.toUpperCase()]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No signals found for this token' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('[API] Signals fetch error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ═══════════════════════════════════════════════════════
// CONFIG ENDPOINTS
// ═══════════════════════════════════════════════════════

/**
 * POST /config/token
 * Add or update a token monitoring configuration
 */
app.post('/config/token', async (req, res) => {
    const { token_name, ticker, contract_address, velocity_threshold, early_limit, webhook_url } = req.body;

    if (!token_name || !ticker) {
        return res.status(400).json({ error: 'token_name and ticker are required' });
    }

    try {
        await db.query(`
            INSERT INTO token_configs (token_name, ticker, contract_address, velocity_threshold, early_limit, webhook_url)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (ticker) DO UPDATE SET
                token_name         = EXCLUDED.token_name,
                contract_address   = EXCLUDED.contract_address,
                velocity_threshold = EXCLUDED.velocity_threshold,
                early_limit        = EXCLUDED.early_limit,
                webhook_url        = EXCLUDED.webhook_url
        `, [token_name, ticker.toUpperCase(), contract_address, velocity_threshold, early_limit, webhook_url]);

        res.json({ message: 'Token configuration saved' });
    } catch (error) {
        console.error('[API] Config save error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ═══════════════════════════════════════════════════════
// SERVER
// ═══════════════════════════════════════════════════════

const PORT = parseInt(process.env.PORT || '3000');

function startAPI(port = PORT) {
    const server = app.listen(port, () => {
        console.log(`[API] SniffAlpha server running on port ${port}`);
        console.log(`[API] Endpoints: POST /dispatch | GET /alerts/:token | GET /alerts/history`);
        // Update so other parts of the app know the actual port
        process.env.PORT = port;
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.warn(`[API] Port ${port} in use, trying ${port + 1}...`);
            server.close();
            startAPI(port + 1);
        } else {
            throw err;
        }
    });

    return server;
}

module.exports = { startAPI };
