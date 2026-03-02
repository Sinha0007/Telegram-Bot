/**
 * AgentManager.js
 * 
 * Orchestrates multiple agents by registering them and executing them
 * sequentially or in parallel on incoming messages.
 */
class AgentManager {
    constructor() {
        this.agents = [];
    }

    /**
     * Register a new agent to the manager
     * @param {BaseAgent} agent 
     */
    registerAgent(agent) {
        this.agents.push(agent);
        console.log(`[AgentManager] registered: ${agent.name}`);
    }

    /**
     * Run all registered agents against the provided context.
     * 
     * @param {object} context - Usually the Telegraf ctx
     * @returns {Promise<Array>} - Combined array of all signals emitted by agents
     */
    async process(context) {
        const allSignals = [];

        // Run all agents in parallel
        const tasks = this.agents.map(async (agent) => {
            try {
                const signal = await agent.run(context);
                if (signal) {
                    allSignals.push(signal);
                }
            } catch (err) {
                console.error(`[AgentManager] Error in agent "${agent.name}":`, err.message);
            }
        });

        await Promise.all(tasks);
        return allSignals;
    }
}

module.exports = AgentManager;
