const config = require('../config');
const TokenDiscovery = require('../models/TokenDiscovery');

/**
 * Add social media information for a token
 * @param {string} currency - Token currency code
 * @param {string} issuer - Token issuer address
 * @param {object} socials - Object containing social media links
 * @param {string} userId - Telegram user ID of the submitter
 * @returns {Promise<object>} - Result of the operation
 */
const addTokenSocials = async (currency, issuer, socials, userId) => {
    try {
        // Find existing token discovery entry
        let tokenDiscovery = await TokenDiscovery.findOne({ 
            currency, 
            issuer 
        });
        
        let isFirstFinder = false;
        
        if (!tokenDiscovery) {
            // This is the first finder
            isFirstFinder = true;
            
            // Create new token discovery entry
            tokenDiscovery = new TokenDiscovery({
                currency,
                issuer,
                firstFinderUserId: userId,
                discoveryDate: new Date(),
                socialWebsite: socials.website,
                socialTelegram: socials.telegram,
                socialTwitter: socials.twitter,
                socialDiscord: socials.discord
            });
            
            await tokenDiscovery.save();
        } else {
            // Update existing entry
            tokenDiscovery.socialWebsite = socials.website || tokenDiscovery.socialWebsite;
            tokenDiscovery.socialTelegram = socials.telegram || tokenDiscovery.socialTelegram;
            tokenDiscovery.socialTwitter = socials.twitter || tokenDiscovery.socialTwitter;
            tokenDiscovery.socialDiscord = socials.discord || tokenDiscovery.socialDiscord;
            
            await tokenDiscovery.save();
        }
        
        return {
            success: true,
            isFirstFinder
        };
    } catch (error) {
        console.error('Error adding token socials:', error);
        return {
            success: false,
            message: error.message || 'Failed to add social information'
        };
    }
};

/**
 * Get discovery information for a token
 * @param {string} currency - Token currency code
 * @param {string} issuer - Token issuer address
 * @returns {Promise<object>} - Result of the operation with discovery data
 */
const getTokenDiscovery = async (currency, issuer) => {
    try {
        // Find token discovery entry
        const discovery = await TokenDiscovery.findOne({
            currency,
            issuer
        });
        
        if (!discovery) {
            return {
                success: true,
                exists: false,
                discovery: null
            };
        }
        
        return {
            success: true,
            exists: true,
            discovery
        };
    } catch (error) {
        console.error('Error getting token discovery:', error);
        return {
            success: false,
            message: error.message || 'Failed to get discovery information'
        };
    }
};

/**
 * Add finder wallet for a token
 * @param {string} currency - Token currency code
 * @param {string} issuer - Token issuer address
 * @param {string} userId - Telegram user ID of the finder
 * @param {string} walletAddress - Wallet address to associate with the finder
 * @returns {Promise<object>} - Result of the operation
 */
const addFinderWallet = async (currency, issuer, userId, walletAddress) => {
    try {
        // Find token discovery entry
        const discovery = await TokenDiscovery.findOne({
            currency,
            issuer,
            firstFinderUserId: userId
        });
        
        if (!discovery) {
            return {
                success: false,
                message: 'You are not the first finder of this token'
            };
        }
        
        // Update the finder wallet address
        discovery.finderWalletAddress = walletAddress;
        await discovery.save();
        
        return {
            success: true
        };
    } catch (error) {
        console.error('Error adding finder wallet:', error);
        return {
            success: false,
            message: error.message || 'Failed to add wallet address'
        };
    }
};

module.exports = {
    addTokenSocials,
    getTokenDiscovery,
    addFinderWallet
}; 