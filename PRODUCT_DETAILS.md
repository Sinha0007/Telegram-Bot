# 🚀 SniffAlpha — Product Documentation

## 1. Project Overview
**SniffAlpha** is a real-time Solana token intelligence and alpha detection system. It is designed to find "Alpha" (profitable opportunities) by detecting new token mints the second they happen and running a comprehensive intelligence pipeline to evaluate their potential and security.

---

## 2. Core Architecture
The project follows a **Modular Service-Oriented Architecture** ensuring high scalability and non-blocking asynchronous processing.

### **Directory Structure**
```text
src/
├── index.js                # Master Entry Point (Express + Telegram Bot)
├── bot.js                  # SniffAlpha Telegram Interface (Lookup & Alerts)
├── api.js                   # Express API Layer & Webhook Router
├── webhook/
│   └── heliusWebhook.js     # Helius POST receiver (The "Trigger")
├── services/
│   ├── AlphaScoringService.js # Master Intelligence Engine
│   ├── RugCheckService.js    # Security & Forensic Risk Analysis
│   ├── HeliusService.js      # On-chain Data & Metadata (DAS/RPC)
│   ├── BirdeyeService.js     # Market Data & Smart Money Analysis
│   ├── DexScreenerService.js  # Liquidity & Volume Verification
│   ├── TwitterService.js     # Social Sentiment (X/Twitter V2)
│   └── TelegramService.js    # Social Sentiment (Global TG Search)
├── utils/
│   └── logger.js            # Structured, Production-Grade Logging
└── config/
    └── config.js            # Environment & Global Constants
```

---

## 3. Implemented Features

### **⚡ Feature 1: Real-Time Webhook Detection**
*   **Source**: Helius Enhanced Webhooks.
*   **Events**: `TOKEN_MINT`, `INITIALIZE_MINT`.
*   **Latency**: Instant (sub-1 second detection).
*   **Action**: Automatically extracts Mint Address and Fee Payer (Deployer) to trigger the analysis pipeline.

### **⚡ Feature 2: Rug Detection Engine**
*   **Mint Authority Check**: Blocks tokens with active minting (unlimited supply risk).
*   **Freeze Authority Check**: Flags tokens that can freeze user wallets.
*   **Holder Concentration**: Analyzes the Top 10 holders relative to total supply.
*   **Liquidity Verification**: Minimum liquidity thresholding to filter out "dust" tokens.

### **⚡ Feature 3: Smart Money Analysis**
*   **Integration**: Birdeye Top Traders API.
*   **Logic**: Detects the presence of "Smart Money" wallets in the early buyer list.
*   **Scoring**: Heavily increases the Alpha Score if high-profit wallets are detected buying early.

### **⚡ Feature 4: Alpha Scoring Engine**
Calculates a weighted score (0-100) based on:
1.  **Market Score (30%)**: Liquidity depth and 24h volume.
2.  **Smart Money Score (30%)**: Number of profitable wallets involved.
3.  **Holder Score (20%)**: Supply distribution (lower concentration is better).
4.  **Social Score (20%)**: Twitter/Telegram mention frequency and engagement.

### **⚡ Feature 5: Telegram Bot Interface**
*   **Live Monitoring**: Sends real-time dashboards for detected mints.
*   **Manual Lookup**: Send `$TICKER` (e.g., `$SOL`) to trigger a manual intelligence report for any token.
*   **Status Check**: `/status` command to verify engine health.

---

## 4. Integrated External APIs
| Provider | Utilized Features |
| :--- | :--- |
| **Helius** | Enhanced Webhooks, DAS Metadata, Account Info, Token Holders. |
| **Birdeye** | Token Overview, Top Traders, Security Forensics. |
| **DexScreener** | Pair Search, Liquidity USD, 24h Volume, FDV. |
| **Twitter (X)** | V2 Search for $Ticker mentions and engagement metrics. |
| **Telegram API** | User API for monitoring mentions in global message history. |

---

## 5. Security & Fail-safes
*   **Input Guarding**: Prevents 400 errors from empty API queries.
*   **Async/Await Pipeline**: Non-blocking execution allows handling 100+ events per minute.
*   **Retry Logic**: Built-in 2-retry mechanism for Helius and DexScreener calls.
*   **Fail-Safe Blocking**: Automatically flags "AVOID" on any token that fails the data-fetch phase.

---

## 6. Future Roadmap
*   **Jupiter Integration**: Automated one-click buying for tokens above 85+ Alpha Score.
*   **Database Persistence**: Storing historical Alpha performance to "self-correct" scoring weights.
*   **Cluster Analysis**: Deep Helius parsing to detect "Team Wallets" (insider groups).

---
**Last Updated**: 2026-03-01
**Status**: Beta (Production-Ready Backbone)
