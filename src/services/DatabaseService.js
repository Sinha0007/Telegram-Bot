const { Pool } = require('pg');
require('dotenv').config();

class DatabaseService {
    constructor() {
        this.enabled = !!process.env.DATABASE_URL;
        if (!this.enabled) {
            console.warn('[DatabaseService] DATABASE_URL is not defined in .env. Database operations will be skipped.');
            return;
        }

        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
        });

        this.pool.on('error', (err) => {
            console.error('Unexpected error on idle client', err);
            // Don't exit if we want the rest of the bot to run
            // process.exit(-1);
        });
    }

    async query(text, params) {
        if (!this.enabled) {
            // console.warn('[DatabaseService] Query skipped (disabled)');
            return { rows: [] };
        }
        return this.pool.query(text, params);
    }

    async init() {
        try {
            // Existing tables
            await this.query(`
                CREATE TABLE IF NOT EXISTS token_configs (
                    id SERIAL PRIMARY KEY,
                    token_name VARCHAR(255) NOT NULL,
                    ticker VARCHAR(50) NOT NULL UNIQUE,
                    contract_address VARCHAR(255),
                    velocity_threshold FLOAT DEFAULT 0.5,
                    early_limit INTEGER DEFAULT 1000,
                    webhook_url TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS mentions (
                    id SERIAL PRIMARY KEY,
                    ticker VARCHAR(50) NOT NULL,
                    source VARCHAR(50) NOT NULL,
                    mention_count INTEGER NOT NULL,
                    engagement_score FLOAT DEFAULT 0,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS signals (
                    id SERIAL PRIMARY KEY,
                    ticker VARCHAR(50) NOT NULL,
                    signal_type VARCHAR(100) NOT NULL,
                    score INTEGER NOT NULL,
                    meta_data JSONB,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS rug_scans (
                    id SERIAL PRIMARY KEY,
                    ticker VARCHAR(50) NOT NULL,
                    contract_address VARCHAR(255) NOT NULL UNIQUE,
                    rug_score FLOAT NOT NULL,
                    block_alert BOOLEAN DEFAULT FALSE,
                    reasons JSONB,
                    full_report JSONB,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS alerts (
                    id SERIAL PRIMARY KEY,
                    ticker VARCHAR(50) NOT NULL,
                    token_name VARCHAR(255),
                    contract_address VARCHAR(255),
                    alpha_score INTEGER NOT NULL,
                    confidence FLOAT,
                    signals_used JSONB,
                    price_at_alert TEXT,
                    mc_at_alert TEXT,
                    liquidity_at_alert TEXT,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // New Core Tables (UUID based)
            await this.query(`
                CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

                CREATE TABLE IF NOT EXISTS tokens (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    contract_address VARCHAR(255) NOT NULL UNIQUE,
                    ticker VARCHAR(50) NOT NULL,
                    token_name VARCHAR(255),
                    decimals INTEGER DEFAULT 9,
                    deployer_address VARCHAR(255),
                    metadata JSONB DEFAULT '{}',
                    first_detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS smart_wallets (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    wallet_address VARCHAR(255) NOT NULL UNIQUE,
                    label VARCHAR(255),
                    reputation_score INTEGER DEFAULT 0,
                    total_profit_usd FLOAT DEFAULT 0,
                    win_rate FLOAT DEFAULT 0,
                    tags JSONB DEFAULT '[]',
                    metadata JSONB DEFAULT '{}',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS agent_signals (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    token_id UUID REFERENCES tokens(id) ON DELETE CASCADE,
                    agent_name VARCHAR(100) NOT NULL,
                    signal_type VARCHAR(100) NOT NULL,
                    score INTEGER DEFAULT 0,
                    confidence FLOAT DEFAULT 0,
                    findings JSONB DEFAULT '{}',
                    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS alpha_alerts (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    token_id UUID REFERENCES tokens(id) ON DELETE CASCADE,
                    alpha_score INTEGER NOT NULL,
                    risk_score INTEGER NOT NULL,
                    recommendation VARCHAR(50),
                    market_data JSONB DEFAULT '{}',
                    signals_summary JSONB DEFAULT '[]',
                    alert_status VARCHAR(50) DEFAULT 'SENT',
                    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            `);

            console.log('Database initialized successfully with Core Tables');
        } catch (error) {
            console.error('Error initializing database:', error);
            throw error;
        }
    }
}

module.exports = new DatabaseService();
