/**
 * BaseAgent.js
 * 
 * Abstract base class for all bot agents.
 * Provides a standard structure for asynchronous processing and signal generation.
 */
class BaseAgent {
    /**
     * @param {string} name - Unique name for the agent
     */
    constructor(name) {
        if (!name) {
            throw new Error('Agent name is required');
        }
        this.name = name;
    }

    /**
     * Main entry point for the agent's logic.
     * Should be overridden by subclasses.
     * 
     * @param {object} context - The Telegraf context (ctx) or custom data
     * @returns {Promise<any>}
     */
    async run(context) {
        throw new Error(`Method 'run()' must be implemented by subclass '${this.name}'`);
    }

    /**
     * Standardized signal output for inter-agent communication or scoring.
     * 
     * @param {string} token - The text token or trigger involved
     * @param {string} signalType - The category of the signal (e.g., 'command', 'keyword', 'sentiment')
     * @param {number} scoreContribution - How much this signal should weigh (0 to 1 range typically)
     * @param {object} metadata - Optional extra data
     * @returns {object}
     */
    emitSignal(token, signalType, scoreContribution = 0, metadata = {}) {
        return {
            agent: this.name,
            timestamp: new Date().toISOString(),
            token,
            signalType,
            scoreContribution,
            metadata
        };
    }
}

module.exports = BaseAgent;
