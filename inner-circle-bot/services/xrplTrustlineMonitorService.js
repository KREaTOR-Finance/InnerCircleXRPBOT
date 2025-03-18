const config = require('../config');
const xrplService = require('./xrplService');
const tokenInfoService = require('./tokenInfoService');
const tokenService = require('./tokenService');
const masterChannelService = require('./masterChannelService');
const axios = require('axios');

// Store recent trustlines to avoid duplicate processing
let recentTrustlines = [];
let isMonitoring = false;

/**
 * XRPL Trustline Monitor Service
 * Monitors the XRPL for new trustlines and token issuances
 */

/**
 * Start the trustline monitoring process
 * @param {object} bot - Telegram bot instance
 * @returns {Promise<boolean>} - Success status
 */
const startMonitoring = async (bot) => {
    if (isMonitoring) {
        return false;
    }
    
    isMonitoring = true;
    
    // Start the monitoring loop
    monitorTrustlines(bot);
    
    return true;
};

/**
 * Stop the trustline monitoring process
 * @returns {boolean} - Success status
 */
const stopMonitoring = () => {
    if (!isMonitoring) {
        return false;
    }
    
    isMonitoring = false;
    return true;
};

/**
 * Monitor XRPL for new trustlines
 * @param {object} bot - Telegram bot instance
 * @returns {Promise<void>}
 */
const monitorTrustlines = async (bot) => {
    while (isMonitoring) {
        try {
            // Connect to XRPL
            const api = await xrplService.getXrplApi();
            
            // Subscribe to transaction stream
            await api.request({
                command: 'subscribe',
                streams: ['transactions']
            });
            
            // Process transactions
            api.connection.on('transaction', (tx) => {
                if (tx.transaction.TransactionType === 'TrustSet') {
                    processTrustline(bot, tx);
                }
            });
            
            // Also periodically check for new tokens via XRPLMeta API
            setInterval(() => {
                checkXRPLMetaForNewTokens(bot);
            }, 15 * 60 * 1000); // Every 15 minutes
            
            // Log successful monitoring start
            console.log('✅ Trustline monitoring started successfully');
            
            // Keep the monitoring loop running
            await new Promise(resolve => setTimeout(resolve, 1000 * 60 * 60)); // Check every hour
        } catch (error) {
            console.error('❌ Error in trustline monitoring:', error);
            
            // Wait before reconnecting
            await new Promise(resolve => setTimeout(resolve, 30000));
        }
    }
};

/**
 * Process a trustline transaction
 * @param {object} bot - Telegram bot instance
 * @param {object} tx - Transaction data
 * @returns {Promise<void>}
 */
const processTrustline = async (bot, tx) => {
    try {
        // Extract trustline details
        const trustline = extractTrustlineDetails(tx);
        
        if (!trustline) {
            return;
        }
        
        // Check if we've already processed this trustline
        const trustlineKey = `${trustline.currency}.${trustline.issuer}.${trustline.account}`;
        if (recentTrustlines.includes(trustlineKey)) {
            return;
        }
        
        // Add to recent trustlines
        recentTrustlines.push(trustlineKey);
        
        // Keep recentTrustlines list manageable
        if (recentTrustlines.length > 1000) {
            recentTrustlines = recentTrustlines.slice(-500);
        }
        
        // Check if this is a new token
        const isNewToken = await checkIfNewToken(trustline.currency, trustline.issuer);
        
        if (isNewToken) {
            await processNewToken(bot, trustline);
        }
    } catch (error) {
        console.error('Error processing trustline:', error);
    }
};

/**
 * Extract trustline details from transaction
 * @param {object} tx - Transaction data
 * @returns {object|null} - Trustline details or null if invalid
 */
const extractTrustlineDetails = (tx) => {
    try {
        const transaction = tx.transaction;
        
        if (!transaction.LimitAmount) {
            return null;
        }
        
        return {
            account: transaction.Account,
            issuer: transaction.LimitAmount.issuer,
            currency: transaction.LimitAmount.currency,
            limit: parseFloat(transaction.LimitAmount.value),
            ledgerIndex: tx.ledger_index,
            txHash: transaction.hash
        };
    } catch (error) {
        console.error('Error extracting trustline details:', error);
        return null;
    }
};

/**
 * Check if this is a new token that hasn't been seen before
 * @param {string} currency - Token currency code
 * @param {string} issuer - Token issuer address
 * @returns {Promise<boolean>} - True if this is a new token
 */
const checkIfNewToken = async (currency, issuer) => {
    try {
        // Check our database first
        const existingToken = await tokenService.getToken({ currency, issuer });
        
        if (existingToken && existingToken.success) {
            return false;
        }
        
        // Also check XRPLMeta to see if this token has been registered there
        const metaInfo = await tokenInfoService.getTokenBasicInfo(currency, issuer);
        
        if (metaInfo && metaInfo.success && metaInfo.token) {
            // Token exists in XRPLMeta but not in our DB
            return true;
        }
        
        // Get trustlines count for this token
        const api = await xrplService.getXrplApi();
        const accountInfo = await api.request({
            command: 'account_info',
            account: issuer,
            ledger_index: 'validated'
        });
        
        // Only consider it a new token if it has more than 1 trustline
        // This helps filter out test tokens or accidental trustlines
        const trustlinesCount = await getTrustlinesCount(issuer, currency);
        
        return trustlinesCount >= 3;
    } catch (error) {
        console.error('Error checking if new token:', error);
        return false;
    }
};

/**
 * Get trustlines count for a token
 * @param {string} issuer - Token issuer
 * @param {string} currency - Token currency
 * @returns {Promise<number>} - Number of trustlines
 */
const getTrustlinesCount = async (issuer, currency) => {
    try {
        // This is simplified - in a real implementation you would need to
        // use multiple API calls to get the complete list of trustlines
        const response = await axios.get(
            `https://api.xrpldata.com/api/v1/token/trustlines?issuer=${issuer}&currency=${currency}`
        );
        
        if (response.data && response.data.count) {
            return response.data.count;
        }
        
        return 0;
    } catch (error) {
        console.error('Error getting trustlines count:', error);
        return 0;
    }
};

/**
 * Process a new token detection
 * @param {object} bot - Telegram bot instance
 * @param {object} trustline - Trustline details
 * @returns {Promise<void>}
 */
const processNewToken = async (bot, trustline) => {
    try {
        // Get more token info
        const tokenInfo = await tokenInfoService.getTokenBasicInfo(
            trustline.currency, 
            trustline.issuer
        );
        
        // Create token in our database
        const token = {
            currency: trustline.currency,
            issuer: trustline.issuer,
            name: tokenInfo.token ? tokenInfo.token.name : null,
            symbol: tokenInfo.token ? tokenInfo.token.symbol : null,
            source: 'trustline-monitor',
            discoveryLedger: trustline.ledgerIndex,
            discoveryTimestamp: new Date()
        };
        
        // Save token to database
        const saveResult = await tokenService.addToken(token);
        
        if (saveResult && saveResult.success) {
            // Send notification to master channel
            await masterChannelService.postNewTokenAlert(bot, token);
            
            console.log(`✅ New token detected and saved: ${token.symbol || token.currency}`);
        }
    } catch (error) {
        console.error('Error processing new token:', error);
    }
};

/**
 * Check XRPLMeta API for new tokens
 * @param {object} bot - Telegram bot instance
 * @returns {Promise<void>}
 */
const checkXRPLMetaForNewTokens = async (bot) => {
    try {
        // Get recent tokens from XRPLMeta
        const response = await axios.get('https://api.xrplmeta.org/api/v1/tokens/recent');
        
        if (!response.data || !Array.isArray(response.data.tokens)) {
            return;
        }
        
        // Process each token
        for (const metaToken of response.data.tokens) {
            try {
                // Check if we already have this token
                const existingToken = await tokenService.getToken({
                    currency: metaToken.currency,
                    issuer: metaToken.issuer
                });
                
                if (existingToken && existingToken.success) {
                    continue; // Skip tokens we already have
                }
                
                // Create a trustline object for processing
                const trustline = {
                    currency: metaToken.currency,
                    issuer: metaToken.issuer,
                    ledgerIndex: metaToken.updatedLedgerIndex || 0
                };
                
                // Process as a new token
                await processNewToken(bot, trustline);
                
                // Add small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                console.error(`Error processing token from XRPLMeta: ${metaToken.currency}`, error);
            }
        }
    } catch (error) {
        console.error('Error checking XRPLMeta for new tokens:', error);
    }
};

module.exports = {
    startMonitoring,
    stopMonitoring
}; 