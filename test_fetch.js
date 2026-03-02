try {
    const fetch = require('node-fetch');
    console.log('node-fetch loaded successfully');
} catch (e) {
    console.log('Error loading node-fetch:', e.message);
}
