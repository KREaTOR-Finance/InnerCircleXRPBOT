/**
 * Format a number with commas for thousands
 * @param {number} num - The number to format
 * @returns {string} - Formatted number
 */
const formatNumber = (num) => {
    if (!num) return '0';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

/**
 * Format currency with $ symbol and 2 decimal places
 * @param {number} amount - The amount to format
 * @returns {string} - Formatted currency
 */
const formatCurrency = (amount) => {
    if (!amount) return '$0.00';
    return `$${parseFloat(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
};

/**
 * Format ROI percentage
 * @param {number} roi - The ROI value
 * @returns {string} - Formatted ROI with emoji
 */
const formatROI = (roi) => {
    if (!roi) return '0%';
    
    const formattedROI = `${roi > 0 ? '+' : ''}${roi.toFixed(2)}%`;
    
    if (roi > 50) return `🚀 ${formattedROI}`;
    if (roi > 0) return `📈 ${formattedROI}`;
    if (roi < -50) return `💥 ${formattedROI}`;
    if (roi < 0) return `📉 ${formattedROI}`;
    
    return `➖ ${formattedROI}`;
};

/**
 * Calculate ROI percentage
 * @param {number} initialPrice - The initial price
 * @param {number} currentPrice - The current price
 * @returns {number} - ROI percentage
 */
const calculateROI = (initialPrice, currentPrice) => {
    if (!initialPrice || !currentPrice) return 0;
    return ((currentPrice - initialPrice) / initialPrice) * 100;
};

/**
 * Escape special characters for Markdown
 * @param {string} text - The text to escape
 * @returns {string} - Escaped text
 */
const escapeMarkdown = (text) => {
    if (!text) return '';
    return text.replace(/([_*\[\]()~`>#+=|{}.!-])/g, '\\$1');
};

/**
 * Truncate address for display
 * @param {string} address - The address to truncate
 * @returns {string} - Truncated address
 */
const truncateAddress = (address) => {
    if (!address) return '';
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
};

/**
 * Send a message with automatic retry for rate limits
 * @param {object} bot - The bot instance
 * @param {string|number} chatId - Chat ID to send the message to
 * @param {string} text - Message text
 * @param {object} options - Additional message options
 * @param {number} maxRetries - Maximum number of retries (default: 3)
 * @param {number} retryDelay - Initial delay before retry in ms (default: 1000)
 * @returns {Promise<object>} - The sent message
 */
const sendMessageWithRetry = async (bot, chatId, text, options = {}, maxRetries = 3, retryDelay = 1000) => {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            // Attempt to send the message
            return await bot.sendMessage(chatId, text, options);
        } catch (error) {
            lastError = error;
            
            // Check if it's a rate limit error
            if (error.response && error.response.statusCode === 429) {
                const retryAfter = error.response.body.parameters?.retry_after || 5;
                console.warn(`⚠️ Rate limited while sending message. Waiting ${retryAfter} seconds before retry ${attempt + 1}/${maxRetries}`);
                
                // Wait for the recommended time or use exponential backoff
                const waitTime = retryAfter * 1000 || retryDelay * Math.pow(2, attempt);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }
            
            // For other errors, throw immediately
            throw error;
        }
    }
    
    // If we've exhausted all retries
    console.error(`❌ Failed to send message after ${maxRetries} retries:`, lastError);
    throw lastError;
};

module.exports = {
    formatNumber,
    formatCurrency,
    formatROI,
    calculateROI,
    escapeMarkdown,
    truncateAddress,
    sendMessageWithRetry
}; 