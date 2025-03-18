const mongoose = require('mongoose');

/**
 * Schema for storing social media links for tokens
 * Collects complete social information (Twitter, Telegram, Website)
 */
const TokenSocialsSchema = new mongoose.Schema({
    currency: {
        type: String,
        required: true
    },
    issuer: {
        type: String,
        required: true
    },
    twitter: {
        type: String,
        required: true
    },
    telegram: {
        type: String,
        required: true
    },
    website: {
        type: String,
        required: true
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    },
    addedByUserId: {
        type: String
    }
});

// Create a compound index on currency and issuer for fast lookups
TokenSocialsSchema.index({ currency: 1, issuer: 1 }, { unique: true });

module.exports = mongoose.model('TokenSocials', TokenSocialsSchema); 