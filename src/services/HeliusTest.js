const fs = require('fs');
console.log('STARTING SCRIPT');
try {
    const HeliusService = require('./HeliusService');
    console.log('Loaded HeliusService');
} catch (e) {
    console.error('FAILED TO LOAD HeliusService: ' + e.message);
}
