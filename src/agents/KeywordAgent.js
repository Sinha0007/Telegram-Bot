const BaseAgent = require('./BaseAgent');

/**
 * KeywordAgent.js
 * 
 * A simple example agent that detects specific keywords.
 */
class KeywordAgent extends BaseAgent {
    constructor() {
        super('KeywordAgent');
        this.keywords = ['alert', 'help', 'emergency', 'urgent'];
    }

    async run(ctx) {
        if (!ctx.message || !ctx.message.text) return null;

        const text = ctx.message.text.toLowerCase();
        const found = this.keywords.find(k => text.includes(k));

        if (found) {
            return this.emitSignal(
                found,
                'priority_detection',
                0.9,
                { originalText: ctx.message.text }
            );
        }

        return null;
    }
}

module.exports = KeywordAgent;
