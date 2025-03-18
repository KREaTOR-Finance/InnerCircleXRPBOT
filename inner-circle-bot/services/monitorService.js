const config = require('../config');
const tokenService = require('./tokenService');
const userService = require('./userService');
const tokenInfoService = require('./tokenInfoService');
const masterChannelService = require('./masterChannelService');

// Keep track of monitored tokens and their price alerts
const monitoredTokens = {};
const priceAlerts = {};

/**
 * Monitor Service
 * Handles monitoring token prices and alerts
 */

/**
 * Initialize price monitoring for a token
 * @param {string} currency - Token currency code
 * @param {string} issuer - Token issuer address
 * @param {number} initialPrice - Initial price of the token
 * @returns {boolean} - Success status
 */
const startMonitoringToken = (currency, issuer, initialPrice) => {
    const tokenKey = `${currency}.${issuer}`;
    
    if (monitoredTokens[tokenKey]) {
        // Token is already being monitored
        return false;
    }
    
    monitoredTokens[tokenKey] = {
        currency,
        issuer,
        initialPrice,
        lastPrice: initialPrice,
        lastUpdated: new Date(),
        priceHistory: [{
            price: initialPrice,
            timestamp: new Date()
        }]
    };
    
    return true;
};

/**
 * Stop monitoring a token
 * @param {string} currency - Token currency code
 * @param {string} issuer - Token issuer address
 * @returns {boolean} - Success status
 */
const stopMonitoringToken = (currency, issuer) => {
    const tokenKey = `${currency}.${issuer}`;
    
    if (!monitoredTokens[tokenKey]) {
        return false;
    }
    
    delete monitoredTokens[tokenKey];
    return true;
};

/**
 * Update token price
 * @param {string} currency - Token currency code
 * @param {string} issuer - Token issuer address
 * @param {number} price - Current price
 * @returns {object} - Price change information
 */
const updateTokenPrice = (currency, issuer, price) => {
    const tokenKey = `${currency}.${issuer}`;
    
    if (!monitoredTokens[tokenKey]) {
        return {
            success: false,
            message: 'Token is not being monitored'
        };
    }
    
    const token = monitoredTokens[tokenKey];
    const previousPrice = token.lastPrice;
    const priceChange = previousPrice > 0 
        ? ((price - previousPrice) / previousPrice) * 100 
        : 0;
    
    // Update token data
    token.lastPrice = price;
    token.lastUpdated = new Date();
    token.priceHistory.push({
        price,
        timestamp: new Date()
    });
    
    // Keep price history manageable (last 24 hours or 100 points)
    if (token.priceHistory.length > 100) {
        token.priceHistory.shift();
    }
    
    // Check for price alerts
    checkPriceAlerts(currency, issuer, price, priceChange);
    
    return {
        success: true,
        previousPrice,
        currentPrice: price,
        priceChange
    };
};

/**
 * Set a price alert for a token
 * @param {string} userId - User ID who set the alert
 * @param {string} currency - Token currency code
 * @param {string} issuer - Token issuer address
 * @param {number} targetPrice - Price to trigger the alert
 * @param {string} direction - 'above' or 'below' to indicate when alert triggers
 * @returns {object} - Result of the operation
 */
const setPriceAlert = (userId, currency, issuer, targetPrice, direction) => {
    const tokenKey = `${currency}.${issuer}`;
    const alertKey = `${userId}-${tokenKey}-${direction}-${targetPrice}`;
    
    if (!priceAlerts[tokenKey]) {
        priceAlerts[tokenKey] = {};
    }
    
    priceAlerts[tokenKey][alertKey] = {
        userId,
        currency,
        issuer,
        targetPrice,
        direction,
        createdAt: new Date(),
        triggered: false
    };
    
    return {
        success: true,
        alertKey
    };
};

/**
 * Remove a price alert
 * @param {string} alertKey - Key of the alert to remove
 * @returns {boolean} - Success status
 */
const removePriceAlert = (alertKey) => {
    // Find the token key containing this alert
    for (const tokenKey in priceAlerts) {
        if (priceAlerts[tokenKey][alertKey]) {
            delete priceAlerts[tokenKey][alertKey];
            return true;
        }
    }
    
    return false;
};

/**
 * Get all price alerts for a user
 * @param {string} userId - User ID
 * @returns {Array} - List of price alerts for the user
 */
const getUserPriceAlerts = (userId) => {
    const userAlerts = [];
    
    for (const tokenKey in priceAlerts) {
        for (const alertKey in priceAlerts[tokenKey]) {
            const alert = priceAlerts[tokenKey][alertKey];
            if (alert.userId === userId) {
                userAlerts.push({
                    ...alert,
                    alertKey
                });
            }
        }
    }
    
    return userAlerts;
};

/**
 * Check if any price alerts should be triggered
 * @param {string} currency - Token currency code
 * @param {string} issuer - Token issuer address
 * @param {number} price - Current price
 * @param {number} priceChange - Price change percentage
 * @returns {Array} - Triggered alerts
 */
const checkPriceAlerts = (currency, issuer, price, priceChange) => {
    const tokenKey = `${currency}.${issuer}`;
    const triggeredAlerts = [];
    
    if (!priceAlerts[tokenKey]) {
        return triggeredAlerts;
    }
    
    for (const alertKey in priceAlerts[tokenKey]) {
        const alert = priceAlerts[tokenKey][alertKey];
        
        if (alert.triggered) {
            continue;
        }
        
        let shouldTrigger = false;
        
        if (alert.direction === 'above' && price >= alert.targetPrice) {
            shouldTrigger = true;
        } else if (alert.direction === 'below' && price <= alert.targetPrice) {
            shouldTrigger = true;
        }
        
        if (shouldTrigger) {
            alert.triggered = true;
            alert.triggeredAt = new Date();
            alert.triggeredPrice = price;
            triggeredAlerts.push(alert);
        }
    }
    
    return triggeredAlerts;
};

/**
 * Send price alert notifications to users
 * @param {object} bot - Telegram bot instance
 * @param {Array} triggeredAlerts - List of triggered alerts
 * @returns {Promise<void>}
 */
const sendPriceAlertNotifications = async (bot, triggeredAlerts) => {
    for (const alert of triggeredAlerts) {
        try {
            const user = await userService.getUserById(alert.userId);
            if (!user || !user.telegramId) continue;
            
            const token = await tokenInfoService.getToken(alert.currency, alert.issuer);
            const tokenName = token ? token.name || token.symbol || alert.currency : alert.currency;
            
            const message = `🚨 *PRICE ALERT* 🚨\n\n` +
                `Your price alert for *${tokenName}* has been triggered!\n\n` +
                `Target: ${alert.direction === 'above' ? '↗️ Above' : '↘️ Below'} ${alert.targetPrice} XRP\n` +
                `Current price: ${alert.triggeredPrice} XRP`;
            
            await bot.sendMessage(user.telegramId, message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('Error sending price alert notification:', error);
        }
    }
};

/**
 * Run regular price updates
 * @param {object} bot - Telegram bot instance
 * @returns {Promise<void>}
 */
const runPriceUpdates = async (bot) => {
    for (const tokenKey in monitoredTokens) {
        const token = monitoredTokens[tokenKey];
        
        try {
            // Get updated price from token info service
            const priceInfo = await tokenInfoService.getTokenPrice(token.currency, token.issuer);
            
            if (priceInfo && priceInfo.price) {
                const update = updateTokenPrice(token.currency, token.issuer, priceInfo.price);
                
                // If significant price change (>5%), notify users
                if (update.success && Math.abs(update.priceChange) >= 5) {
                    // Get token details
                    const tokenInfo = await tokenInfoService.getToken(token.currency, token.issuer);
                    
                    const emoji = update.priceChange > 0 ? '🚀' : '📉';
                    const message = `${emoji} *PRICE MOVEMENT* ${emoji}\n\n` +
                        `*${tokenInfo.name || tokenInfo.symbol || token.currency}* ` +
                        `has ${update.priceChange > 0 ? 'increased' : 'decreased'} by ` +
                        `${Math.abs(update.priceChange).toFixed(2)}%\n\n` +
                        `Previous price: ${update.previousPrice} XRP\n` +
                        `Current price: ${update.currentPrice} XRP`;
                    
                    // Send to master channel
                    await masterChannelService.sendToMasterChannel(bot, message);
                }
                
                // Check and send price alerts
                const triggeredAlerts = checkPriceAlerts(
                    token.currency, 
                    token.issuer, 
                    priceInfo.price, 
                    update.priceChange
                );
                
                if (triggeredAlerts.length > 0) {
                    await sendPriceAlertNotifications(bot, triggeredAlerts);
                }
            }
        } catch (error) {
            console.error(`Error updating price for token ${tokenKey}:`, error);
        }
    }
};

/**
 * Initialize the monitor service
 * @param {object} bot - Telegram bot instance
 * @returns {Promise<boolean>} - Success status
 */
const initialize = async (bot) => {
    try {
        console.log('🔄 Initializing price monitoring service...');
        
        // Start periodic price updates (every 15 minutes)
        setInterval(() => {
            runPriceUpdates(bot);
        }, 15 * 60 * 1000);
        
        // Run once at startup
        setTimeout(() => {
            runPriceUpdates(bot);
        }, 10000); // Wait 10 seconds after startup
        
        console.log('✅ Price monitoring service initialized');
        return true;
    } catch (error) {
        console.error('❌ Error initializing monitor service:', error);
        return false;
    }
};

module.exports = {
    initialize,
    startMonitoringToken,
    stopMonitoringToken,
    updateTokenPrice,
    setPriceAlert,
    removePriceAlert,
    getUserPriceAlerts,
    runPriceUpdates
}; 