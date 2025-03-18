const config = require('../config');

/**
 * Master Channel Service
 * Handles operations related to the master channel for broadcasting announcements
 */

/**
 * Initialize the master channel
 * @param {object} bot - Telegram bot instance 
 * @returns {Promise<void>}
 */
const initMasterChannel = async (bot) => {
    try {
        if (!config.masterChannelId) {
            console.warn('⚠️ No master channel ID configured. Broadcasting will be disabled.');
            return;
        }
        
        // Test the connection to the master channel
        const chatInfo = await bot.getChat(config.masterChannelId);
        
        if (chatInfo) {
            console.log(`✅ Connected to master channel: ${chatInfo.title || config.masterChannelId}`);
        }
    } catch (error) {
        console.error('❌ Error connecting to master channel:', error.message);
        console.warn('⚠️ Broadcasting to master channel will be unavailable');
    }
};

/**
 * Send a message to the master channel
 * @param {object} bot - Telegram bot instance
 * @param {string} message - Message to send
 * @param {object} options - Additional options for the message
 * @returns {Promise<object>} The sent message
 */
const sendToMasterChannel = async (bot, message, options = {}) => {
    try {
        if (!config.masterChannelId) {
            console.error('Master channel ID not configured');
            return null;
        }
        
        const sentMessage = await bot.sendMessage(config.masterChannelId, message, {
            parse_mode: 'Markdown',
            ...options
        });
        
        return sentMessage;
    } catch (error) {
        console.error('Error sending to master channel:', error);
        return null;
    }
};

/**
 * Send an image to the master channel
 * @param {object} bot - Telegram bot instance
 * @param {string|Buffer} photo - Photo URL or Buffer
 * @param {string} caption - Caption for the image
 * @param {object} options - Additional options for the message
 * @returns {Promise<object>} The sent message
 */
const sendImageToMasterChannel = async (bot, photo, caption = '', options = {}) => {
    try {
        if (!config.masterChannelId) {
            console.error('Master channel ID not configured');
            return null;
        }
        
        const sentMessage = await bot.sendPhoto(config.masterChannelId, photo, {
            caption,
            parse_mode: 'Markdown',
            ...options
        });
        
        return sentMessage;
    } catch (error) {
        console.error('Error sending image to master channel:', error);
        return null;
    }
};

/**
 * Post a new token alert to the master channel
 * @param {object} bot - Telegram bot instance
 * @param {object} token - Token information object
 * @returns {Promise<object>} The sent message
 */
const postNewTokenAlert = async (bot, token) => {
    try {
        const message = `🔔 *NEW TOKEN DETECTED* 🔔\n\n` +
            `*Name:* ${token.name || 'Unknown'}\n` +
            `*Symbol:* ${token.symbol || 'Unknown'}\n` +
            `*Issuer:* \`${token.issuer}\`\n\n` +
            (token.description ? `*Description:* ${token.description}\n\n` : '') +
            `Use /xrpltoken ${token.symbol || token.currency} to get more details.`;
        
        return await sendToMasterChannel(bot, message);
    } catch (error) {
        console.error('Error posting new token alert:', error);
        return null;
    }
};

/**
 * Post a project announcement to the master channel
 * @param {object} bot - Telegram bot instance
 * @param {object} project - Project information
 * @returns {Promise<object>} The sent message
 */
const postProjectAnnouncement = async (bot, project) => {
    try {
        const message = `📢 *NEW PROJECT ADDED* 📢\n\n` +
            `*Name:* ${project.name}\n` +
            `*Description:* ${project.description || 'No description'}\n\n` +
            (project.website ? `*Website:* ${project.website}\n` : '') +
            (project.telegram ? `*Telegram:* ${project.telegram}\n` : '') +
            (project.twitter ? `*Twitter:* ${project.twitter}\n` : '');
        
        let options = {};
        
        // Add inline keyboard if the project has a token
        if (project.tokenId) {
            options.reply_markup = {
                inline_keyboard: [
                    [
                        { text: "View Token", callback_data: `token_${project.tokenId}` },
                        { text: "Vote", callback_data: `vote_${project._id}` }
                    ]
                ]
            };
        }
        
        return await sendToMasterChannel(bot, message, options);
    } catch (error) {
        console.error('Error posting project announcement:', error);
        return null;
    }
};

module.exports = {
    initMasterChannel,
    sendToMasterChannel,
    sendImageToMasterChannel,
    postNewTokenAlert,
    postProjectAnnouncement
}; 