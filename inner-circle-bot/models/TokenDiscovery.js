const mongoose = require('mongoose');

/**
 * Schema for tracking token discovery information
 * Records who first found a token and relevant market metrics at discovery time
 */
const TokenDiscoverySchema = new mongoose.Schema({
    currency: {
        type: String,
        required: true
    },
    issuer: {
        type: String,
        required: true
    },
    name: {
        type: String
    },
    firstFinderUserId: {
        type: String
    },
    firstFinderUsername: {
        type: String
    },
    discoveryDate: {
        type: Date,
        default: Date.now
    },
    initialMarketCap: {
        type: Number
    },
    initialPrice: {
        type: Number
    },
    initialSupply: {
        type: Number
    },
    trustlineCount: {
        type: Number
    },
    finderWalletAddress: {
        type: String
    },
    socialWebsite: {
        type: String
    },
    socialTelegram: {
        type: String
    },
    socialTwitter: {
        type: String
    },
    socialDiscord: {
        type: String
    },
    hasCautionFlag: {
        type: Boolean,
        default: false
    },
    discoveryMethod: {
        type: String,
        enum: ['manual', 'trustline-monitor', 'api-monitor'],
        default: 'manual'
    }
});

// Create a compound index on currency and issuer for fast lookups
TokenDiscoverySchema.index({ currency: 1, issuer: 1 }, { unique: true });

module.exports = mongoose.model('TokenDiscovery', TokenDiscoverySchema); 