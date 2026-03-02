const { ApifyClient } = require('apify-client');
const logger = require('../utils/logger');

class TwitterService {
    constructor() {
        this.enabled = !!process.env.APIFY_API_TOKEN;
        if (!this.enabled) {
            logger.warn('[TwitterService] APIFY_API_TOKEN is not defined in .env — social scoring disabled.');
            return;
        }
        this.client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
        // Best free Twitter scraper on Apify (no X API key needed)
        this.actorId = 'apidojo/tweet-scraper';
    }

    /**
     * Search for mentions of a token ticker on X/Twitter via Apify.
     * @param {string} query - e.g. "$WIF" or "WIF solana"
     * @returns {{ totalMentions: number, engagementScore: number }}
     */
    async fetchMentions(query) {
        if (!this.enabled || !query) return { totalMentions: 0, engagementScore: 0 };

        try {
            logger.info(`[TwitterService] Scraping mentions for: ${query}`);

            // Run the actor and wait for it to finish
            const run = await this.client.actor(this.actorId).call({
                searchTerms: [query],
                maxTweets: 20,
                since: this._hoursAgo(24), // Last 24 hours
                language: 'en',
            }, { waitSecs: 45 }); // Max wait: 45 seconds

            // Fetch results from the run's dataset
            const { items } = await this.client.dataset(run.defaultDatasetId).listItems({ limit: 20 });

            if (!items || items.length === 0) {
                return { totalMentions: 0, engagementScore: 0 };
            }

            let totalMentions = 0;
            let engagementScore = 0;

            for (const tweet of items) {
                totalMentions++;

                // Engagement formula: followers × 0.3 + retweets × 0.5 + likes × 0.2
                const followers = tweet.author?.followers || tweet.user?.followersCount || 0;
                const retweets = tweet.retweetCount || tweet.retweet_count || 0;
                const likes = tweet.likeCount || tweet.favorite_count || 0;

                engagementScore += (followers * 0.3) + (retweets * 0.5) + (likes * 0.2);
            }

            logger.info(`[TwitterService] Found ${totalMentions} mentions for ${query}, engagement: ${engagementScore.toFixed(0)}`);
            return { totalMentions, engagementScore };

        } catch (error) {
            logger.error(`[TwitterService] Apify scrape failed for "${query}":`, error.message);
            return { totalMentions: 0, engagementScore: 0 };
        }
    }

    /**
     * Returns an ISO date string N hours ago
     */
    _hoursAgo(hours) {
        return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString().split('T')[0]; // "YYYY-MM-DD"
    }
}

module.exports = new TwitterService();
