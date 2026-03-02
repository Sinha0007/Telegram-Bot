const { TwitterApi } = require('twitter-api-v2');
const config = require('../config/config');
const logger = require('../utils/logger');

class TwitterService {
    constructor() {
        if (!config.TWITTER_BEARER_TOKEN) {
            logger.warn('TWITTER_BEARER_TOKEN is not defined in .env');
            return;
        }
        this.client = new TwitterApi(config.TWITTER_BEARER_TOKEN);
        this.readOnlyClient = this.client.readOnly;
    }

    /**
     * Search for mentions of a token.
     * @param {string} query - Token name, $Ticker, or CA
     * @returns {Object} - totalMentions, engagementScore
     */
    async fetchMentions(query) {
        if (!query) return { totalMentions: 0, engagementScore: 0 };
        try {
            if (!this.readOnlyClient) return { totalMentions: 0, engagementScore: 0 };

            // Search for tweets in the last 24 hours for better sample size
            const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

            const search = await this.readOnlyClient.v2.search(query, {
                'start_time': startTime,
                'tweet.fields': 'public_metrics,author_id',
                'expansions': 'author_id',
                'user.fields': 'public_metrics',
                max_results: 10
            });

            let totalMentions = 0;
            let engagementScore = 0;

            for await (const tweet of search) {
                totalMentions++;
                const metrics = tweet.public_metrics;
                const author = search.includes.users.find(u => u.id === tweet.author_id);
                const followers = author ? author.public_metrics.followers_count : 0;

                // formula: engagement_score = followers * 0.3 + retweets * 0.5 + likes * 0.2
                const tweetEngagement = (followers * 0.3) +
                    (metrics.retweet_count * 0.5) +
                    (metrics.like_count * 0.2);

                engagementScore += tweetEngagement;
            }

            return { totalMentions, engagementScore };
        } catch (error) {
            logger.error(`Error fetching Twitter mentions for ${query}:`, error.message);
            return { totalMentions: 0, engagementScore: 0 };
        }
    }
}

module.exports = new TwitterService();
