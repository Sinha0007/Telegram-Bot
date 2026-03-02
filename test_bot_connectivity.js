const https = require('https');

const bot_token = '8213787153:AAEqnuRLmgq0eyor8qHYvHDpwP9HO3GdGRE';
const channel_id = '-1003832748996';
const text = "🛠️ SniffAlpha System Verification Test: Successful.";

const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${bot_token}/sendMessage?chat_id=${channel_id}&text=${encodeURIComponent(text)}`,
    method: 'GET'
};

const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (d) => {
        data += d;
    });
    res.on('end', () => {
        console.log(data);
    });
});

req.on('error', (e) => {
    console.error(e);
});

req.end();
