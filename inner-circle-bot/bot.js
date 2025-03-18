require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const connectDB = require('./db/database');
const config = require('./config');
const menu = require('./menu');
const mongoose = require('mongoose');
const { 
    handleScanCommand, 
    handleSocialCommand, 
    handleTwitterCommand, 
    handleConnectionTestCommand,
    handleXrplTokenCommand,
    handleXrplSearchCommand,
    handleXrplHoldersCommand,
    handleXrplCallbackQuery,
    processSocialUrlSubmission,
    processWalletAddressSubmission,
    initializeCommands
} = require('./commands/tokenCommands');
const tokenAnalysisService = require('./services/tokenAnalysisService');
const tokenInfoService = require('./services/tokenInfoService');

// Import services
const tokenService = require('./services/tokenService');
const projectService = require('./services/projectService');
const votingService = require('./services/votingService');
const roiService = require('./services/roiService');
const userService = require('./services/userService');
const xrplService = require('./services/xrplService');
const scoreboardService = require('./services/leaderboardService');
const masterChannelService = require('./services/masterChannelService');
const xrplAddressService = require('./services/xrplAddressService');
const ammService = require('./services/ammService');
const monitorService = require('./services/monitorService');
const chatGroupService = require('./services/chatGroupService');
const xrplTrustlineMonitor = require('./services/xrplTrustlineMonitorService');
const helpers = require('./utils/helpers');
const imageUtils = require('./utils/imageUtils');
const axios = require('axios');

// Import commands
const xrplTrustlineCommands = require('./commands/xrplTrustlineCommands');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Add rate limit handling
bot.on('polling_error', (error) => {
    if (error.code === 'ETELEGRAM' && error.response && error.response.statusCode === 429) {
        const retryAfter = error.response.body.parameters?.retry_after || 5;
        console.warn(`⚠️ Rate limited by Telegram! Waiting ${retryAfter} seconds before continuing...`);
        
        // Pause polling for the specified time to avoid more rate limits
        bot.stopPolling().then(() => {
            setTimeout(() => {
                console.log('▶️ Resuming polling after rate limit...');
                bot.startPolling();
            }, retryAfter * 1000);
        });
    } else {
        console.error('❌ Polling error:', error);
    }
});

// Initialize tokenCommands with bot instance
initializeCommands(bot);

// Don't initialize trustline commands here - will do it later after functions are defined
// xrplTrustlineCommands.initializeCommands(bot, {
//     broadcastToActiveChats,
//     getActiveChatsCount
// });

// Store the bot's ID for later use
let botId = null;

// Get the bot's ID from the token
const getBotId = () => {
    if (botId) return botId;
    
    // Extract the bot ID from the token (token format: 123456789:ABCDefGhIJklMNoPQRstUvWxYZ)
    botId = process.env.BOT_TOKEN.split(':')[0];
    return botId;
};

// Log bot information 
console.log(`✅ Bot initialized with ID: ${getBotId()}`);

// 📌 Connect to MongoDB
connectDB();

// Store for active chats that should receive launch notifications
// We'll use a Map to store chat IDs and their metadata
const activeChats = new Map();

// Load active chats from database on startup
const loadActiveChats = async () => {
    try {
        console.log('Loading active chats...');
        
        // Clear any existing chats 
        activeChats.clear();
        
        // Add admin chat if configured
        if (process.env.ADMIN_CHAT_ID && process.env.ADMIN_CHAT_ID !== 'your_admin_chat_id') {
            activeChats.set(process.env.ADMIN_CHAT_ID, {
                type: 'admin',
                addedAt: new Date(),
                active: true
            });
            console.log(`Added admin chat ${process.env.ADMIN_CHAT_ID} to active chats`);
        }
        
        // Add master channel chat if configured
        if (process.env.MASTER_CHANNEL_ID && process.env.MASTER_CHANNEL_ID !== 'your_master_channel_id') {
            activeChats.set(process.env.MASTER_CHANNEL_ID, {
                type: 'channel',
                addedAt: new Date(),
                active: true
            });
            console.log(`Added master channel ${process.env.MASTER_CHANNEL_ID} to active chats`);
        }
        
        // Load all chat groups that should receive notifications
        try {
            const chatGroups = await chatGroupService.getAllActiveGroups();
            if (chatGroups && chatGroups.success && chatGroups.groups) {
                for (const group of chatGroups.groups) {
                    if (group.chatId && group.isActive) {
                        activeChats.set(group.chatId.toString(), {
                            type: 'group',
                            name: group.name || 'Unknown Group',
                            addedAt: group.createdAt || new Date(),
                            active: true
                        });
                        console.log(`Added group chat ${group.chatId} (${group.name || 'Unknown'}) to active chats`);
                    }
                }
            }
        } catch (dbError) {
            console.error('Error loading chat groups from database:', dbError);
        }
        
        console.log(`Loaded ${activeChats.size} active chats`);
        
        // Debug: print all active chat IDs
        console.log('Active chat IDs:');
        for (const [chatId, data] of activeChats) {
            console.log(`- ${chatId} (${data.type})`);
        }
        
        return activeChats.size;
    } catch (error) {
        console.error('Error loading active chats:', error);
        return 0;
    }
};

// Add a chat to receive launch notifications
const addChatToLaunchNotifications = (chatId) => {
    const chatIdStr = chatId.toString();
    
    // Only add if not already in the map
    if (!activeChats.has(chatIdStr)) {
        activeChats.set(chatIdStr, {
            type: 'user',
            addedAt: new Date(),
            active: true
        });
        console.log(`Added chat ${chatIdStr} to active chats. Total active chats: ${activeChats.size}`);
    } else {
        // Update existing chat to be active
        const chatData = activeChats.get(chatIdStr);
        chatData.active = true;
        activeChats.set(chatIdStr, chatData);
        console.log(`Updated chat ${chatIdStr} to active status`);
    }
};

// Remove a chat from launch notifications
const removeChatFromLaunchNotifications = (chatId) => {
    const chatIdStr = chatId.toString();
    
    // Instead of deleting, mark as inactive
    if (activeChats.has(chatIdStr)) {
        const chatData = activeChats.get(chatIdStr);
        chatData.active = false;
        activeChats.set(chatIdStr, chatData);
        console.log(`Marked chat ${chatIdStr} as inactive. Total active chats: ${getActiveChatsCount()}`);
    }
};

// Get count of active chats
const getActiveChatsCount = () => {
    let count = 0;
    for (const [_, data] of activeChats) {
        if (data.active) count++;
    }
    return count;
};

// Broadcast a message to all active chats
const broadcastToActiveChats = async (message, options = {}) => {
    const activeCount = getActiveChatsCount();
    console.log(`Broadcasting to ${activeCount} active chats`);
    
    if (activeCount === 0) {
        console.warn('⚠️ No active chats to broadcast to! Message will not be sent to anyone.');
        return { sentCount: { success: 0, failed: 0 }, failedChats: [] };
    }
    
    const sentCount = { success: 0, failed: 0 };
    const failedChats = [];
    
    // Debug: print all active chats (both active and inactive)
    console.log('All registered chats (including inactive):');
    let activeChatsLog = [];
    let inactiveChatsLog = [];
    
    for (const [chatId, data] of activeChats) {
        const chatInfo = `- ${chatId} (${data.type || 'unknown type'})${data.name ? ` - ${data.name}` : ''}`;
        if (data.active) {
            activeChatsLog.push(chatInfo);
        } else {
            inactiveChatsLog.push(chatInfo);
        }
    }
    
    // Print active chats first, then inactive
    console.log("ACTIVE CHATS:");
    if (activeChatsLog.length > 0) {
        activeChatsLog.forEach(log => console.log(log));
    } else {
        console.log("  None");
    }
    
    console.log("INACTIVE CHATS:");
    if (inactiveChatsLog.length > 0) {
        inactiveChatsLog.forEach(log => console.log(log));
    } else {
        console.log("  None");
    }
    
    for (const [chatId, data] of activeChats) {
        // Skip inactive chats
        if (!data.active) continue;
        
        try {
            console.log(`Attempting to send message to chat ${chatId} (${data.type || 'unknown type'})${data.name ? ` - ${data.name}` : ''}...`);
            await bot.sendMessage(chatId, message, options);
            sentCount.success++;
            console.log(`✅ Successfully sent message to chat ${chatId}`);
            
            // Add a small delay to avoid hitting rate limits
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
            console.error(`❌ Error sending broadcast to chat ${chatId}:`, error.message);
            sentCount.failed++;
            failedChats.push(chatId);
            
            // If the chat is no longer available or we don't have permission, mark it as inactive
            if (error.code === 403 || error.code === 400 || error.code === 401 || 
                error.message.includes('bot was blocked') || 
                error.message.includes('not enough rights') ||
                error.message.includes('chat not found')) {
                console.log(`Marking chat ${chatId} as inactive due to error ${error.code}: ${error.message}`);
                removeChatFromLaunchNotifications(chatId);
            }
        }
    }
    
    console.log(`Broadcast complete. Success: ${sentCount.success}, Failed: ${sentCount.failed}`);
    if (failedChats.length > 0) {
        console.log(`Failed chat IDs: ${failedChats.join(', ')}`);
    }
    
    return { sentCount, failedChats };
};

// Initialize services and start monitoring
const initializeServices = async () => {
    try {
        await loadActiveChats();
        await monitorService.initialize();
        
        // Remove this line since we removed the services it depends on
        // xrplTrustlineCommands.initializeCommands(bot, {
        //     broadcastToActiveChats,
        //     getActiveChatsCount,
        //     addChatToLaunchNotifications
        // });
        
        // Register the bot commands - remove AMM and launch detection commands
        await bot.setMyCommands([
            { command: 'start', description: 'Start the bot' },
            { command: 'menu', description: 'Show the main menu' },
            { command: 'submit', description: 'Submit a new token for admin approval' },
            { command: 'vetting', description: 'View projects in community vetting phase' },
            { command: 'grade', description: 'Grade a token on multiple criteria' },
            { command: 'leaderboards', description: 'View project and user leaderboards' },
            { command: 'lookup', description: 'Look up an XRPL address' },
            { command: 'assets', description: 'Look up assets held by an XRPL address' },
            { command: 'token', description: 'Look up token details and community ratings' },
            { command: 'scan', description: 'Analyze a token contract' },
            { command: 'social', description: 'Get token social analysis' }
        ]);
        
        // Remove launch detection message
        console.log('🚀 Bot initialization complete');
        
        return true;
    } catch (error) {
        console.error('Error initializing services:', error);
        return false;
    }
};

// Start the bot and initialize services
initializeServices().catch(console.error);

// Initialize the master channel service
masterChannelService.initMasterChannel(bot);

// 🔹 Handle /start and /menu commands
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Create or update user
    if (msg.from) {
        await userService.createOrUpdateUser(msg.from);
    }
    
    const welcomeMessage = `
🔵 *Welcome to Inner Circle ⭕️ Bot!* 🔵

Your gateway to discovering, vetting, and tracking XRPL projects.

*What you can do:*
• Browse and vote on new XRPL projects
• Submit projects for community vetting
• Track ROI of approved projects
• Buy tokens directly through the bot
• View leaderboards of top performing projects

Use the menu below to get started!
`;
    
    // Send welcome image with message
    await imageUtils.sendImage(bot, chatId, 'WELCOME', welcomeMessage, {
        parse_mode: 'Markdown',
        ...menu.mainMenu
    });
});

bot.onText(/\/menu/, async (msg) => {
    const chatId = msg.chat.id;
    
    // Send welcome image with menu
    await imageUtils.sendImage(bot, chatId, 'WELCOME', 'Choose an option from the menu:', {
        parse_mode: 'Markdown',
        ...menu.mainMenu
    });
});

// 📌 Project Submission
bot.onText(/\/submit (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const contractAddress = match[1].trim();
    
    // Send a "processing" message
    const processingMsg = await bot.sendMessage(chatId, "⏳ Processing your submission...");
    
    const result = await projectService.submitProject(contractAddress, userId, chatId);
    
    // Edit the processing message with the result
    await bot.editMessageText(result.message, {
        chat_id: chatId,
        message_id: processingMsg.message_id,
        parse_mode: 'Markdown'
    });
    
    // If submission was successful, notify admins
    if (result.success) {
        // Send a GIF or image about community voting
        await bot.sendAnimation(chatId, 'https://media.giphy.com/media/3oEjHV0z8S7WM4MwnK/giphy.gif', {
            caption: "🗳️ <b>Community Grading System</b>\n\nOnce approved by admins, projects are graded by the community on a 1-4 star scale in three categories:\n\n" +
                    "⭐ <b>Meme Character & Branding</b>\n" +
                    "⭐ <b>Roadmap & Vision</b>\n" +
                    "⭐ <b>Team & Dev Activity</b>\n\n" +
                    "Your submission will be reviewed by admins shortly.",
            parse_mode: 'HTML'
        });
        
        // Notify group admins about the new submission
        const project = result.project;
        const adminMessage = `
🆕 <b>New Project Submission</b>

<b>Name:</b> ${project.name}
<b>Symbol:</b> ${project.symbol}
<b>Contract:</b> <code>${project.contractAddress}</code>
<b>Submitted By:</b> ${userId}
<b>Submitted In:</b> ${chatId}

Please review this submission and approve or reject it.
`;

        try {
            // Get the chat group to find admins
            const chatGroupResult = await chatGroupService.getChatGroupById(chatId);
            
            if (chatGroupResult.success) {
                // Get all admins of the chat group
                const adminsResult = await chatGroupService.getChatGroupAdmins(chatId);
                
                if (adminsResult.success && adminsResult.admins.length > 0) {
                    // Skip sending private messages to admins - only notify in the group chat
                    
                    // Send notification in the group chat
                    await sendProjectSubmissionToGroupChat(chatId, project, msg.from);
                } else {
                    // If no group admins found, still post in the group chat
                    await sendProjectSubmissionToGroupChat(chatId, project, msg.from);
                    
                    // And notify global admins as fallback for admin actions
                    await notifyGlobalAdmins(adminMessage, project._id, chatId);
                }
            } else {
                // If chat group not found, fall back to global admins
                await notifyGlobalAdmins(adminMessage, project._id, chatId);
            }
        } catch (error) {
            console.error("Error notifying admins:", error);
            // Fall back to global admins
            await notifyGlobalAdmins(adminMessage, project._id, chatId);
        }
        
        // Increment user's projects submitted count
        await userService.incrementProjectsSubmitted(userId);
    }
});

// 📌 Command to view pending projects (admin only)
bot.onText(/\/pending/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Check if user is an admin
    if (!config.admins.includes(userId.toString())) {
        return bot.sendMessage(chatId, "🚫 This command is only available to admins.");
    }
    
    // Get pending projects
    const result = await projectService.getProjectsByStatus(config.projectStatuses.pending);
    
    if (!result.success || result.projects.length === 0) {
        return bot.sendMessage(chatId, "No pending projects found.", { parse_mode: 'Markdown' });
    }
    
    // Format the message
    let message = "📋 *Pending Projects*\n\n";
    
    for (const project of result.projects) {
        message += `*${project.name}* (${project.symbol})\n`;
        message += `Submitted: ${new Date(project.submittedAt).toLocaleString()}\n`;
        message += `Contract: \`${project.contractAddress}\`\n\n`;
    }
    
    // Send the message with inline buttons for each project
    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: result.projects.map(project => [
                { text: `${project.name} (${project.symbol})`, callback_data: `view_${project._id}` }
            ])
        }
    });
});

// 📌 Command to view vetting board (public)
bot.onText(/\/vetting/, async (msg) => {
    const chatId = msg.chat.id;
    
    // Get projects in vetting status
    const result = await projectService.getProjectsByStatus(config.projectStatuses.vetting);
    
    if (!result.success || result.projects.length === 0) {
        return bot.sendMessage(chatId, "No projects currently in vetting phase.", { parse_mode: 'Markdown' });
    }
    
    // Format the message
    let message = "🔍 *Vetting Board*\n\nThese projects are approved by admins and open for community voting:\n\n";
    
    for (const project of result.projects) {
        message += `*${project.name}* (${project.symbol})\n`;
        message += `Contract: \`${project.contractAddress}\`\n`;
        message += `Bulls: ${project.bulls} | Bears: ${project.bears} | Total Votes: ${project.votes}\n`;
        
        // Add ratings if available
        const ratings = project.getAllAverageRatings();
        if (parseFloat(ratings.memeBranding) > 0 || parseFloat(ratings.roadmapVision) > 0 || parseFloat(ratings.teamActivity) > 0) {
            message += `Meme & Branding: ${ratings.memeBranding}/4 | `;
            message += `Roadmap & Vision: ${ratings.roadmapVision}/4 | `;
            message += `Team & Activity: ${ratings.teamActivity}/4\n`;
            }
            
            // Add chart link if available
        if (project.chartUrl) {
            message += `[View Chart](${project.chartUrl})\n`;
        }
        
        message += `\n`;
    }
    
    // Send the message with inline buttons for each project
    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: {
            inline_keyboard: result.projects.map(project => [
                { text: `Vote on ${project.symbol || project.name}`, callback_data: `vote_options_${project._id}` }
            ])
        }
    });
});

// 📌 Grade Command - Start the grading process
bot.onText(/\/grade (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const projectIdentifier = match[1].trim(); // Can be ID, symbol, or contract address
    
    try {
        // Try to find the project by ID first
        let result = await projectService.getProjectById(projectIdentifier);
    
        // If not found by ID, try by symbol or contract address
    if (!result.success) {
            // Try by symbol
            result = await projectService.getProjectBySymbol(projectIdentifier);
            
            // If still not found, try by contract address
            if (!result.success) {
                result = await projectService.getProjectByContractAddress(projectIdentifier);
            }
        }
        
        if (!result.success) {
            bot.sendMessage(chatId, "❌ Project not found. Please check the ID, symbol, or contract address.");
            return;
        }
        
    const project = result.project;
    
        // Start the grading process by asking for the first category rating
        bot.sendMessage(chatId, `🌟 *Grading: ${project.name} (${project.symbol})*\n\nHow would you rate this project's *Meme Character & Branding*?`, {
            parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                        { text: "⭐", callback_data: `grade_memeBranding_${project._id}_1` },
                        { text: "⭐⭐", callback_data: `grade_memeBranding_${project._id}_2` },
                        { text: "⭐⭐⭐", callback_data: `grade_memeBranding_${project._id}_3` },
                        { text: "⭐⭐⭐⭐", callback_data: `grade_memeBranding_${project._id}_4` }
                ]
            ]
        }
    });
    } catch (error) {
        console.error("Error in grade command:", error);
        bot.sendMessage(chatId, "❌ An error occurred while processing your request.");
    }
});

// 📌 Handle grading callbacks
bot.on('callback_query', async (callbackQuery) => {
    const data = callbackQuery.data;
    const userId = callbackQuery.from.id;
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    
    // Handle main menu buttons
    if (data === "browse_projects") {
        try {
                await bot.sendMessage(chatId, "🔍 *Browse Projects*\n\nChoose a category:", {
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "⭐️ Top Rated", callback_data: "browse_top_rated" },
                                { text: "🆕 Recently Added", callback_data: "browse_recent" }
                            ],
                            [
                                { text: "💰 Highest ROI", callback_data: "browse_roi" },
                                { text: "🔥 Trending", callback_data: "browse_trending" }
                        ],
                        [
                            { text: "🔍 Vetting Board", callback_data: "browse_vetting" }
                            ]
                        ]
                    }
                });
            
            await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
            console.error("Error handling browse_projects callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while processing your request.",
                show_alert: true
            });
        }
        return;
    } else if (data === "leaderboards") {
        try {
                await bot.sendMessage(chatId, "📊 *Leaderboards*\n\nSelect a category:", {
                    parse_mode: "Markdown",
                    reply_markup: {
                inline_keyboard: [
                    [
                                { text: "🏆 Top Projects", callback_data: "leaderboard_projects" },
                                { text: "👥 Top Voters", callback_data: "leaderboard_voters" }
                            ],
                            [
                                { text: "💎 Best ROI", callback_data: "leaderboard_roi" },
                                { text: "🎯 Most Accurate", callback_data: "leaderboard_accuracy" }
                            ]
                        ]
                    }
                });
            
            await bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
            console.error("Error handling leaderboards callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while processing your request.",
                show_alert: true
            });
        }
        return;
    } else if (data === "leaderboard_projects") {
        try {
            // Send loading message
            const loadingMessage = await bot.sendMessage(chatId, "📊 Loading top projects leaderboard...");
            
            // Get top projects by votes
            const result = await scoreboardService.getTopProjectsByVotes(10);
            
            if (!result.success) {
                await bot.editMessageText(`❌ Error: ${result.message}`, {
                    chat_id: chatId,
                    message_id: loadingMessage.message_id
                });
                return;
            }
            
            let leaderboardText = "🏆 *TOP PROJECTS LEADERBOARD* 🏆\n\n";
            result.projects.forEach((project, index) => {
                leaderboardText += `${index + 1}. *${project.name}* - ${project.votes} votes\n`;
            });
            
            await bot.editMessageText(leaderboardText, {
                chat_id: chatId,
                message_id: loadingMessage.message_id,
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Back to Leaderboards", callback_data: "leaderboards" }]
                    ]
                }
            });
            
            await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
            console.error("Error handling leaderboard_projects callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while processing your request.",
                show_alert: true
            });
        }
        return;
    } else if (data === "leaderboard_voters") {
        try {
            // Send loading message
            const loadingMessage = await bot.sendMessage(chatId, "📊 Loading top voters leaderboard...");
            
            // Get top voters
            const result = await scoreboardService.getTopVoters(10);
            
            if (!result.success) {
                await bot.editMessageText(`❌ Error: ${result.message}`, {
                    chat_id: chatId,
                    message_id: loadingMessage.message_id
                });
                await bot.answerCallbackQuery(callbackQuery.id);
                return;
            }
            
            // Generate leaderboard message
            let leaderboardText = "👥 *TOP VOTERS LEADERBOARD* 👥\n\n";
            result.users.forEach((user, index) => {
                leaderboardText += `${index + 1}. *${user.username || 'Anonymous'}* - ${user.projectsVoted} votes\n`;
            });
            
            // Update the message
            await bot.editMessageText(leaderboardText, {
                chat_id: chatId,
                message_id: loadingMessage.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "🔙 Back to Leaderboards", callback_data: "leaderboards" }
                        ]
                    ]
                }
            });
            
            await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
            console.error("Error handling leaderboard_voters callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while processing your request.",
                show_alert: true
            });
        }
        return;
    } else if (data === "leaderboard_roi") {
        try {
            // Send loading message
            const loadingMessage = await bot.sendMessage(chatId, "📊 Loading best ROI projects leaderboard...");
            
            // Get top projects by rating (assuming this is used for ROI)
            const result = await scoreboardService.getTopProjectsByRating(10);
            
            if (!result.success) {
                await bot.editMessageText(`❌ Error: ${result.message}`, {
                    chat_id: chatId,
                    message_id: loadingMessage.message_id
                });
                await bot.answerCallbackQuery(callbackQuery.id);
                return;
            }
            
            // Generate leaderboard message
            let leaderboardText = "💎 *BEST ROI PROJECTS* 💎\n\n";
            result.projects.forEach((project, index) => {
                leaderboardText += `${index + 1}. *${project.name}* - ${project.rating || 'N/A'} rating\n`;
            });
            
            // Update the message
            await bot.editMessageText(leaderboardText, {
                chat_id: chatId,
                message_id: loadingMessage.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "🔙 Back to Leaderboards", callback_data: "leaderboards" }
                        ]
                    ]
                }
            });
            
            await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
            console.error("Error handling leaderboard_roi callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while processing your request.",
                show_alert: true
            });
        }
        return;
    } else if (data === "leaderboard_accuracy") {
        try {
            // Send loading message
            const loadingMessage = await bot.sendMessage(chatId, "📊 Loading most accurate submitters leaderboard...");
            
            // Get top submitters
            const result = await scoreboardService.getTopSubmitters(10);
            
            if (!result.success) {
                await bot.editMessageText(`❌ Error: ${result.message}`, {
                    chat_id: chatId,
                    message_id: loadingMessage.message_id
                });
                await bot.answerCallbackQuery(callbackQuery.id);
                return;
            }
            
            // Generate leaderboard message
            let leaderboardText = "🎯 *MOST ACCURATE SUBMITTERS* 🎯\n\n";
            result.users.forEach((user, index) => {
                leaderboardText += `${index + 1}. *${user.username || 'Anonymous'}* - ${user.projectsSubmitted} submissions\n`;
            });
            
            // Update the message
            await bot.editMessageText(leaderboardText, {
                chat_id: chatId,
                message_id: loadingMessage.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "🔙 Back to Leaderboards", callback_data: "leaderboards" }
                        ]
                    ]
                }
            });
            
            await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
            console.error("Error handling leaderboard_accuracy callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while processing your request.",
                show_alert: true
            });
        }
        return;
    } else if (data === "my_wallet") {
        try {
                const userResult = await userService.getUserByTelegramId(userId);
                if (!userResult.success || !userResult.user.walletAddress) {
                    await bot.sendMessage(chatId, 
                        "❌ No wallet linked. Use `/setwallet YOUR_WALLET` to set up your wallet.", 
                        { parse_mode: "Markdown" }
                    );
        } else {
                    await bot.sendMessage(chatId, "👛 *My Wallet*\n\nChoose an option:", {
                        parse_mode: "Markdown",
                        reply_markup: {
                inline_keyboard: [
                    [
                                    { text: "💰 Balance", callback_data: "wallet_balance" },
                                    { text: "📈 Portfolio", callback_data: "wallet_portfolio" }
                                ],
                                [
                                    { text: "🔄 Transaction History", callback_data: "wallet_history" },
                                    { text: "⚙️ Settings", callback_data: "wallet_settings" }
                                ]
                            ]
                        }
                    });
                }
            
            await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
            console.error("Error handling my_wallet callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while processing your request.",
                show_alert: true
            });
        }
        return;
    } else if (data === "submit_project") {
        try {
                await bot.sendMessage(chatId, 
                "📝 *Submit a Project*\n\nPlease enter the token contract address you want to submit:", 
                    { parse_mode: "Markdown" }
                );
            
            // Store this chat in a temporary state to handle the next message as a submission
            if (!global.pendingSubmissions) {
                global.pendingSubmissions = new Map();
            }
            global.pendingSubmissions.set(chatId, true);
            
            await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
            console.error("Error handling submit_project callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while processing your request.",
                show_alert: true
            });
        }
        return;
    } else if (data.startsWith("submit_")) {
        try {
            // Extract the contract address from the callback data
            const contractAddress = data.substring(7); // Remove "submit_" prefix
            
            // Send a "processing" message
            const processingMsg = await bot.sendMessage(chatId, "⏳ Processing your submission...");
            
            // Submit the project
            const result = await projectService.submitProject(contractAddress, userId, chatId);
            
            // Edit the processing message with the result
            await bot.editMessageText(result.message, {
                chat_id: chatId,
                message_id: processingMsg.message_id,
                parse_mode: 'Markdown'
            });
            
            // If submission was successful, notify admins
            if (result.success) {
                // Send a GIF or image about community voting
                await bot.sendAnimation(chatId, 'https://media.giphy.com/media/3oEjHV0z8S7WM4MwnK/giphy.gif', {
                    caption: "🗳️ <b>Community Grading System</b>\n\nOnce approved by admins, projects are graded by the community on a 1-4 star scale in three categories:\n\n" +
                            "⭐ <b>Meme Character & Branding</b>\n" +
                            "⭐ <b>Roadmap & Vision</b>\n" +
                            "⭐ <b>Team & Dev Activity</b>\n\n" +
                            "Your submission will be reviewed by admins shortly.",
                    parse_mode: 'HTML'
                });
                
                const project = result.project;
                
                // Get user info if available
                const userResult = await userService.getUserByTelegramId(userId);
                const username = userResult.success ? userResult.user.username : null;
                const userFullName = userResult.success ? 
                    `${userResult.user.firstName || ''} ${userResult.user.lastName || ''}`.trim() : 'Unknown';
                
                // Create admin notification message
                const adminMessage = `
🆕 <b>New Project Submission</b>

<b>Name:</b> ${project.name}
<b>Symbol:</b> ${project.symbol}
<b>Contract:</b> <code>${project.contractAddress}</code>
<b>Submitted By:</b> ${userFullName}${username ? ` (@${username})` : ''}

Please review this submission and approve or reject it.
`;
                
                // If submitted in a group chat, notify the group admins
                if (callbackQuery.message.chat.type === 'group' || callbackQuery.message.chat.type === 'supergroup') {
                    // Get group admins
                    const adminsResult = await chatGroupService.getChatGroupAdmins(chatId);
                    
                    if (adminsResult.success && adminsResult.admins.length > 0) {
                        // Skip sending private messages to admins - only notify in the group chat
                        
                        // Send notification in the group chat
                        await sendProjectSubmissionToGroupChat(chatId, project, callbackQuery.from);
                    } else {
                        // If no group admins found, still post in the group chat
                        await sendProjectSubmissionToGroupChat(chatId, project, callbackQuery.from);
                        
                        // And notify global admins as fallback for admin actions
                        await notifyGlobalAdmins(adminMessage, project._id, chatId);
                    }
                } else {
                    // If submitted in private chat, notify global admins
                    await notifyGlobalAdmins(adminMessage, project._id, chatId);
                }
                
                // Increment user's projects submitted count
                await userService.incrementProjectsSubmitted(userId);
            }
            
            await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
            console.error("Error handling submit_ callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while processing your request.",
                show_alert: true
            });
        }
        return;
    } else if (data === "about") {
        try {
                const aboutMessage = `
ℹ️ *About Inner Circle Bot*

Your trusted companion for discovering and tracking XRPL projects.

*Features:*
• Real-time token launch detection
• Community-driven project vetting
• Automated ROI tracking
• Direct token purchases
• Comprehensive project analytics

*Version:* 1.0.0
*Created by:* Inner Circle Team

For support, contact @InnerCircleAdmin
`;
                await bot.sendMessage(chatId, aboutMessage, { parse_mode: "Markdown" });
            
            await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
            console.error("Error handling about callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while processing your request.",
                show_alert: true
            });
        }
        return;
    } else if (data === "browse_vetting") {
        try {
            // Get projects in vetting status
            const result = await projectService.getProjectsByStatus(config.projectStatuses.vetting);
            
            if (!result.success || result.projects.length === 0) {
                await bot.sendMessage(chatId, "No projects currently in vetting phase.", { parse_mode: 'Markdown' });
                await bot.answerCallbackQuery(callbackQuery.id);
        return;
    }
    
            // Format the message
            let message = "🔍 *Vetting Board*\n\nThese projects are approved by admins and open for community voting:\n\n";
            
            for (const project of result.projects) {
                message += `*${project.name}* (${project.symbol})\n`;
                message += `Contract: \`${project.contractAddress}\`\n`;
                message += `Bulls: ${project.bulls} | Bears: ${project.bears} | Total Votes: ${project.votes}\n`;
                
                // Add ratings if available
                const ratings = project.getAllAverageRatings();
                if (parseFloat(ratings.memeBranding) > 0 || parseFloat(ratings.roadmapVision) > 0 || parseFloat(ratings.teamActivity) > 0) {
                    message += `Meme & Branding: ${ratings.memeBranding}/4 | `;
                    message += `Roadmap & Vision: ${ratings.roadmapVision}/4 | `;
                    message += `Team & Activity: ${ratings.teamActivity}/4\n`;
                }
                
                // Add chart link if available
                if (project.chartUrl) {
                    message += `[View Chart](${project.chartUrl})\n`;
                }
                
                message += `\n`;
            }
            
            // Send the message with inline buttons for each project
            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                reply_markup: {
                    inline_keyboard: result.projects.map(project => [
                        { text: `Vote on ${project.symbol || project.name}`, callback_data: `vote_options_${project._id}` }
                    ])
                }
            });
            
        await bot.answerCallbackQuery(callbackQuery.id);
                } catch (error) {
            console.error("Error handling browse_vetting callback:", error);
        await bot.answerCallbackQuery(callbackQuery.id, {
                text: "❌ An error occurred while processing your request.",
            show_alert: true
        });
    }
        return;
    } else if (data === "browse_top_rated") {
        try {
            // Send a loading message
            const loadingMessage = await bot.sendMessage(chatId, "📊 Loading top rated projects...");
            
            // Get top projects by votes
            const result = await scoreboardService.getTopProjectsByVotes(10);
            
            if (!result.success) {
                await bot.editMessageText(`❌ Error: ${result.message}`, {
                chat_id: chatId,
                message_id: loadingMessage.message_id
            });
                await bot.answerCallbackQuery(callbackQuery.id);
        return;
    }
    
            // Generate leaderboard message
            const message = scoreboardService.generateLeaderboardMessage(
                result.projects, 
                "⭐️ Top Rated Projects"
            );
            
            // Update the message
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: loadingMessage.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "🔙 Back to Browse", callback_data: "browse_projects" }
                        ]
                    ]
                }
            });
            
            await bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
            console.error("Error handling browse_top_rated callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while processing your request.",
                show_alert: true
            });
        }
        return;
    } else if (data === "browse_recent") {
        try {
            // Send a loading message
            const loadingMessage = await bot.sendMessage(chatId, "📊 Loading recently added projects...");
            
            // Get recent projects
            const result = await projectService.getAllProjects();
            
            if (!result.success) {
                await bot.editMessageText(`❌ Error: ${result.message}`, {
                chat_id: chatId,
                message_id: loadingMessage.message_id
            });
                await bot.answerCallbackQuery(callbackQuery.id);
                return;
            }
            
            // Sort by submission date (newest first) and take top 10
            const recentProjects = result.projects
                .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
                .slice(0, 10);
            
            if (recentProjects.length === 0) {
                await bot.editMessageText("No projects found.", {
                    chat_id: chatId,
                    message_id: loadingMessage.message_id
                });
                await bot.answerCallbackQuery(callbackQuery.id);
        return;
    }

            // Format message
            let message = "🆕 *Recently Added Projects*\n\n";
            
            for (const project of recentProjects) {
                message += `*${project.name}* (${project.symbol})\n`;
                message += `Status: ${formatProjectStatus(project.status)}\n`;
                message += `Submitted: ${new Date(project.submittedAt).toLocaleDateString()}\n`;
                message += `Bulls: ${project.bulls} | Bears: ${project.bears} | Total Votes: ${project.votes}\n\n`;
            }
            
            // Update the message
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: loadingMessage.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "🔙 Back to Browse", callback_data: "browse_projects" }
                        ]
                    ]
                }
            });
            
            await bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
            console.error("Error handling browse_recent callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while processing your request.",
                show_alert: true
            });
        }
        return;
    } else if (data === "browse_roi") {
        try {
            // Send a loading message
            const loadingMessage = await bot.sendMessage(chatId, "📊 Loading highest ROI projects...");
            
            // Get top projects by ROI
            const result = await scoreboardService.getTopProjectsByRating(10);
            
            if (!result.success) {
                await bot.editMessageText(`❌ Error: ${result.message}`, {
                    chat_id: chatId,
                    message_id: loadingMessage.message_id
                });
                await bot.answerCallbackQuery(callbackQuery.id);
                return;
            }
            
            // Generate leaderboard message
            const message = scoreboardService.generateLeaderboardMessage(
                result.projects, 
                "💰 Highest ROI Projects"
            );
            
            // Update the message
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: loadingMessage.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "🔙 Back to Browse", callback_data: "browse_projects" }
                        ]
                    ]
                }
            });
            
            await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
            console.error("Error handling browse_roi callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while processing your request.",
                show_alert: true
            });
        }
        return;
    } else if (data === "browse_trending") {
        try {
            // Send a loading message
            const loadingMessage = await bot.sendMessage(chatId, "📊 Loading trending projects...");
            
            // For trending, we'll use a combination of recent activity and votes
            // This is a simplified implementation - you might want to create a more sophisticated trending algorithm
            const result = await projectService.getAllProjects();
            
            if (!result.success) {
                await bot.editMessageText(`❌ Error: ${result.message}`, {
                    chat_id: chatId,
                    message_id: loadingMessage.message_id
                });
                await bot.answerCallbackQuery(callbackQuery.id);
        return;
    }
    
            // Sort by a combination of recency and votes
            // This is a simple trending algorithm - you might want to improve it
            const trendingProjects = result.projects
                .filter(p => p.votes > 0) // Only include projects with votes
                .sort((a, b) => {
                    // Calculate a trending score based on votes and recency
                    const aAge = (new Date() - new Date(a.submittedAt)) / (1000 * 60 * 60 * 24); // Age in days
                    const bAge = (new Date() - new Date(b.submittedAt)) / (1000 * 60 * 60 * 24); // Age in days
                    
                    const aScore = a.votes / Math.max(1, Math.sqrt(aAge));
                    const bScore = b.votes / Math.max(1, Math.sqrt(bAge));
                    
                    return bScore - aScore;
                })
                .slice(0, 10);
            
            if (trendingProjects.length === 0) {
                await bot.editMessageText("No trending projects found.", {
                    chat_id: chatId,
                    message_id: loadingMessage.message_id
                });
                await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }
        
            // Format message
            let message = "🔥 *Trending Projects*\n\n";
            
            for (const project of trendingProjects) {
                message += `*${project.name}* (${project.symbol})\n`;
                message += `Status: ${formatProjectStatus(project.status)}\n`;
                message += `Bulls: ${project.bulls} | Bears: ${project.bears} | Total Votes: ${project.votes}\n`;
                
                // Add ROI if available
                if (project.roi) {
                    message += `ROI: ${project.roi.toFixed(2)}%\n`;
                }
                
                message += `\n`;
            }
            
            // Update the message
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: loadingMessage.message_id,
                    parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "🔙 Back to Browse", callback_data: "browse_projects" }
                        ]
                    ]
                }
            });
            
            await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
            console.error("Error handling browse_trending callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while processing your request.",
                show_alert: true
            });
        }
        return;
    } else if (data === "wallet_balance") {
        try {
            const userResult = await userService.getUserByTelegramId(userId);
            
            if (!userResult.success || !userResult.user.walletAddress) {
                await bot.sendMessage(chatId, 
                    "❌ No wallet linked. Use `/setwallet YOUR_WALLET` to set up your wallet.", 
                    { parse_mode: "Markdown" }
                );
                await bot.answerCallbackQuery(callbackQuery.id);
                return;
            }

            const walletAddress = userResult.user.walletAddress;
            
            // Send a loading message
            const loadingMessage = await bot.sendMessage(chatId, "💰 Fetching wallet balance...");
            
            try {
                // Get wallet balance
                const balanceResult = await xrplService.getAccountBalance(walletAddress);
                
                if (!balanceResult.success) {
                    await bot.editMessageText(`❌ Error fetching balance: ${balanceResult.message}`, {
                        chat_id: chatId,
                        message_id: loadingMessage.message_id
                    });
                    await bot.answerCallbackQuery(callbackQuery.id);
                    return;
                }
                
                // Format balance message
                let message = `💰 *Wallet Balance*\n\n`;
                message += `*Address:* \`${walletAddress}\`\n\n`;
                message += `*XRP Balance:* ${balanceResult.xrpBalance} XRP\n\n`;
                
                if (balanceResult.tokens && balanceResult.tokens.length > 0) {
                    message += `*Tokens:*\n`;
                    
                    for (const token of balanceResult.tokens) {
                        message += `• ${token.value} ${token.currency}\n`;
                    }
                } else {
                    message += `*Tokens:* None found\n`;
                }
                
                // Update the message
                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: loadingMessage.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "🔙 Back to Wallet", callback_data: "my_wallet" }
                            ]
                        ]
                    }
                });
    } catch (error) {
                console.error("Error fetching wallet balance:", error);
                await bot.editMessageText(`❌ Error fetching wallet balance. Please try again later.`, {
                chat_id: chatId,
                message_id: loadingMessage.message_id
            });
            }
            
            await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
            console.error("Error handling wallet_balance callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while processing your request.",
                show_alert: true
            });
        }
        return;
    } else if (data === "wallet_portfolio") {
        try {
            await bot.sendMessage(chatId, "📈 Portfolio feature coming soon!", {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "🔙 Back to Wallet", callback_data: "my_wallet" }
                        ]
                    ]
                }
            });
            
            await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
            console.error("Error handling wallet_portfolio callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while processing your request.",
                show_alert: true
            });
        }
        return;
    } else if (data === "wallet_history") {
        try {
            await bot.sendMessage(chatId, "🔄 Transaction History feature coming soon!", {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "🔙 Back to Wallet", callback_data: "my_wallet" }
                        ]
                    ]
                }
            });
            
            await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
            console.error("Error handling wallet_history callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while processing your request.",
                show_alert: true
            });
        }
        return;
    } else if (data === "wallet_settings") {
        try {
            const userResult = await userService.getUserByTelegramId(userId);
            
            let message = "⚙️ *Wallet Settings*\n\n";
            
            if (userResult.success && userResult.user.walletAddress) {
                message += `Current wallet: \`${userResult.user.walletAddress}\`\n\n`;
            } else {
                message += "No wallet linked yet.\n\n";
            }
            
            message += "To set a new wallet address, use the command:\n";
            message += "`/setwallet YOUR_WALLET_ADDRESS`";
            
            await bot.sendMessage(chatId, message, {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "🔙 Back to Wallet", callback_data: "my_wallet" }
                        ]
                    ]
                }
            });
            
            await bot.answerCallbackQuery(callbackQuery.id);
                } catch (error) {
            console.error("Error handling wallet_settings callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while processing your request.",
                show_alert: true
            });
        }
        return;
    } else if (data.startsWith('view_project_')) {
        // Handle view project details
        const projectId = data.split('_')[2];
        
        try {
            // Get the project
            const projectResult = await projectService.getProjectById(projectId);
            
            if (!projectResult.success) {
                await bot.answerCallbackQuery(callbackQuery.id, { 
                    text: "❌ Project not found.",
                    show_alert: true
                });
                return;
            }
            
            const project = projectResult.project;
            
            // Generate a detailed report card for the project
            const reportCardMessage = await generateProjectReportCard(project);
            
            // Send the project details
            await bot.sendMessage(chatId, reportCardMessage, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "🐂 Bull", callback_data: `vote_${project._id}_bull` },
                            { text: "🐻 Bear", callback_data: `vote_${project._id}_bear` }
                        ],
                        [
                            { text: "⭐ Grade Project", callback_data: `vote_options_${project._id}` }
                        ]
                    ]
                }
            });
            
            await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
            console.error("Error handling view_project callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while processing your request.",
                show_alert: true
            });
        }
    }
    
    // Handle admin approval actions
    if (data.startsWith('approve_') || data.startsWith('reject_')) {
        // Parse the data
        const parts = data.split('_');
        const action = parts[0]; // 'approve' or 'reject'
        const projectId = parts[1];
        const groupChatId = parts.length > 2 ? parts[2] : null; // Optional group chat ID
        
        try {
            let isAdmin = false;
            
            // Check if user is a group admin (if group chat ID is provided)
            if (groupChatId) {
                const adminCheck = await chatGroupService.isUserChatGroupAdmin(groupChatId, userId);
                isAdmin = adminCheck.success && adminCheck.isAdmin;
            }
            
            // If not a group admin, check if user is a global admin
            if (!isAdmin && config.admins && config.admins.includes(userId.toString())) {
                isAdmin = true;
            }
            
            // If not an admin at all, reject the action
            if (!isAdmin) {
                await bot.answerCallbackQuery(callbackQuery.id, { 
                    text: "🚫 Only admins can approve or reject projects.",
                    show_alert: true
            });
            return;
        }
        
            // Get the project
            const projectResult = await projectService.getProjectById(projectId);
            
            if (!projectResult.success) {
                await bot.answerCallbackQuery(callbackQuery.id, { 
                    text: "❌ Project not found.",
                    show_alert: true
            });
            return;
        }
        
            const project = projectResult.project;
            
            // Update project status
            const newStatus = action === 'approve' ? config.projectStatuses.vetting : config.projectStatuses.rejected;
            
            // Update with the admin who approved/rejected
            const updateResult = await projectService.updateProjectStatus(projectId, newStatus, userId);
            
            if (!updateResult.success) {
                await bot.answerCallbackQuery(callbackQuery.id, { 
                    text: `❌ Error updating project: ${updateResult.message}`,
                    show_alert: true
                });
                return;
            }
            
            // Get user info if available
            const userResult = await userService.getUserByTelegramId(project.submittedBy);
            const submitterUsername = userResult.success ? userResult.user.username : null;
            const submitterFullName = userResult.success ? 
                `${userResult.user.firstName || ''} ${userResult.user.lastName || ''}`.trim() : 'Unknown';
            
            // Get admin info
            const adminResult = await userService.getUserByTelegramId(userId);
            const adminUsername = adminResult.success ? adminResult.user.username : null;
            const adminFullName = adminResult.success ? 
                `${adminResult.user.firstName || ''} ${adminResult.user.lastName || ''}`.trim() : 'Unknown';
            
            // Update the message
            const actionText = action === 'approve' ? 'approved' : 'rejected';
            await bot.editMessageText(`
🔄 <b>Project ${actionText.toUpperCase()}</b>

<b>Name:</b> ${project.name}
<b>Symbol:</b> ${project.symbol}
<b>Contract:</b> <code>${project.contractAddress}</code>
<b>Submitted By:</b> ${submitterFullName}${submitterUsername ? ` (@${submitterUsername})` : ''}
<b>${actionText.charAt(0).toUpperCase() + actionText.slice(1)} By:</b> ${adminFullName}${adminUsername ? ` (@${adminUsername})` : ''}

Status: <b>${actionText.toUpperCase()}</b>
`, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML'
            });
            
            // Skip notifying the submitter privately - everything happens in the group chat
            
            // If the project was submitted in a group chat, notify that chat
            if (project.submittedInChat) {
                try {
                    if (action === 'approve') {
                        // Generate a detailed report card for approved projects
                        const reportCardMessage = await generateProjectReportCard(project);
                        
                        await bot.sendMessage(project.submittedInChat, reportCardMessage + '\n\n🗳️ <b>It is now in the community vetting phase. You can vote and grade this project using the buttons below.</b>', {
                            parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                                        { text: "🐂 Bull", callback_data: `vote_${project._id}_bull` },
                                        { text: "🐻 Bear", callback_data: `vote_${project._id}_bear` }
                        ],
                        [
                                        { text: "⭐ Grade Project", callback_data: `vote_options_${project._id}` }
                        ],
                        [
                                        { text: "📊 View Details", callback_data: `view_project_${project._id}` }
                        ]
                    ]
                }
            });
        } else {
                        // For rejected projects, send a simpler message
                        await bot.sendMessage(project.submittedInChat, `
❌ <b>Project Rejected</b>

<b>Name:</b> ${project.name}
<b>Symbol:</b> ${project.symbol}
<b>Contract:</b> <code>${project.contractAddress}</code>
<b>Submitted By:</b> ${submitterFullName}${submitterUsername ? ` (@${submitterUsername})` : ''}
<b>Rejected By:</b> ${adminFullName}${adminUsername ? ` (@${adminUsername})` : ''}

The project has been rejected by an admin.
`, {
                            parse_mode: 'HTML'
                        });
                    }
                } catch (error) {
                    console.error(`Error notifying group chat ${project.submittedInChat}:`, error);
                }
            }
            
            // If approved, also notify all active chat groups that have notifications enabled
            if (action === 'approve') {
                try {
                    const chatGroupsResult = await chatGroupService.getAllActiveChatGroups();
                    
                    if (chatGroupsResult.success && chatGroupsResult.chatGroups.length > 0) {
                        for (const chatGroup of chatGroupsResult.chatGroups) {
                            // Skip the chat where the project was submitted (already notified above)
                            if (chatGroup.chatId === project.submittedInChat) continue;
                            
                            // Check if notifications are enabled for this chat
                            if (chatGroup.settings && chatGroup.settings.notifyApprovals) {
                                try {
                                    // Generate a detailed report card for the project
                                    const reportCardMessage = await generateProjectReportCard(project);
                                    
                                    await bot.sendMessage(chatGroup.chatId, reportCardMessage + '\n\n🗳️ <b>A new project has been approved and is now available for community voting. You can vote and grade this project using the buttons below.</b>', {
                                        parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                                                    { text: "🐂 Bull", callback_data: `vote_${project._id}_bull` },
                                                    { text: "🐻 Bear", callback_data: `vote_${project._id}_bear` }
                        ],
                        [
                                                    { text: "⭐ Grade Project", callback_data: `vote_options_${project._id}` }
                        ],
                        [
                                                    { text: "📊 View Details", callback_data: `view_project_${project._id}` }
                        ]
                    ]
                }
            });
                                } catch (error) {
                                    console.error(`Error notifying chat group ${chatGroup.chatId}:`, error);
                                }
                            }
                        }
        }
    } catch (error) {
                    console.error("Error notifying chat groups:", error);
                }
            }
            
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: `✅ Project ${actionText} successfully.`,
                show_alert: false
            });
        } catch (error) {
            console.error(`Error handling ${action} action:`, error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: `❌ An error occurred: ${error.message}`,
                show_alert: true
            });
            }
            return;
        }
        
    // Handle vote options
    if (data.startsWith('vote_options_')) {
        try {
            const projectId = data.split('_')[2];
            
            // Get the project
            const projectResult = await projectService.getProjectById(projectId);
            
            if (!projectResult.success) {
                await bot.answerCallbackQuery(callbackQuery.id, { 
                    text: "❌ Project not found.",
                    show_alert: true
                });
                return;
            }
            
            const project = projectResult.project;
            
            // Check if project is in a votable status
            if (project.status !== config.projectStatuses.vetting && project.status !== config.projectStatuses.approved) {
                await bot.answerCallbackQuery(callbackQuery.id, { 
                    text: "❌ This project is not available for voting at this time.",
                    show_alert: true
                });
                return;
            }
            
            // Show voting options
            await bot.sendMessage(chatId, `🗳️ *Voting for ${project.name} (${project.symbol})*\n\nChoose your vote:`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "🐂 Bull", callback_data: `vote_${projectId}_bull` },
                            { text: "🐻 Bear", callback_data: `vote_${projectId}_bear` }
                        ],
                        [
                            { text: "⭐ Grade Project", callback_data: `grade_start_${projectId}` }
                        ]
                    ]
                }
            });
            
            await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
            console.error("Error handling vote_options callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while processing your request.",
                show_alert: true
            });
        }
        return;
    }
    
    // Handle voting
    if (data.startsWith('vote_') && !data.startsWith('vote_options_')) {
        try {
            const parts = data.split('_');
            if (parts.length !== 3) {
                await bot.answerCallbackQuery(callbackQuery.id, { 
                    text: "❌ Invalid vote format.",
                    show_alert: true
                });
                return;
            }
            
            const projectId = parts[1];
            const voteType = parts[2]; // 'bull' or 'bear'
            
            // Cast the vote
            const result = await votingService.castVote(userId, projectId, voteType);
            
            if (!result.success) {
                await bot.answerCallbackQuery(callbackQuery.id, { 
                    text: result.message,
                    show_alert: true
                });
                return;
            }
            
            // Show success message
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: result.message,
                show_alert: true
            });
            
            // If the message contains the project info, update it to show new vote counts
            if (callbackQuery.message && callbackQuery.message.text && 
                callbackQuery.message.text.includes(result.project.name)) {
                try {
                    // Get updated project info
                    const updatedProjectResult = await projectService.getProjectById(projectId);
                    
                    if (updatedProjectResult.success) {
                        const updatedProject = updatedProjectResult.project;
                        
                        // Format the message with updated vote counts
                        let updatedMessage = `🗳️ *Voting for ${updatedProject.name} (${updatedProject.symbol})*\n\n`;
                        updatedMessage += `Bulls: ${updatedProject.bulls} | Bears: ${updatedProject.bears} | Total Votes: ${updatedProject.votes}\n\n`;
                        
                        // Add ratings if available
                        const ratings = updatedProject.getAllAverageRatings();
                        if (parseFloat(ratings.memeBranding) > 0 || parseFloat(ratings.roadmapVision) > 0 || parseFloat(ratings.teamActivity) > 0) {
                            updatedMessage += `*Ratings:*\n`;
                            updatedMessage += `Meme & Branding: ${ratings.memeBranding}/4\n`;
                            updatedMessage += `Roadmap & Vision: ${ratings.roadmapVision}/4\n`;
                            updatedMessage += `Team & Activity: ${ratings.teamActivity}/4\n`;
                        }
                        
                        // Keep the same inline keyboard
                        await bot.editMessageText(updatedMessage, {
                            chat_id: callbackQuery.message.chat.id,
                            message_id: callbackQuery.message.message_id,
                                        parse_mode: 'Markdown',
                            reply_markup: callbackQuery.message.reply_markup
                        });
                    }
                } catch (updateError) {
                    console.error('Error updating message after vote:', updateError);
                }
            }
        } catch (error) {
            console.error("Error handling vote callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while processing your vote.",
                show_alert: true
            });
        }
        return;
    }
    
    // Handle grading start
    if (data.startsWith('grade_start_')) {
        try {
            const projectId = data.split('_')[2];
            console.log(`Starting grading process for project ID: ${projectId}`);
            
            // Get the project
            const projectResult = await projectService.getProjectById(projectId);
            
            if (!projectResult.success) {
                await bot.answerCallbackQuery(callbackQuery.id, { 
                    text: "❌ Project not found.",
                    show_alert: true
                });
                return;
            }
            
            const project = projectResult.project;
            console.log(`Starting grading for project: ${project.name} (${project.symbol})`);
            
            // Start the grading process by asking for the first category rating
            await bot.sendMessage(chatId, 
                getTokenLogoHtml(project.logo) +
                `<b>InnerCircleXRPBOT</b>\n` +
                `🌟 <b>Grading: ${project.name} (${project.symbol})</b>\n\n` +
                `How would you rate this project's <b>Meme Character & Branding</b>?`, 
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "⭐", callback_data: `grade_memeBranding_${project._id}_1` },
                                { text: "⭐⭐", callback_data: `grade_memeBranding_${project._id}_2` },
                                { text: "⭐⭐⭐", callback_data: `grade_memeBranding_${project._id}_3` },
                                { text: "⭐⭐⭐⭐", callback_data: `grade_memeBranding_${project._id}_4` }
                            ]
                        ]
                    }
                }
            );
            
            await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
            console.error("Error handling grade_start callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while starting the grading process.",
                show_alert: true
            });
        }
        return;
    }
    
    // Handle grading
    if (data.startsWith('grade_memeBranding_') || data.startsWith('grade_roadmapVision_') || data.startsWith('grade_teamActivity_')) {
        try {
            const parts = data.split('_');
            if (parts.length !== 4) {
                await bot.answerCallbackQuery(callbackQuery.id, { 
                    text: "❌ Invalid grading format.",
                    show_alert: true
                });
        return;
    }
    
            const category = parts[1]; // 'memeBranding', 'roadmapVision', or 'teamActivity'
            const projectId = parts[2];
            const rating = parseInt(parts[3]); // 1-4
            
            // Get the project
            const projectResult = await projectService.getProjectById(projectId);
            
            if (!projectResult.success) {
                await bot.answerCallbackQuery(callbackQuery.id, { 
                    text: "❌ Project not found.",
                    show_alert: true
                });
                return;
            }
            
            const project = projectResult.project;
            
            // Add the rating
            project.addRating(category, userId, rating);
            await project.save();
            
            // Show success message
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: `✅ You rated ${category === 'memeBranding' ? 'Meme Character & Branding' : category === 'roadmapVision' ? 'Roadmap & Vision' : 'Team & Dev Activity'} as ${rating} stars.`,
                show_alert: true
            });
            
            // If this was the first category, ask for the second
            if (category === 'memeBranding') {
                await bot.sendMessage(chatId, 
                    getTokenLogoHtml(project.logo) +
                    `<b>InnerCircleXRPBOT</b>\n` +
                    `🌟 <b>Grading: ${project.name} (${project.symbol})</b>\n\n` +
                    `How would you rate this project's <b>Roadmap & Vision</b>?`, 
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: "⭐", callback_data: `grade_roadmapVision_${project._id}_1` },
                                    { text: "⭐⭐", callback_data: `grade_roadmapVision_${project._id}_2` },
                                    { text: "⭐⭐⭐", callback_data: `grade_roadmapVision_${project._id}_3` },
                                    { text: "⭐⭐⭐⭐", callback_data: `grade_roadmapVision_${project._id}_4` }
                                ]
                            ]
                        }
                    }
                );
            } 
            // If this was the second category, ask for the third
            else if (category === 'roadmapVision') {
                await bot.sendMessage(chatId, 
                    getTokenLogoHtml(project.logo) +
                    `<b>InnerCircleXRPBOT</b>\n` +
                    `🌟 <b>Grading: ${project.name} (${project.symbol})</b>\n\n` +
                    `How would you rate this project's <b>Team & Dev Activity</b>?`, 
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: "⭐", callback_data: `grade_teamActivity_${project._id}_1` },
                                    { text: "⭐⭐", callback_data: `grade_teamActivity_${project._id}_2` },
                                    { text: "⭐⭐⭐", callback_data: `grade_teamActivity_${project._id}_3` },
                                    { text: "⭐⭐⭐⭐", callback_data: `grade_teamActivity_${project._id}_4` }
                                ]
                            ]
                        }
                    }
                );
            } 
            // If this was the third category, show a summary
            else if (category === 'teamActivity') {
                // Get updated project with all ratings
                const updatedProjectResult = await projectService.getProjectById(projectId);
                
                if (updatedProjectResult.success) {
                    const updatedProject = updatedProjectResult.project;
                    const ratings = updatedProject.getAllAverageRatings();
                    
                    console.log(`Completing grading for project: ${updatedProject.name} (${updatedProject.symbol})`);
                    
                    let summaryMessage = `✅ *Grading Complete!*\n\n`;
                    summaryMessage += `You've successfully graded *${updatedProject.name} (${updatedProject.symbol})*.\n\n`;
                    summaryMessage += `*Your Ratings:*\n`;
                    
                    // Find user's ratings
                    const userMemeBrandingRating = updatedProject.memeBranding.find(r => r.userId === userId)?.rating || 0;
                    const userRoadmapVisionRating = updatedProject.roadmapVision.find(r => r.userId === userId)?.rating || 0;
                    const userTeamActivityRating = updatedProject.teamActivity.find(r => r.userId === userId)?.rating || 0;
                    
                    // For group chats, use HTML format with star emojis
                    if (callbackQuery.message.chat.type === 'group' || callbackQuery.message.chat.type === 'supergroup') {
                        // Create star emoji strings for each rating
                        const memeBrandingStars = '⭐'.repeat(userMemeBrandingRating);
                        const roadmapVisionStars = '⭐'.repeat(userRoadmapVisionRating);
                        const teamActivityStars = '⭐'.repeat(userTeamActivityRating);
                        
                        console.log(`Sending group chat grading completion message for: ${updatedProject.name} (${updatedProject.symbol})`);
                        
                        // Send a formatted HTML message for group chats
                        await bot.sendMessage(chatId, 
                            getTokenLogoHtml(updatedProject.logo) +
                            `<b>InnerCircleXRPBOT</b>\n` +
                            `✅ <b>Grading Complete!</b>\n\n` +
                            `You've successfully graded <b>${updatedProject.name} (${updatedProject.symbol})</b>.\n\n` +
                            `<b>Your Ratings:</b>\n` +
                            `Meme & Branding: ${memeBrandingStars || '0'}/4\n` +
                            `Roadmap & Vision: ${roadmapVisionStars || '0'}/4\n` +
                            `Team & Dev Activity: ${teamActivityStars || '0'}/4\n\n` +
                            `<b>Community Average Ratings:</b>\n` +
                            `Meme & Branding: ${ratings.memeBranding}/4\n` +
                            `Roadmap & Vision: ${ratings.roadmapVision}/4\n` +
                            `Team & Activity: ${ratings.teamActivity}/4\n\n` +
                            `Thank you for contributing to the community vetting process!`,
                            {
                                parse_mode: 'HTML'
                            }
                        );
                        
                        // Don't send the Markdown message for group chats to avoid duplication
                        return;
                    }
                    
                    // For private chats, use HTML format for consistency
                    // Create star emoji strings for each rating
                    const privateMemeBrandingStars = '⭐'.repeat(userMemeBrandingRating);
                    const privateRoadmapVisionStars = '⭐'.repeat(userRoadmapVisionRating);
                    const privateTeamActivityStars = '⭐'.repeat(userTeamActivityRating);
                    
                    // Send HTML message for private chats
                    await bot.sendMessage(chatId, 
                        getTokenLogoHtml(updatedProject.logo) +
                        `<b>InnerCircleXRPBOT</b>\n` +
                        `✅ <b>Grading Complete!</b>\n\n` +
                        `You've successfully graded <b>${updatedProject.name} (${updatedProject.symbol})</b>.\n\n` +
                        `<b>Your Ratings:</b>\n` +
                        `Meme & Branding: ${userMemeBrandingRating}/4 ${privateMemeBrandingStars}\n` +
                        `Roadmap & Vision: ${userRoadmapVisionRating}/4 ${privateRoadmapVisionStars}\n` +
                        `Team & Dev Activity: ${userTeamActivityRating}/4 ${privateTeamActivityStars}\n\n` +
                        `<b>Community Average Ratings:</b>\n` +
                        `Meme & Branding: ${ratings.memeBranding}/4\n` +
                        `Roadmap & Vision: ${ratings.roadmapVision}/4\n` +
                        `Team & Activity: ${ratings.teamActivity}/4\n\n` +
                        `Thank you for contributing to the community vetting process!`,
                        {
                            parse_mode: 'HTML'
                        }
                    );
                }
        }
    } catch (error) {
            console.error("Error handling grade callback:", error);
            await bot.answerCallbackQuery(callbackQuery.id, { 
                text: "❌ An error occurred while processing your rating.",
                show_alert: true
            });
        }
        return;
    }
});

// Helper function to escape text for MarkdownV2
const escapeMarkdownV2 = (text) => {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
};

// Function to notify global admins about new project submissions
const notifyGlobalAdmins = async (message, projectId, chatId = null) => {
    // Send to all admin chat IDs
    if (Array.isArray(config.adminChatId)) {
        for (const adminId of config.adminChatId) {
            try {
                await bot.sendMessage(adminId, message, {
                    parse_mode: 'HTML', // Using HTML instead of Markdown to avoid escaping issues
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "✅ Approve", callback_data: `approve_${projectId}_${chatId}` },
                                { text: "❌ Reject", callback_data: `reject_${projectId}_${chatId}` }
                            ]
                        ]
                    }
                });
            } catch (error) {
                console.error(`Error notifying admin ${adminId}:`, error);
            }
        }
    } else if (config.adminChatId) {
        // Single admin ID
        try {
            await bot.sendMessage(config.adminChatId, message, {
                parse_mode: 'HTML', // Using HTML instead of Markdown to avoid escaping issues
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "✅ Approve", callback_data: `approve_${projectId}_${chatId}` },
                            { text: "❌ Reject", callback_data: `reject_${projectId}_${chatId}` }
                        ]
                    ]
                }
            });
        } catch (error) {
            console.error(`Error notifying admin ${config.adminChatId}:`, error);
        }
    }
};

// Handle incoming messages
bot.on('message', async (msg) => {
    // Skip commands and non-text messages
    if (!msg.text || msg.text.startsWith('/')) {
        return;
    }
    
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    
    // Check if this user is in submission mode
    if (global.pendingSubmissions && global.pendingSubmissions.get(chatId)) {
        // Clear the submission state
        global.pendingSubmissions.delete(chatId);
        
        const contractAddress = msg.text.trim();
        
        // Send a "processing" message
        const processingMsg = await bot.sendMessage(chatId, "⏳ Processing your submission...");
        
        // Pass the chat ID to track where the project was submitted
        const result = await projectService.submitProject(contractAddress, userId, chatId);
        
        // Edit the processing message with the result
        await bot.editMessageText(result.message, {
            chat_id: chatId,
            message_id: processingMsg.message_id,
            parse_mode: 'Markdown'
        });
        
        // If submission was successful, notify admins
        if (result.success) {
            // Send a GIF or image about community voting
            await bot.sendAnimation(chatId, 'https://media.giphy.com/media/3oEjHV0z8S7WM4MwnK/giphy.gif', {
                caption: "🗳️ <b>Community Grading System</b>\n\nOnce approved by admins, projects are graded by the community on a 1-4 star scale in three categories:\n\n" +
                        "⭐ <b>Meme Character & Branding</b>\n" +
                        "⭐ <b>Roadmap & Vision</b>\n" +
                        "⭐ <b>Team & Dev Activity</b>\n\n" +
                        "Your submission will be reviewed by admins shortly.",
                parse_mode: 'HTML'
            });
            
            const project = result.project;
            
            // Get user info if available
            const userResult = await userService.getUserByTelegramId(userId);
            const username = userResult.success ? userResult.user.username : 'Unknown';
            const userFullName = userResult.success ? 
                `${userResult.user.firstName || ''} ${userResult.user.lastName || ''}`.trim() : 'Unknown';
            
            // Create admin notification message
            const adminMessage = `
🆕 <b>New Project Submission</b>

<b>Name:</b> ${project.name}
<b>Symbol:</b> ${project.symbol}
<b>Contract:</b> <code>${project.contractAddress}</code>
<b>Submitted By:</b> ${userFullName}${username ? ` (@${username})` : ''}

Please review this submission and approve or reject it.
`;
            
            // If submitted in a group chat, notify the group admins
            if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
                // Get group admins
                const adminsResult = await chatGroupService.getChatGroupAdmins(chatId);
                
                if (adminsResult.success && adminsResult.admins.length > 0) {
                    // Send notification to each admin via private message
                    for (const admin of adminsResult.admins) {
                        try {
                            await bot.sendMessage(admin.telegramId, 
                                `${adminMessage}\n<b>Group:</b> ${msg.chat.title}`, 
                                {
                                    parse_mode: 'HTML',
                                    reply_markup: {
                                        inline_keyboard: [
                                            [
                                                { text: "✅ Approve", callback_data: `approve_${project._id}_${chatId}` },
                                                { text: "❌ Reject", callback_data: `reject_${project._id}_${chatId}` }
                                            ]
                                        ]
                                    }
                                }
                            );
                        } catch (error) {
                            console.error(`Error notifying admin ${admin.telegramId}:`, error);
                        }
                    }
                    
                    // Send notification in the group chat
                    await sendProjectSubmissionToGroupChat(chatId, project, msg.from);
                } else {
                    // If no group admins found, notify the global admins as fallback
                    await notifyGlobalAdmins(adminMessage, project._id, chatId);
                }
            } else {
                // If submitted in private chat, notify global admins
                await notifyGlobalAdmins(adminMessage, project._id, chatId);
            }
            
            // Increment user's projects submitted count
            await userService.incrementProjectsSubmitted(userId);
        }
    } else {
        // Check if the message looks like a token address (for direct token lookup)
        const text = msg.text.trim();
        
        // Check if it's in the format of a contract address or currency.issuer
        // Only process XRPL addresses starting with 'r'
        const isContractAddress = text.startsWith('r') && xrplService.isValidXRPLAddress(text);
        const isCurrencyIssuer = text.includes('.') && text.split('.').length === 2 && 
                               text.split('.')[1].startsWith('r');
        
        if (isContractAddress || isCurrencyIssuer) {
            // Send a "processing" message
            const processingMsg = await bot.sendMessage(chatId, "🔍 Looking up token information...");
            
            try {
                let currency, issuer;
                
                if (isCurrencyIssuer) {
                    // Format: CURRENCY.ISSUER
                    const parts = text.split('.');
                    currency = parts[0];
                    issuer = parts[1];
                } else {
                    // Format: Just the issuer address
                    issuer = text;
                    
                    // First try to get issued tokens to find the currency
                    const issuedTokensResult = await tokenInfoService.getIssuedTokens(issuer);
                    
                    if (issuedTokensResult.success && issuedTokensResult.data.tokens && issuedTokensResult.data.tokens.length > 0) {
                        // Use the first token's currency
                        currency = issuedTokensResult.data.tokens[0].currency;
                        console.log(`Found currency ${currency} for issuer ${issuer}`);
                    } else {
                        // If no issued tokens found, try to get the currency from the token service
                        const tokenData = await tokenService.getTokenByAddress(text);
                        currency = tokenData?.symbol || 'UNKNOWN';
                    }
                }
                
                // Get token information
                const result = await tokenInfoService.getTokenInformation(currency, issuer);
                
                // Delete the processing message
                await bot.deleteMessage(chatId, processingMsg.message_id);
                
                if (result && result.success) {
            // Format the token description
                    const formattedDescription = tokenInfoService.formatTokenDescription(result);
            
                    // Check if this token has already been submitted to the system
                    const existingProject = await projectService.getProjectByContractAddress(issuer);
                    const tokenExists = existingProject && existingProject.success;
            
                    // Prepare inline keyboard with voting buttons
                    const inlineKeyboard = [];
                    
                // Add voting buttons
                    inlineKeyboard.push([
                    { text: "👍 Upvote", callback_data: `upv:${currency.substring(0, 8)}:${issuer.substring(0, 8)}` },
                    { text: "👎 Downvote", callback_data: `dwv:${currency.substring(0, 8)}:${issuer.substring(0, 8)}` }
                    ]);
                    
                    // Add submission or grading button based on whether the token exists
                    if (tokenExists) {
                        inlineKeyboard.push([
                            { text: "⭐ Grade this token", callback_data: `grade_start_${existingProject.project._id}` }
                        ]);
                    } else {
                        inlineKeyboard.push([
                            { text: "📝 Submit to Inner Circle", callback_data: `submit_${issuer}` }
                        ]);
                    }
                    
                    // Add chart link if available
                    let chartUrl = null;
                    if (result.data && result.data.dexScreenerData && result.data.dexScreenerData.chartUrl) {
                        chartUrl = result.data.dexScreenerData.chartUrl;
                    } else if (tokenExists && existingProject.project.chartUrl) {
                        chartUrl = existingProject.project.chartUrl;
                    } else if (result.data && result.data.meta && result.data.meta.chartUrl) {
                        chartUrl = result.data.meta.chartUrl;
                    }
                    
                    if (chartUrl) {
                        inlineKeyboard.push([
                            { text: "📈 View Chart", url: chartUrl }
                        ]);
                    }
                    
                    // Get the image URL from the result
                    const imageUrl = result.imageUrl;
                    console.log(`Token image URL: ${imageUrl}`);
                    
                    // Log more details about the result object
                    console.log('Token result data structure:');
                    console.log('- Has meta data:', result.data && result.data.meta ? 'Yes' : 'No');
                    if (result.data && result.data.meta) {
                        console.log('- Meta logo:', result.data.meta.logo);
                        console.log('- Meta token logo:', result.data.meta.token?.logo);
                    }
                    console.log('- Has dexScreenerData:', result.data && result.data.dexScreenerData ? 'Yes' : 'No');
                    if (result.data && result.data.dexScreenerData) {
                        console.log('- DexScreener logo:', result.data.dexScreenerData.logo);
                    }
                    
                    // Try to send the token information with image
                    try {
                        if (imageUrl) {
                            // Try to send as photo with caption
                            try {
                                console.log(`Attempting to send photo with URL: ${imageUrl}`);
                                await bot.sendPhoto(chatId, imageUrl, {
                                    caption: formattedDescription,
                                    parse_mode: 'Markdown',
                                    reply_markup: {
                                        inline_keyboard: inlineKeyboard
                                    }
                                });
                                console.log('Successfully sent token image with caption');
                            } catch (photoError) {
                                console.error('Error sending token image as photo:', photoError.message);
                                console.error('Error details:', JSON.stringify(photoError, null, 2));
                                
                                // Try with fallback image URL if available
                                try {
                                    if (result.data && result.data.meta) {
                                        const fallbackUrl = `https://api.xrplmeta.org/icon/${currency}.${issuer}`;
                                        console.log(`Trying fallback image URL: ${fallbackUrl}`);
                                        
                                        await bot.sendPhoto(chatId, fallbackUrl, {
                        caption: formattedDescription,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: inlineKeyboard
                                            }
                                        });
                                        console.log('Successfully sent token image with fallback URL');
                                        return; // Exit if successful
                                    }
                                } catch (fallbackError) {
                                    console.error('Error with fallback image URL:', fallbackError.message);
                                }
                                
                                // Fallback to text message
                                console.log('Falling back to text message without image');
                                await bot.sendMessage(chatId, formattedDescription, {
                            parse_mode: 'Markdown',
                                    reply_markup: {
                                        inline_keyboard: inlineKeyboard
                                    },
                                    disable_web_page_preview: true
                        });
                    }
                } else {
                            // Send as regular text message
                            await bot.sendMessage(chatId, formattedDescription, {
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    inline_keyboard: inlineKeyboard
                                },
                                disable_web_page_preview: true
                            });
                        }
                    } catch (error) {
                        console.error('Error sending token information:', error);
                        // Final fallback
                await bot.sendMessage(chatId, formattedDescription, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: inlineKeyboard
                    },
                    disable_web_page_preview: true
                });
            }
                } else {
                    // If token lookup failed, check if it's a valid XRPL address
                    if (isContractAddress) {
                        // It's a valid address but we couldn't get token info
                        await bot.editMessageText("✅ Valid XRPL address detected. Would you like to submit this token to Inner Circle?", {
                            chat_id: chatId,
                            message_id: processingMsg.message_id,
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: "📝 Submit Token", callback_data: `submit_${text}` }
                                    ]
                                ]
                            }
                        });
                    } else {
                        // Not a valid token format
                        await bot.editMessageText("❌ Invalid token format or token not found. Please use the format CURRENCY.ISSUER or provide a valid XRPL address.", {
                            chat_id: chatId,
                            message_id: processingMsg.message_id
                        });
                    }
                }
            } catch (error) {
                console.error("Error processing token lookup:", error);
                await bot.editMessageText("❌ Error processing token lookup. Please try again later.", {
                    chat_id: chatId,
                    message_id: processingMsg.message_id
                });
            }
        }
    }
});

// 📌 Command to add an admin to the group
bot.onText(/\/addadmin(@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Check if this is a group chat
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
        return bot.sendMessage(chatId, "❌ This command can only be used in group chats.");
    }
    
    // Check if the user is already an admin
    const adminCheck = await chatGroupService.isUserChatGroupAdmin(chatId, userId);
    
    if (!adminCheck.success || !adminCheck.isAdmin) {
        return bot.sendMessage(chatId, "❌ Only existing admins can add new admins.");
    }
    
    // Get the username or user ID to add
    const usernameOrId = match[2] ? match[2].trim() : null;
    
    if (!usernameOrId) {
        return bot.sendMessage(chatId, 
            "❌ Please specify a username or user ID to add as admin.\n\n" +
            "Example: `/addadmin @username` or `/addadmin 123456789`", 
            { parse_mode: 'Markdown' }
        );
    }
    
    try {
        // Check if it's a username or user ID
        let adminData;
        
        if (usernameOrId.startsWith('@')) {
            // It's a username, we need to find the user
            const username = usernameOrId.substring(1); // Remove the @ symbol
            
            // Try to find the user in the chat members
            try {
                const chatMember = await bot.getChatMember(chatId, username);
                adminData = chatMember.user;
            } catch (error) {
                return bot.sendMessage(chatId, 
                    `❌ Could not find user with username ${usernameOrId} in this chat. Make sure they have sent at least one message in the chat.`
                );
            }
        } else {
            // It's a user ID, try to get the user info
            try {
                const chatMember = await bot.getChatMember(chatId, usernameOrId);
                adminData = chatMember.user;
            } catch (error) {
                return bot.sendMessage(chatId, 
                    `❌ Could not find user with ID ${usernameOrId} in this chat. Make sure they have sent at least one message in the chat.`
                );
            }
        }
        
        // Add the admin to the chat group
        const result = await chatGroupService.addChatGroupAdmin(chatId, adminData, userId);
        
        if (result.success) {
            return bot.sendMessage(chatId, 
                `✅ Successfully added ${adminData.first_name}${adminData.username ? ` (@${adminData.username})` : ''} as an admin of this chat.`
            );
        } else {
            return bot.sendMessage(chatId, `❌ ${result.message}`);
        }
    } catch (error) {
        console.error("Error adding admin:", error);
        return bot.sendMessage(chatId, `❌ An error occurred: ${error.message}`);
    }
});

// 📌 Command to remove an admin from the group
bot.onText(/\/removeadmin(@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Check if this is a group chat
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
        return bot.sendMessage(chatId, "❌ This command can only be used in group chats.");
    }
    
    // Check if the user is already an admin
    const adminCheck = await chatGroupService.isUserChatGroupAdmin(chatId, userId);
    
    if (!adminCheck.success || !adminCheck.isAdmin) {
        return bot.sendMessage(chatId, "❌ Only existing admins can remove admins.");
    }
    
    // Get the username or user ID to remove
    const usernameOrId = match[2] ? match[2].trim() : null;
    
    if (!usernameOrId) {
        return bot.sendMessage(chatId, 
            "❌ Please specify a username or user ID to remove as admin.\n\n" +
            "Example: `/removeadmin @username` or `/removeadmin 123456789`", 
            { parse_mode: 'Markdown' }
        );
    }
    
    try {
        // Get all admins of the chat group
        const adminsResult = await chatGroupService.getChatGroupAdmins(chatId);
        
        if (!adminsResult.success) {
            return bot.sendMessage(chatId, `❌ ${adminsResult.message}`);
        }
        
        // Find the admin to remove
        let adminToRemove = null;
        
        if (usernameOrId.startsWith('@')) {
            // It's a username, find the admin by username
            const username = usernameOrId.substring(1); // Remove the @ symbol
            adminToRemove = adminsResult.admins.find(admin => admin.username === username);
        } else {
            // It's a user ID, find the admin by ID
            adminToRemove = adminsResult.admins.find(admin => admin.telegramId === usernameOrId);
        }
        
        if (!adminToRemove) {
            return bot.sendMessage(chatId, `❌ Could not find admin with ${usernameOrId.startsWith('@') ? 'username' : 'ID'} ${usernameOrId}.`);
        }
        
        // Remove the admin from the chat group
        const result = await chatGroupService.removeChatGroupAdmin(chatId, adminToRemove.telegramId, userId);
        
        if (result.success) {
            return bot.sendMessage(chatId, 
                `✅ Successfully removed ${adminToRemove.firstName || ''}${adminToRemove.username ? ` (@${adminToRemove.username})` : ''} as an admin of this chat.`
            );
        } else {
            return bot.sendMessage(chatId, `❌ ${result.message}`);
        }
    } catch (error) {
        console.error("Error removing admin:", error);
        return bot.sendMessage(chatId, `❌ An error occurred: ${error.message}`);
    }
});

// 📌 Command to list admins of the group
bot.onText(/\/admins(@\w+)?/, async (msg) => {
    const chatId = msg.chat.id;
    
    // Check if this is a group chat
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
        return bot.sendMessage(chatId, "❌ This command can only be used in group chats.");
    }
    
    try {
        // Get all admins of the chat group
        const adminsResult = await chatGroupService.getChatGroupAdmins(chatId);
        
        if (!adminsResult.success) {
            return bot.sendMessage(chatId, `❌ ${adminsResult.message}`);
        }
        
        if (adminsResult.admins.length === 0 && !adminsResult.creatorId) {
            return bot.sendMessage(chatId, "❌ No admins found for this chat.");
        }
        
        let message = "👑 *Admins of this chat:*\n\n";
        
        // Add the creator if available
        if (adminsResult.creatorId) {
            try {
                const creatorResult = await userService.getUserByTelegramId(adminsResult.creatorId);
                
                if (creatorResult.success) {
                    const creator = creatorResult.user;
                    message += `👑 *Creator:* ${creator.firstName || ''}${creator.lastName ? ` ${creator.lastName}` : ''}${creator.username ? ` (@${creator.username})` : ''}\n\n`;
                } else {
                    message += `👑 *Creator:* ID ${adminsResult.creatorId}\n\n`;
        }
    } catch (error) {
                message += `👑 *Creator:* ID ${adminsResult.creatorId}\n\n`;
            }
        }
        
        // Add all other admins
        if (adminsResult.admins.length > 0) {
            message += "*Admins:*\n";
            
            for (const admin of adminsResult.admins) {
                message += `👤 ${admin.firstName || ''}${admin.lastName ? ` ${admin.lastName}` : ''}${admin.username ? ` (@${admin.username})` : ''}\n`;
            }
        }
        
        return bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error("Error listing admins:", error);
        return bot.sendMessage(chatId, `❌ An error occurred: ${error.message}`);
    }
});

// 📌 Handle new chat members (including the bot itself)
bot.on('new_chat_members', async (msg) => {
    const chatId = msg.chat.id;
    const newMembers = msg.new_chat_members;
    
    // Check if the bot was added to a new chat
    const botInfo = await bot.getMe();
    const botWasAdded = newMembers.some(member => member.id === botInfo.id);
    
    if (botWasAdded) {
        // Bot was added to a new chat, create a chat group entry
        try {
            // The user who added the bot is the creator
            const creatorId = msg.from.id;
            
            // Create the chat group
            const result = await chatGroupService.createOrUpdateChatGroup({
                id: chatId,
                title: msg.chat.title,
                type: msg.chat.type
            }, creatorId);
            
            if (result.success) {
                // Send a welcome message
                await bot.sendMessage(chatId, 
                    `👋 *Hello!* I'm Inner Circle Bot, your assistant for token submissions and community voting.\n\n` +
                    `The user who added me (@${msg.from.username || msg.from.id}) is now the admin of this chat for bot operations.\n\n` +
                    `Admins can use the following commands:\n` +
                    `• /addadmin @username - Add a new admin\n` +
                    `• /removeadmin @username - Remove an admin\n` +
                    `• /admins - List all admins\n\n` +
                    `Users can submit tokens using:\n` +
                    `• /submit CONTRACT_ADDRESS - Submit a token for review\n\n` +
                    `Use /help to see all available commands.`,
                    { parse_mode: 'Markdown' }
                );
            }
    } catch (error) {
            console.error("Error handling bot added to chat:", error);
        }
    }
});

// 📌 Help command
bot.onText(/\/help(@\w+)?/, async (msg) => {
    const chatId = msg.chat.id;
    const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
    
    // Check if the user is an admin (for group chats)
    let isAdmin = false;
    
    if (isGroup) {
        const adminCheck = await chatGroupService.isUserChatGroupAdmin(chatId, msg.from.id);
        isAdmin = adminCheck.success && adminCheck.isAdmin;
    }
    
    // Basic commands for all users
    let helpMessage = `
🤖 *Inner Circle Bot Help*

*Basic Commands:*
• /start \\- Start the bot and see the main menu
• /help \\- Show this help message
• /submit CONTRACT\\_ADDRESS \\- Submit a token for review
• /lookup CONTRACT\\_ADDRESS \\- Look up information about a token
• /vetting \\- View tokens in the vetting phase
• /leaderboards \\- View project and user leaderboards
• /setwallet ADDRESS \\- Set your XRPL wallet address

`;

    // Add admin commands for group admins
    if (isGroup) {
        helpMessage += `
*Group Admin Commands:*
• /addadmin @username \\- Add a new admin to this group
• /removeadmin @username \\- Remove an admin from this group
• /admins \\- List all admins of this group
• /register\\_chat \\- Force register this chat group with the bot

`;
    }
    
    // Add global admin commands for global admins
    if (config.admins && config.admins.includes(msg.from.id.toString())) {
        helpMessage += `
*Global Admin Commands:*
• /pending \\- View pending token submissions
• /approve PROJECT\\_ID \\- Approve a pending token
• /reject PROJECT\\_ID \\- Reject a pending token
• /broadcast MESSAGE \\- Send a message to all active chats

`;
    }
    
    helpMessage += `
For more information, visit our website or contact @admin\\_username\\.
`;
    
    await bot.sendMessage(chatId, helpMessage, { parse_mode: 'MarkdownV2' });
});

// 📌 Force register chat group command
bot.onText(/\/register_chat/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Only allow in group chats
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
        await bot.sendMessage(chatId, "❌ This command can only be used in group chats.");
        return;
    }
    
    try {
        // Create or update the chat group
        const result = await chatGroupService.createOrUpdateChatGroup({
            id: chatId,
            title: msg.chat.title,
            type: msg.chat.type
        }, userId);
        
        if (result.success) {
            await bot.sendMessage(chatId, 
                `✅ Chat group successfully ${result.isNew ? 'registered' : 'updated'}!\n\n` +
                `Title: ${result.chatGroup.title}\n` +
                `Type: ${result.chatGroup.type}\n` +
                `Creator: ${userId}\n\n` +
                `The user who ran this command (${msg.from.username ? '@' + msg.from.username : userId}) is now the admin of this chat for bot operations.`,
                { parse_mode: 'HTML' }
            );
        } else {
            await bot.sendMessage(chatId, `❌ Error: ${result.message}`);
        }
    } catch (error) {
        console.error("Error registering chat group:", error);
        await bot.sendMessage(chatId, "❌ An error occurred while registering the chat group. Please try again later.");
    }
});

// Start the bot
console.log('Bot is running...');

// Helper function to send project submission to group chat
const sendProjectSubmissionToGroupChat = async (chatId, project, submitter) => {
    try {
        const firstName = submitter.first_name || '';
        const username = submitter.username ? ` (@${submitter.username})` : '';
        
        await bot.sendMessage(chatId, 
            `${getTokenLogoHtml(project.logo)}
<b>NEW PROJECT SUBMISSION</b>

<b>Name:</b> ${project.name}
<b>Symbol:</b> ${project.symbol}
<b>Contract:</b> <code>${project.contractAddress}</code>
<b>Submitted By:</b> ${firstName}${username}
<b>Submitted At:</b> ${new Date().toLocaleString()}

This submission is pending admin approval. Group admins can approve or reject using the buttons below.`,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "✅ Approve", callback_data: `approve_${project._id}_${chatId}` },
                            { text: "❌ Reject", callback_data: `reject_${project._id}_${chatId}` }
                        ]
                    ]
                }
            }
        );
    } catch (error) {
        console.error(`Error sending project submission to group chat ${chatId}:`, error);
    }
};

// Helper function to generate a detailed project report card
const generateProjectReportCard = async (project) => {
    try {
        // Get submitter info
        const userResult = await userService.getUserByTelegramId(project.submittedBy);
        const submitterUsername = userResult.success ? userResult.user.username : null;
        const submitterFullName = userResult.success ? 
            `${userResult.user.firstName || ''} ${userResult.user.lastName || ''}`.trim() : 'Unknown';
        
        // Get approver info if available
        let approverInfo = '';
        if (project.approvedBy) {
            const adminResult = await userService.getUserByTelegramId(project.approvedBy);
            const adminUsername = adminResult.success ? adminResult.user.username : null;
            const adminFullName = adminResult.success ? 
                `${adminResult.user.firstName || ''} ${adminResult.user.lastName || ''}`.trim() : 'Unknown';
            
            approverInfo = `<b>Approved By:</b> ${adminFullName}${adminUsername ? ` (@${adminUsername})` : ''}\n`;
        }
        
        // Calculate average ratings
        const overallRating = project.getAverageRating ? project.getAverageRating('overall') : 0;
        const memeBrandingRating = project.getAverageRating ? project.getAverageRating('memeBranding') : 0;
        const roadmapVisionRating = project.getAverageRating ? project.getAverageRating('roadmapVision') : 0;
        const teamActivityRating = project.getAverageRating ? project.getAverageRating('teamActivity') : 0;
        
        // Format market data
        const marketCap = project.marketCap ? `$${project.marketCap.toLocaleString()}` : '$0';
        const liquidity = project.liquidity ? `$${project.liquidity.toLocaleString()}` : '$0';
        const roi = project.roi ? `${project.roi.toFixed(2)}%` : 'N/A';
        
        // Format dates
        const submittedAt = project.submittedAt ? new Date(project.submittedAt).toLocaleString() : 'Unknown';
        const approvedAt = project.approvedAt ? new Date(project.approvedAt).toLocaleString() : 'N/A';
        
        // Generate the report card
        return `${getTokenLogoHtml(project.logo)}
📊 <b>PROJECT REPORT CARD</b>

<b>Name:</b> ${project.name}
<b>Symbol:</b> ${project.symbol}
<b>Contract:</b> <code>${project.contractAddress}</code>
<b>Status:</b> <b>${project.status.toUpperCase()}</b>
<b>Submitted By:</b> ${submitterFullName}${submitterUsername ? ` (@${submitterUsername})` : ''}
${approverInfo}
<b>Submitted At:</b> ${submittedAt}
<b>Approved At:</b> ${approvedAt}

<b>Community Ratings:</b>
⭐ Overall: ${overallRating.toFixed(1)}/4
⭐ Meme & Branding: ${memeBrandingRating.toFixed(1)}/4
⭐ Roadmap & Vision: ${roadmapVisionRating.toFixed(1)}/4
⭐ Team & Activity: ${teamActivityRating.toFixed(1)}/4

<b>Votes:</b>
🐂 Bulls: ${project.bulls || 0}
🐻 Bears: ${project.bears || 0}
📊 Total: ${project.votes || 0}

<b>Market Data:</b>
💰 Market Cap: ${marketCap}
💧 Liquidity: ${liquidity}
📈 ROI: ${roi}
`;
    } catch (error) {
        console.error("Error generating project report card:", error);
        return `Error generating project report card: ${error.message}`;
    }
};

// Helper function to get token logo display for HTML messages
const getTokenLogoHtml = (logoUrl) => {
    if (!logoUrl) return '';
    // Use a camera emoji as visible element for the link to make sure it always displays
    return `<a href="${logoUrl}"><b>🖼️</b></a> `;
};

// Helper function to get token logo display for Markdown messages
const getTokenLogoMarkdown = (logoUrl) => {
    if (!logoUrl) return '';
    // Use a double zero-width space to ensure image preview works
    return `[‎‎](${logoUrl})`;
};

// Debug command to show token data sources
bot.onText(/\/tokeninfo (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const contractAddress = match[1];
    
    await bot.sendMessage(chatId, `🔍 Fetching token data for ${contractAddress}...`);
    
    try {
        // Get token data using fallback mechanism
        const tokenService = require('./services/tokenService');
        const tokenData = await tokenService.getTokenByAddressWithFallback(contractAddress);
        
        if (!tokenData) {
            return bot.sendMessage(chatId, "❌ No token data found for this address.");
        }
        
        // Create debug info message
        let debugInfo = `✅ *Token Data Source Information*\n\n`;
        debugInfo += `*Address:* \`${contractAddress}\`\n`;
        debugInfo += `*Name:* ${tokenData.name}\n`;
        debugInfo += `*Symbol:* ${tokenData.symbol}\n`;
        debugInfo += `*Source:* ${tokenData.source || 'Unknown'}\n\n`;
        
        if (tokenData.source === 'dexscreener') {
            debugInfo += `✅ *Using DexScreener Data*\n`;
        } else if (tokenData.source === 'xrpldex') {
            debugInfo += `*Using XRPL DEX Data*\n`;
        } else if (tokenData.source === 'xpmarket') {
            debugInfo += `*Using XPMarket Data*\n`;
        }
        
        // Logo information
        debugInfo += `\n*Logo URL:* ${tokenData.logo || 'None'}\n`;
        
        // Send debug information
        await bot.sendMessage(chatId, debugInfo, { parse_mode: 'Markdown' });
        
        // Try to send the actual token image separately
        if (tokenData.logo) {
            await bot.sendMessage(chatId, getTokenLogoMarkdown(tokenData.logo), { parse_mode: 'Markdown' });
        }
        
        // Send formatted token information
        const tokenMessage = tokenService.formatTokenForTelegram(tokenData);
        await bot.sendMessage(chatId, tokenMessage, { parse_mode: 'Markdown' });
        
    } catch (error) {
        console.error('Error in token debug command:', error);
        await bot.sendMessage(chatId, `❌ Error fetching token data: ${error.message}`);
    }
});

// Debug command to show latest tokens and their sources
bot.onText(/\/sourcestats/, async (msg) => {
    const chatId = msg.chat.id;
    
    await bot.sendMessage(chatId, "📊 Gathering token source statistics...");
    
    try {
        // Get token data using fallback mechanism
        const tokenService = require('./services/tokenService');
        const tokens = await tokenService.getNewPairsWithFallback();
        
        if (!tokens || tokens.length === 0) {
            return bot.sendMessage(chatId, "❌ No token data found.");
        }
        
        // Count sources
        const sources = {
            dexscreener: 0,
            xrpldex: 0,
            xpmarket: 0,
            unknown: 0
        };
        
        let hasLogo = 0;
        
        tokens.forEach(token => {
            if (!token.source) {
                sources.unknown++;
            } else {
                sources[token.source] = (sources[token.source] || 0) + 1;
            }
            
            if (token.logo) {
                hasLogo++;
            }
        });
        
        // Create stats message
        let statsMessage = `📊 *Token Source Statistics*\n\n`;
        statsMessage += `*Total tokens analyzed:* ${tokens.length}\n\n`;
        statsMessage += `*Source Breakdown:*\n`;
        statsMessage += `- DexScreener: ${sources.dexscreener} tokens (${Math.round(sources.dexscreener/tokens.length*100)}%)\n`;
        statsMessage += `- XRPL DEX: ${sources.xrpldex} tokens (${Math.round(sources.xrpldex/tokens.length*100)}%)\n`;
        statsMessage += `- XPMarket: ${sources.xpmarket} tokens (${Math.round(sources.xpmarket/tokens.length*100)}%)\n`;
        statsMessage += `- Unknown: ${sources.unknown} tokens (${Math.round(sources.unknown/tokens.length*100)}%)\n\n`;
        statsMessage += `*Tokens with logos:* ${hasLogo} (${Math.round(hasLogo/tokens.length*100)}%)\n\n`;
        
        // Show sample tokens from each source
        if (sources.dexscreener > 0) {
            const dexSample = tokens.find(t => t.source === 'dexscreener');
            if (dexSample) {
                statsMessage += `*Sample DexScreener Token:*\n`;
                statsMessage += `${dexSample.name} (${dexSample.symbol})\n`;
                statsMessage += `Logo: ${dexSample.logo ? 'Yes' : 'No'}\n\n`;
            }
        }
        
        // Send the stats
        await bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
        
    } catch (error) {
        console.error('Error in source stats command:', error);
        await bot.sendMessage(chatId, `❌ Error gathering statistics: ${error.message}`);
    }
});