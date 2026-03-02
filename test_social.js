const SocialVelocityAgent = require('./src/agents/SocialVelocityAgent');

async function testSocial() {
    console.log('--- Testing SocialVelocityAgent ---');
    const agent = new SocialVelocityAgent();
    const token = 'NEW_GEM';

    console.log(`1. Initial mentions: 100 T=0s`);
    await agent.trackForToken(token, 100);

    // Simulate 10 seconds passing, 50 new mentions (Velocity = 5/s) -> Should Trigger
    // Threshold is 0.5/s
    console.log(`2. Update mentions: 150 T=10s (Vel=5.0/s)`);
    // Mock time delay by manipulating internal state for test or just wait?
    // Let's just mock the internal 'now' if we could, but here we can just sleep or rely on system clock.
    // Since we need to sleep 1 sec to get readable velocity, let's use a helper that updates state directly or sleep.

    // We will just sleep for 1.1 seconds and add 80 mentions (high velocity)
    await new Promise(r => setTimeout(r, 1100));

    const signal = await agent.trackForToken(token, 180);

    if (signal) {
        console.log('✅ Signal Detected:', signal);
    } else {
        console.log('❌ No Signal (Unexpected if velocity high)');
    }

    // Test Early Stage Limit
    console.log('3. Test Limit: Update mentions to 5000 (Limit is 1000)');
    await new Promise(r => setTimeout(r, 1100));
    const signal2 = await agent.trackForToken(token, 5000);

    if (signal2) {
        console.log('❌ Signal Detected (Unexpected, should be ignored due to limit)');
    } else {
        console.log('✅ No Signal (Correct, early stage limit exceeeded)');
    }
}

testSocial();
