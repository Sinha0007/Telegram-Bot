-- SniffAlpha Core Database Schema (v1.0)
-- PostgreSQL Migration Script

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tokens Table (Persistent Asset Registry)
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

CREATE INDEX IF NOT EXISTS idx_tokens_contract_address ON tokens(contract_address);
CREATE INDEX IF NOT EXISTS idx_tokens_ticker ON tokens(ticker);

-- 2. Smart Wallets Table (Reputation & Tracking)
CREATE TABLE IF NOT EXISTS smart_wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_address VARCHAR(255) NOT NULL UNIQUE,
    label VARCHAR(255),
    reputation_score INTEGER DEFAULT 0,
    total_profit_usd FLOAT DEFAULT 0,
    win_rate FLOAT DEFAULT 0,
    tags JSONB DEFAULT '[]', -- insider, whale, smart_bot
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_smart_wallets_wallet_address ON smart_wallets(wallet_address);

-- 3. Agent Signals Table (Multi-Agent Findings)
CREATE TABLE IF NOT EXISTS agent_signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_id UUID REFERENCES tokens(id) ON DELETE CASCADE,
    agent_name VARCHAR(100) NOT NULL, -- VolumeVelocity, SocialMonitor, RugFilter
    signal_type VARCHAR(100) NOT NULL, -- VOLUME_SPIKE, SOCIAL_ACCEL, SMART_BUY
    score INTEGER DEFAULT 0,
    confidence FLOAT DEFAULT 0,
    findings JSONB DEFAULT '{}',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_signals_token_id ON agent_signals(token_id);
CREATE INDEX IF NOT EXISTS idx_agent_signals_type ON agent_signals(signal_type);

-- 4. Alpha Alerts Table (Dispatch History)
CREATE TABLE IF NOT EXISTS alpha_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_id UUID REFERENCES tokens(id) ON DELETE CASCADE,
    alpha_score INTEGER NOT NULL,
    risk_score INTEGER NOT NULL,
    recommendation VARCHAR(50), -- BUY, WATCH, AVOID
    market_data JSONB DEFAULT '{}', -- price, liq, fdv at time of alert
    signals_summary JSONB DEFAULT '[]',
    alert_status VARCHAR(50) DEFAULT 'SENT', -- SENT, SKIPPED, THROTTLED
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alpha_alerts_token_id ON alpha_alerts(token_id);
CREATE INDEX IF NOT EXISTS idx_alpha_alerts_timestamp ON alpha_alerts(timestamp DESC);

-- 5. Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_tokens_updated_at BEFORE UPDATE ON tokens FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_smart_wallets_updated_at BEFORE UPDATE ON smart_wallets FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
