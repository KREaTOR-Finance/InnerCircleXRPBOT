const xrplTrustlineMonitor = require('../services/xrplTrustlineMonitorService');

// Bot instance to be initialized
let bot;

/**
 * Handle the /scantrustlines command
 * Manually triggers a scan for new trustlines
 */
async function handleScanTrustlinesCommand(msg) {
    const chatId = msg.chat.id;
    
    try {
        // Send initial message
        const initialMessage = await bot.sendMessage(chatId, 'Scanning for new tokens via trustlines... This may take a minute ⏳');
        
        // Try to get the broadcastToActiveChats function from bot
        const broadcastFn = typeof bot.broadcastToActiveChats === 'function' ? 
            bot.broadcastToActiveChats : 
            async (message, options) => {
                await bot.sendMessage(chatId, message, options); 
            };
        
        // Get the active chats count if possible
        const getActiveChatsCount = typeof bot.getActiveChatsCount === 'function' ? 
            bot.getActiveChatsCount : 
            () => 1; // Default to 1 (current chat) if function not found
            
        // Perform the scan with broadcast capabilities
        const newTokens = await xrplTrustlineMonitor.scanForNewTrustlines(bot, broadcastFn);
        
        if (!newTokens || newTokens.length === 0) {
            await bot.editMessageText('No new tokens found in this scan. Try again later!', {
                chat_id: chatId,
                message_id: initialMessage.message_id
            });
            return;
        }
        
        // Edit the initial message to show success
        const activeChatsCount = getActiveChatsCount();
        const broadcastMsg = activeChatsCount > 1 ? 
            `Sent notifications to ${activeChatsCount} active chats.` : 
            'Showing results below:';
            
        await bot.editMessageText(`Found ${newTokens.length} new tokens! ${broadcastMsg}`, {
            chat_id: chatId,
            message_id: initialMessage.message_id
        });
        
        // If we didn't broadcast to multiple chats, send the results just to this chat
        if (activeChatsCount <= 1) {
            // Send each token as a separate message
            for (const token of newTokens) {
                const message = xrplTrustlineMonitor.formatTokenForNotification(token);
                await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
            }
        }
    } catch (error) {
        console.error('Error handling scan trustlines command:', error);
        await bot.sendMessage(chatId, 'An error occurred while scanning for new tokens. Please try again later.');
    }
}

/**
 * Handle the /monitortrust start/stop commands
 * Start or stop the trustline monitoring service
 */
async function handleMonitorCommand(msg) {
    const chatId = msg.chat.id;
    const messageText = msg.text.trim().toLowerCase();
    
    if (messageText === '/monitortrust start') {
        try {
            // Get the broadcastToActiveChats function from bot.js
            const broadcastFn = bot.broadcastToActiveChats || 
                ((message, options) => bot.sendMessage(chatId, message, options));
                
            await xrplTrustlineMonitor.monitorTrustlines(bot, broadcastFn);
            await bot.sendMessage(chatId, '✅ Trustline monitoring service started. You will be notified of new token launches automatically.');
        } catch (error) {
            console.error('Error starting trustline monitor:', error);
            await bot.sendMessage(chatId, '❌ Failed to start trustline monitoring service. Please try again later.');
        }
    } else if (messageText === '/monitortrust stop') {
        await bot.sendMessage(chatId, 'Trustline monitoring will continue running in the background. This is a continuous service.');
    } else {
        await bot.sendMessage(chatId, 'Usage: /monitortrust start|stop');
    }
}

/**
 * Handle the command to add the current chat to notifications
 */
async function handleAddThisChatCommand(msg) {
    const chatId = msg.chat.id;
    
    try {
        if (bot.addChatToLaunchNotifications) {
            bot.addChatToLaunchNotifications(chatId);
            await bot.sendMessage(chatId, `✅ Added this chat (ID: ${chatId}) to launch notifications list. You will now receive new token alerts in this chat.`);
        } else {
            await bot.sendMessage(chatId, '❌ Unable to add chat - function not available.');
        }
    } catch (error) {
        console.error('Error handling addthischat command:', error);
        await bot.sendMessage(chatId, 'An error occurred while adding this chat to notifications.');
    }
}

/**
 * Initialize commands with the bot instance
 * @param {Object} botInstance - The Telegram bot instance
 * @param {Object} helpers - Optional helper functions
 */
function initializeCommands(botInstance, helpers = {}) {
    bot = botInstance;
    
    // Store helper functions on the bot object for access in commands
    if (helpers.broadcastToActiveChats) {
        bot.broadcastToActiveChats = helpers.broadcastToActiveChats;
    }
    
    if (helpers.getActiveChatsCount) {
        bot.getActiveChatsCount = helpers.getActiveChatsCount;
    }
    
    if (helpers.addChatToLaunchNotifications) {
        bot.addChatToLaunchNotifications = helpers.addChatToLaunchNotifications;
    }
    
    // Register command handlers
    bot.onText(/\/scantrustlines/, handleScanTrustlinesCommand);
    bot.onText(/\/monitortrust (.+)/, handleMonitorCommand);
    bot.onText(/\/addthischat/, handleAddThisChatCommand);
}

module.exports = {
    initializeCommands,
    handleScanTrustlinesCommand,
    handleMonitorCommand,
    handleAddThisChatCommand
}; 