const config = require('../config');
const tokenInfoService = require('../services/tokenInfoService');
const xrplService = require('../services/xrplService');
const xrplMetaService = require('../services/xrplMetaService');
const tokenDiscoveryService = require('../services/tokenDiscoveryService');
const axios = require('axios');
const imageUtils = require('../utils/imageUtils');

// Global variables for tracking social input state
global.pendingSocialInputs = {};
global.pendingWalletInputs = {};

// Global reference to the bot instance
let bot;

/**
 * Initialize the commands with the bot instance
 */
const initializeCommands = (botInstance) => {
    bot = botInstance;
};

/**
 * Handle the /scan command to get token information
 */
const handleScanCommand = async (msg) => {
    try {
        const args = msg.text.split(' ');
        if (args.length !== 2) {
            return bot.sendMessage(msg.chat.id, 'Please provide a contract address.\nUsage: /scan <contract_address>', {
                reply_to_message_id: msg.message_id
            });
        }

        const contractAddress = args[1];
        
        // Send loading message
        const loadingMsg = await bot.sendMessage(msg.chat.id, '🔄 Fetching token analysis...', {
            reply_to_message_id: msg.message_id
        });
        
        // Get XRPL token information using our own services instead of Rick
        const parts = contractAddress.split('.');
        if (parts.length === 2) {
            const currency = parts[0];
            const issuer = parts[1];
            
            // Use our own token service
            const result = await tokenInfoService.getTokenInformation(currency, issuer);
            
            // Delete loading message
        await bot.deleteMessage(msg.chat.id, loadingMsg.message_id);
            
            if (typeof result === 'object' && result.text) {
                // Prepare inline keyboard with voting buttons
                const inlineKeyboard = [];
                
                // Add voting buttons
                inlineKeyboard.push([
                    { text: "👍 Upvote", callback_data: `upv:${currency.substring(0, 8)}:${issuer.substring(0, 8)}` },
                    { text: "👎 Downvote", callback_data: `dwv:${currency.substring(0, 8)}:${issuer.substring(0, 8)}` }
                ]);
                
                // Add admin approval button for admins
                const chatAdmins = await bot.getChatAdministrators(msg.chat.id);
                const isAdmin = chatAdmins.some(admin => admin.user.id === msg.from.id);
                if (isAdmin) {
                inlineKeyboard.push([
                    { text: "✅ Approve for Community", callback_data: `apv:${currency.substring(0, 8)}:${issuer.substring(0, 8)}` }
                ]);
                }
                
                // Try to send image first, then the text with buttons
                try {
                    await bot.sendPhoto(msg.chat.id, result.imageUrl, {
                        reply_to_message_id: msg.message_id,
                        parse_mode: 'Markdown'
                    });
                } catch (imageError) {
                    console.error('Error sending token image:', imageError);
                    // Continue even if image fails
                }
                
                // Send the text analysis
                await bot.sendMessage(msg.chat.id, result.text, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: inlineKeyboard
                    },
                    disable_web_page_preview: true
                });
            } else {
                await bot.sendMessage(msg.chat.id, `❌ Error retrieving token information: ${result.message}`, {
                    reply_to_message_id: msg.message_id
                });
            }
        } else {
            // Delete loading message
        await bot.deleteMessage(msg.chat.id, loadingMsg.message_id);
            await bot.sendMessage(msg.chat.id, '❌ Invalid token format. Please use the format: CURRENCY.ISSUER', {
                reply_to_message_id: msg.message_id
            });
        }
    } catch (error) {
        console.error('Error in scan command:', error);
        await bot.sendMessage(msg.chat.id, '❌ Error generating token analysis. Please try again later.', {
            reply_to_message_id: msg.message_id
        });
    }
};

/**
 * Handle the /social command to get token social information
 */
const handleSocialCommand = async (msg) => {
    try {
        const args = msg.text.split(' ');
        if (args.length !== 2) {
            return bot.sendMessage(msg.chat.id, 'Please provide a contract address.\nUsage: /social <contract_address>', {
                reply_to_message_id: msg.message_id
            });
        }

        const contractAddress = args[1];
        
        // Send loading message
        const loadingMsg = await bot.sendMessage(msg.chat.id, '🔄 Fetching social analysis...', {
            reply_to_message_id: msg.message_id
        });
        
        // Parse the contract address
        const parts = contractAddress.split('.');
        if (parts.length === 2) {
            const currency = parts[0];
            const issuer = parts[1];
            
            // Get token information from our service
            const result = await tokenInfoService.getTokenInformation(currency, issuer);
            
            // Delete loading message
        await bot.deleteMessage(msg.chat.id, loadingMsg.message_id);
            
            if (result.success) {
                // Extract social links
                const weblinks = result.data.meta?.weblinks || result.data.meta?.token?.weblinks || [];
                
                if (weblinks.length > 0) {
                    // Format a message with social links
                    let message = `⭕️ *INNER CIRCLE SOCIAL ANALYSIS* ⭕️\n\n`;
                    message += `*Token:* ${result.data.meta?.name || currency}\n`;
                    message += `*Issuer:* \`${issuer}\`\n\n`;
                    message += `*Social Links:*\n`;
                    
                    // Group by type
                    const websiteLinks = weblinks.filter(link => link.type === 'website' || link.title?.toLowerCase().includes('website'));
                    const twitterLinks = weblinks.filter(link => link.type === 'twitter' || link.title?.toLowerCase().includes('twitter'));
                    const telegramLinks = weblinks.filter(link => link.type === 'telegram' || link.title?.toLowerCase().includes('telegram'));
                    const discordLinks = weblinks.filter(link => link.type === 'discord' || link.title?.toLowerCase().includes('discord'));
                    const otherLinks = weblinks.filter(link => 
                        !link.type?.match(/website|twitter|telegram|discord/i) && 
                        !link.title?.toLowerCase().match(/website|twitter|telegram|discord/)
                    );
                    
                    if (websiteLinks.length > 0) {
                        message += `🌐 *Website:* [${websiteLinks[0].title || 'Website'}](${websiteLinks[0].url})\n`;
                    }
                    
                    if (twitterLinks.length > 0) {
                        message += `🐦 *Twitter:* [${twitterLinks[0].title || 'Twitter'}](${twitterLinks[0].url})\n`;
                    }
                    
                    if (telegramLinks.length > 0) {
                        message += `💬 *Telegram:* [${telegramLinks[0].title || 'Telegram'}](${telegramLinks[0].url})\n`;
                    }
                    
                    if (discordLinks.length > 0) {
                        message += `👾 *Discord:* [${discordLinks[0].title || 'Discord'}](${discordLinks[0].url})\n`;
                    }
                    
                    if (otherLinks.length > 0) {
                        message += `\n*Other Links:*\n`;
                        otherLinks.forEach(link => {
                            message += `🔗 *${link.title || link.type || 'Link'}:* [Link](${link.url})\n`;
                        });
                    }
                    
                    // Prepare inline keyboard with voting buttons
                    const inlineKeyboard = [];
                    
                    // Add buttons for each social link
                    weblinks.forEach(link => {
                        inlineKeyboard.push([{
                            text: `${link.title || link.type || 'Link'}`,
                            url: link.url
                        }]);
                    });
                    
                    // Send the social analysis
                    await bot.sendMessage(msg.chat.id, message, {
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: inlineKeyboard },
                        reply_to_message_id: msg.message_id
                    });
                } else {
                    await bot.sendMessage(msg.chat.id, '📭 No social links found for this token.', {
                        reply_to_message_id: msg.message_id
                    });
                }
            } else {
                await bot.sendMessage(msg.chat.id, `❌ Error retrieving token information: ${result.message}`, {
                    reply_to_message_id: msg.message_id
                });
            }
        } else {
            // Delete loading message
        await bot.deleteMessage(msg.chat.id, loadingMsg.message_id);
            await bot.sendMessage(msg.chat.id, '❌ Invalid token format. Please use the format: CURRENCY.ISSUER', {
                reply_to_message_id: msg.message_id
            });
        }
    } catch (error) {
        console.error('Error in social command:', error);
        await bot.sendMessage(msg.chat.id, '❌ Error generating social analysis. Please try again later.', {
            reply_to_message_id: msg.message_id
        });
    }
};

/**
 * Handle the /twitter command to get Twitter/X insights
 */
const handleTwitterCommand = async (msg) => {
    try {
        const args = msg.text.split(' ');
        if (args.length !== 2) {
            return bot.sendMessage(msg.chat.id, 'Please provide a Twitter/X username.\nUsage: /twitter <username>', {
                reply_to_message_id: msg.message_id
            });
        }

        const username = args[1].replace('@', ''); // Remove @ if present
        
        // Send loading message
        const loadingMsg = await bot.sendMessage(msg.chat.id, '🔄 Fetching Twitter analysis...', {
            reply_to_message_id: msg.message_id
        });
        
        // Use a direct Twitter URL rather than Rick's service
        const twitterUrl = `https://twitter.com/${username}`;
        
        // Delete loading message
        await bot.deleteMessage(msg.chat.id, loadingMsg.message_id);
        
        // Create a simple Twitter analysis message
        const message = `⭕️ *INNER CIRCLE TWITTER ANALYSIS* ⭕️\n\n` +
                       `*Username:* @${username}\n\n` +
                       `View the Twitter profile using the button below.`;
                       
        // Send the message with a button to view the Twitter profile
        await bot.sendMessage(msg.chat.id, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "🐦 View on Twitter", url: twitterUrl }
                    ]
                ]
            },
            reply_to_message_id: msg.message_id
        });
    } catch (error) {
        console.error('Error in twitter command:', error);
        await bot.sendMessage(msg.chat.id, '❌ Error generating Twitter analysis. Please try again later.', {
            reply_to_message_id: msg.message_id
        });
    }
};

/**
 * Handle the /connectiontest command to verify bot connections
 */
const handleConnectionTestCommand = async (ctx) => {
    try {
        const message = `⭕️ *INNER CIRCLE BOT - CONNECTION TEST* ⭕️

Testing connection to XRPL API...

Click the button below to verify the connection.`;

        await ctx.reply(message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { 
                            text: '🔄 Test XRPL Connection', 
                            callback_data: 'test_xrpl_connection' 
                        }
                    ]
                ]
            }
        });
    } catch (error) {
        console.error('Error in connection test command:', error);
        await ctx.reply('❌ Error testing connection. Please try again later.');
    }
};

/**
 * Handle the /xrpltoken command to get XRPL token information
 */
const handleXrplTokenCommand = async (msg) => {
    try {
        const args = msg.text.split(' ');
        if (args.length !== 3) {
            return bot.sendMessage(msg.chat.id, 'Please provide both currency code and issuer address.\nUsage: /xrpltoken <currency_code> <issuer_address>\nExample: /xrpltoken USD rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B', {
                reply_to_message_id: msg.message_id
            });
        }

        const currency = args[1].toUpperCase();
        const issuer = args[2];
        
        // Validate the issuer address
        if (!xrplService.isValidXRPLAddress(issuer)) {
            return bot.sendMessage(msg.chat.id, '❌ Invalid XRPL issuer address. Please check and try again.', {
                reply_to_message_id: msg.message_id
            });
        }
        
        // Send loading message
        const loadingMsg = await bot.sendMessage(msg.chat.id, `🔄 Fetching information for ${currency} token issued by ${issuer}...`, {
            reply_to_message_id: msg.message_id
        });
        
        // Get token information from our combined service
        const result = await tokenInfoService.getTokenInformation(currency, issuer);
        
        // Get account info to extract domain for TOML
        const accountInfo = await tokenInfoService.getAccountInfo(issuer);
        
        // Delete loading message
        await bot.deleteMessage(msg.chat.id, loadingMsg.message_id);
        
        if (result.success) {
            // Format the token description
            const formattedDescription = tokenInfoService.formatTokenDescription(result);
            
            // Prepare inline keyboard with voting buttons
            const inlineKeyboard = [];
            
            // Add voting buttons
            inlineKeyboard.push([
                { text: "👍 Upvote", callback_data: `upv:${currency.substring(0, 8)}:${issuer.substring(0, 8)}` },
                { text: "👎 Downvote", callback_data: `dwv:${currency.substring(0, 8)}:${issuer.substring(0, 8)}` }
            ]);
            
            // Add social button (unified flow)
            inlineKeyboard.push([
                { text: "📱 Add Socials", callback_data: `soc:${currency.substring(0, 8)}:${issuer.substring(0, 8)}` }
            ]);
            
            // Add admin approval button for admins
            try {
                const chatAdmins = await bot.getChatAdministrators(msg.chat.id);
                const isAdmin = chatAdmins.some(admin => admin.user.id === msg.from.id);
                if (isAdmin) {
                    inlineKeyboard.push([
                        { text: "✅ Approve for Community", callback_data: `apv:${currency.substring(0, 8)}:${issuer.substring(0, 8)}` }
                    ]);
                }
            } catch (adminError) {
                console.error('Error checking admin status:', adminError);
                // Continue without the admin button if check fails
            }
            
            // Extract domain from account_data if available
            let domain = null;
            if (accountInfo.success && accountInfo.data && accountInfo.data.account_data && accountInfo.data.account_data.Domain) {
                try {
                    domain = Buffer.from(accountInfo.data.account_data.Domain, 'hex').toString('utf8');
                    console.log(`Found domain for issuer: ${domain}`);
                } catch (error) {
                    console.error('Error decoding domain from account data:', error);
                }
            }
            
            // First check if we can find an image URL
            let imageUrl = null;
            
            // First try to get image from TOML if domain is available
            if (domain && imageUtils.getTokenImageFromToml) {
                try {
                    const tomlImageUrl = await imageUtils.getTokenImageFromToml(currency, issuer, domain);
                    if (tomlImageUrl) {
                        console.log(`Found token image in TOML: ${tomlImageUrl}`);
                        imageUrl = tomlImageUrl;
                    }
                } catch (tomlError) {
                    console.error(`Error fetching token image from TOML:`, tomlError.message);
                }
            }
            
            // If no image was found in TOML, try the original fallbacks
            if (!imageUrl) {
                try {
                    // Try XRPLMeta format 1 (dot format)
                    const xrplMetaIconUrl = `https://api.xrplmeta.org/icon/${currency}.${issuer}`;
                    // Just test if the URL is valid, don't send yet
                    await axios.head(xrplMetaIconUrl, { timeout: 3000 });
                    imageUrl = xrplMetaIconUrl;
                } catch (error) {
                    try {
                        // Try XRPLMeta format 2 (plus format)
                        const altXrplMetaIconUrl = `https://api.xrplmeta.org/icon/${currency}+${issuer}`;
                        await axios.head(altXrplMetaIconUrl, { timeout: 3000 });
                        imageUrl = altXrplMetaIconUrl;
                    } catch (altError) {
                        try {
                            // Try XRPScan format
                            const xrpscanIconUrl = `https://xrpscan.com/static/icons/currency/${issuer}.png`;
                            await axios.head(xrpscanIconUrl, { timeout: 3000 });
                            imageUrl = xrpscanIconUrl;
                        } catch (finalError) {
                            console.log(`No valid image URL found for ${currency}:${issuer}`);
                            // No image found, will send text only
                        }
                    }
                }
            }
            
            // Check if the description is short enough to fit in a caption (max 1024 chars)
            const isCaptionLengthValid = formattedDescription.length <= 1024;
            
            // If we have an image URL and the description fits in a caption, send as a single message
            if (imageUrl && isCaptionLengthValid) {
                try {
                    console.log(`Sending token info with image as caption for ${currency}:${issuer}`);
                    await bot.sendPhoto(msg.chat.id, imageUrl, {
                        caption: formattedDescription,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: inlineKeyboard
                        },
                        reply_to_message_id: msg.message_id
                    });
                    console.log(`Successfully sent combined image and info for ${currency}:${issuer}`);
                } catch (error) {
                    console.error(`Error sending combined image and info: ${error.message}`);
                    // Fall back to separate messages
                    await sendSeparateMessagesWithFallback();
                }
            } else {
                // Either the description is too long or we don't have an image
                await sendSeparateMessagesWithFallback();
            }
            
            // Helper function to send separate messages with fallback
            async function sendSeparateMessagesWithFallback() {
                // If we have an image URL, send it first
                if (imageUrl) {
                    try {
                        await bot.sendPhoto(msg.chat.id, imageUrl, {
                            parse_mode: 'Markdown',
                            reply_to_message_id: msg.message_id
                        });
                        console.log(`Successfully sent token image for ${currency}:${issuer}`);
                    } catch (imageError) {
                        console.error(`Error sending token image for ${currency}:${issuer}:`, imageError.message);
                        // If this fails, try the fallback URLs one by one
                        await tryFallbackImages();
                    }
                } else {
                    // If we don't have an image URL yet, try the fallback URLs
                    await tryFallbackImages();
                }
                
                // Send the token info as a separate message
                await bot.sendMessage(msg.chat.id, formattedDescription, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: inlineKeyboard
                    },
                    reply_to_message_id: msg.message_id,
                    disable_web_page_preview: true
                });
            }
            
            // Helper function to try fallback image URLs
            async function tryFallbackImages() {
                let imageFound = false;
                
                // Only try these if we haven't already found an image
                if (!imageUrl) {
                    try {
                        // Corrected URL format - removed /api/v1/ path segment
                        const xrplMetaIconUrl = `https://api.xrplmeta.org/icon/${currency}.${issuer}`;
                        console.log(`Attempting to send token image from URL: ${xrplMetaIconUrl}`);
                        
                    await bot.sendPhoto(msg.chat.id, xrplMetaIconUrl, {
                        parse_mode: 'Markdown',
                        reply_to_message_id: msg.message_id
                    });
                        
                        console.log(`Successfully sent token image for ${currency}:${issuer}`);
                        imageFound = true;
                } catch (imageError) {
                        console.error(`Error sending token image for ${currency}:${issuer} (Format 1):`, imageError.message);
                        
                        // For specific error types, try an alternative format
                        if (imageError.code === 'ETELEGRAM' || imageError.response?.statusCode === 400) {
                            try {
                                // Try alternative format with + instead of .
                                const altXrplMetaIconUrl = `https://api.xrplmeta.org/icon/${currency}+${issuer}`;
                                console.log(`Attempting alternative token image URL: ${altXrplMetaIconUrl}`);
                                
                                await bot.sendPhoto(msg.chat.id, altXrplMetaIconUrl, {
                            parse_mode: 'Markdown',
                            reply_to_message_id: msg.message_id
                        });
                                
                                console.log(`Successfully sent alternative token image for ${currency}:${issuer}`);
                                imageFound = true;
                            } catch (altImageError) {
                                console.error(`Error sending token image for ${currency}:${issuer} (Format 2):`, altImageError.message);
                                
                                // Try third fallback with XRPScan icon
                                try {
                                    const xrpscanIconUrl = `https://xrpscan.com/static/icons/currency/${issuer}.png`;
                                    console.log(`Attempting XRPScan token image URL: ${xrpscanIconUrl}`);
                                    
                                    await bot.sendPhoto(msg.chat.id, xrpscanIconUrl, {
                            parse_mode: 'Markdown',
                            reply_to_message_id: msg.message_id
                        });
                                    
                                    console.log(`Successfully sent XRPScan token image for ${currency}:${issuer}`);
                                    imageFound = true;
                                } catch (finalImageError) {
                                    console.error(`All image formats failed for ${currency}:${issuer}:`, finalImageError.message);
                                }
                            }
                        }
                    }
                }
                
                return imageFound;
            }
        } else {
            // Send error message
            await bot.sendMessage(msg.chat.id, `❌ Error retrieving token information: ${result.message}`, {
                reply_to_message_id: msg.message_id
            });
        }
    } catch (error) {
        console.error('Error in XRPL token command:', error);
        await bot.sendMessage(msg.chat.id, '❌ Error retrieving XRPL token information. Please try again later.', {
            reply_to_message_id: msg.message_id
        });
    }
};

/**
 * Handle the /xrplsearch command to search for XRPL tokens
 */
const handleXrplSearchCommand = async (msg) => {
    try {
        const args = msg.text.split(' ');
        if (args.length < 2) {
            return bot.sendMessage(msg.chat.id, 'Please provide a search query.\nUsage: /xrplsearch <query>\nExample: /xrplsearch Bitstamp', {
                reply_to_message_id: msg.message_id
            });
        }

        // Join all arguments after the command to form the search query
        const query = args.slice(1).join(' ');
        
        // Send loading message
        const loadingMsg = await bot.sendMessage(msg.chat.id, `🔄 Searching for XRPL tokens matching "${query}"...`, {
            reply_to_message_id: msg.message_id
        });
        
        // Search for tokens
        const result = await tokenInfoService.searchTokens(query, { limit: 10 });
        
        // Delete loading message
        await bot.deleteMessage(msg.chat.id, loadingMsg.message_id);
        
        if (result.success && result.tokens.length > 0) {
            // Format the results
            let message = `🔍 *Found ${result.tokens.length} tokens matching "${query}":*\n\n`;
            
            const inlineKeyboard = [];
            
            result.tokens.forEach((token, index) => {
                const name = token.meta?.name || 'Unknown';
                const symbol = token.currency || 'Unknown';
                const issuer = token.issuer ? token.issuer.substring(0, 8) + '...' : 'Unknown';
                const trustlines = token.metrics?.trustlines || 'N/A';
                
                message += `${index + 1}. *${name}* (${symbol})\n`;
                message += `   Issuer: \`${issuer}\`\n`;
                
                if (token.meta?.description) {
                    // Trim description if too long
                    const desc = token.meta.description.length > 50 
                        ? token.meta.description.substring(0, 50) + '...' 
                        : token.meta.description;
                    message += `   Description: ${desc}\n`;
                }
                
                message += `   Trustlines: ${trustlines}\n\n`;
                
                // Add a button to get more info about this token
                inlineKeyboard.push([{
                    text: `📊 ${name} (${symbol}) Details`,
                    callback_data: `xrpl_token_info:${token.currency}:${token.issuer}`
                }]);
            });
            
            // Send the results
            await bot.sendMessage(msg.chat.id, message, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: inlineKeyboard },
                reply_to_message_id: msg.message_id
            });
        } else {
            // No results or error
            const errorMsg = result.success 
                ? `📭 No tokens found matching "${query}".` 
                : `❌ Error searching for tokens: ${result.message}`;
                
            await bot.sendMessage(msg.chat.id, errorMsg, {
                reply_to_message_id: msg.message_id
            });
        }
    } catch (error) {
        console.error('Error in XRPL search command:', error);
        await bot.sendMessage(msg.chat.id, '❌ Error searching for XRPL tokens. Please try again later.', {
            reply_to_message_id: msg.message_id
        });
    }
};

/**
 * Handle the /xrplholders command to get token holders
 */
const handleXrplHoldersCommand = async (msg) => {
    try {
        const args = msg.text.split(' ');
        if (args.length !== 2) {
            return bot.sendMessage(msg.chat.id, 'Please provide an issuer address.\nUsage: /xrplholders <issuer_address>\nExample: /xrplholders rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B', {
                reply_to_message_id: msg.message_id
            });
        }

        const issuer = args[1];
        
        // Validate the issuer address
        if (!xrplService.isValidXRPLAddress(issuer)) {
            return bot.sendMessage(msg.chat.id, '❌ Invalid XRPL issuer address. Please check and try again.', {
                reply_to_message_id: msg.message_id
            });
        }
        
        // Send loading message
        const loadingMsg = await bot.sendMessage(msg.chat.id, `🔄 Fetching token holders for issuer ${issuer}...`, {
            reply_to_message_id: msg.message_id
        });
        
        // Get token holders
        const result = await tokenInfoService.getTokenHolders(issuer, { limit: 10 });
        
        // Delete loading message
        await bot.deleteMessage(msg.chat.id, loadingMsg.message_id);
        
        if (result.success && result.holders.length > 0) {
            // Format the results
            let message = `👥 *Top ${result.holders.length} holders for ${issuer}:*\n\n`;
            
            result.holders.forEach((holder, index) => {
                message += `${index + 1}. Account: \`${holder.account}\`\n`;
                message += `   Currency: ${holder.currency}\n`;
                message += `   Balance: ${parseFloat(holder.balance).toLocaleString()}\n\n`;
            });
            
            if (result.marker) {
                message += '\n_More holders available. The list is limited to the first 10 holders._';
            }
            
            // Send the results
            await bot.sendMessage(msg.chat.id, message, {
                parse_mode: 'Markdown',
                reply_to_message_id: msg.message_id
            });
        } else {
            // No results or error
            const errorMsg = result.success 
                ? `📭 No holders found for ${issuer}.` 
                : `❌ Error fetching holders: ${result.message}`;
                
            await bot.sendMessage(msg.chat.id, errorMsg, {
                reply_to_message_id: msg.message_id
            });
        }
    } catch (error) {
        console.error('Error in XRPL holders command:', error);
        await bot.sendMessage(msg.chat.id, '❌ Error fetching XRPL token holders. Please try again later.', {
            reply_to_message_id: msg.message_id
        });
    }
};

/**
 * Handle callback queries for XRPL token info buttons
 */
const handleXrplCallbackQuery = async (callbackQuery) => {
    const data = callbackQuery.data;
    
    if (data.startsWith('xrpl_token_info:')) {
        try {
            // Extract currency and issuer from callback data
            const parts = data.split(':');
            if (parts.length !== 3) {
                return bot.answerCallbackQuery(callbackQuery.id, 'Invalid token data');
            }
            
            const currency = parts[1];
            const issuer = parts[2];
            
            // Answer the callback query to remove the loading indicator
            await bot.answerCallbackQuery(callbackQuery.id);
            
            // Send loading message
            const loadingMsg = await bot.sendMessage(callbackQuery.message.chat.id, `🔄 Fetching information for ${currency} token issued by ${issuer}...`);
            
            // Get token information
            const result = await tokenInfoService.getTokenInformation(currency, issuer);
            
            // Delete loading message
            await bot.deleteMessage(callbackQuery.message.chat.id, loadingMsg.message_id);
            
            if (result.success) {
                // Format the token data into a readable message
                const formattedDescription = tokenInfoService.formatTokenDescription(result);
                
                // Prepare any weblinks for inline buttons
                const inlineKeyboard = [];
                
                // Add voting buttons at the top
                inlineKeyboard.push([
                    { text: "👍 Upvote", callback_data: `upv:${currency.substring(0, 8)}:${issuer.substring(0, 8)}` },
                    { text: "👎 Downvote", callback_data: `dwv:${currency.substring(0, 8)}:${issuer.substring(0, 8)}` }
                ]);
                
                // Add social input buttons
                inlineKeyboard.push([
                    { text: "📱 Add Socials", callback_data: `soc:${currency.substring(0, 8)}:${issuer.substring(0, 8)}` }
                ]);
                
                inlineKeyboard.push([
                    { text: "📊 View Details", callback_data: `xrpl_token_info:${currency}:${issuer}` }
                ]);
                
                // Add admin approval button for admins only
                try {
                    const chatAdmins = await bot.getChatAdministrators(callbackQuery.message.chat.id);
                    const isAdmin = chatAdmins.some(admin => admin.user.id === callbackQuery.from.id);
                    
                    if (isAdmin) {
                inlineKeyboard.push([
                    { text: "✅ Approve for Community", callback_data: `apv:${currency.substring(0, 8)}:${issuer.substring(0, 8)}` }
                ]);
                    }
                } catch (adminError) {
                    console.error('Error checking admin status:', adminError);
                    // Continue without the admin button if check fails
                }
                
                // Add weblinks if available
                if (result.data.meta && result.data.meta.token && result.data.meta.token.meta && result.data.meta.token.meta.weblinks) {
                    const weblinks = result.data.meta.token.meta.weblinks;
                    
                    // Group buttons by 2 per row
                    for (let i = 0; i < weblinks.length; i += 2) {
                        const row = [];
                        
                        // Add first button
                        const link1 = weblinks[i];
                        row.push({
                            text: link1.title || link1.type || 'Link',
                            url: link1.url
                        });
                        
                        // Add second button if available
                        if (i + 1 < weblinks.length) {
                            const link2 = weblinks[i + 1];
                            row.push({
                                text: link2.title || link2.type || 'Link',
                                url: link2.url
                            });
                        }
                        
                        inlineKeyboard.push(row);
                    }
                }
                
                // Add domain link if available
                if (result.data.issuerInfo && result.data.issuerInfo.domain) {
                    inlineKeyboard.push([{
                        text: `🌐 ${result.data.issuerInfo.domain}`,
                        url: `https://${result.data.issuerInfo.domain}`
                    }]);
                }
                
                // Get account info to extract domain if available
                const accountInfo = await tokenInfoService.getAccountInfo(issuer);
                
                // Extract domain from account_data if available
                let domain = null;
                if (accountInfo.success && accountInfo.data && accountInfo.data.account_data && accountInfo.data.account_data.Domain) {
                    try {
                        domain = Buffer.from(accountInfo.data.account_data.Domain, 'hex').toString('utf8');
                        console.log(`Found domain for issuer: ${domain}`);
                    } catch (error) {
                        console.error('Error decoding domain from account data:', error);
                    }
                }
                
                // Domain might also be in the result data
                if (!domain && result.data.issuerInfo && result.data.issuerInfo.domain) {
                    domain = result.data.issuerInfo.domain;
                    console.log(`Found domain from issuer info: ${domain}`);
                }
                
                // First check if we can find an image URL
                let imageUrl = null;
                
                // First try to get image from TOML if domain is available
                if (domain && imageUtils.getTokenImageFromToml) {
                    try {
                        const tomlImageUrl = await imageUtils.getTokenImageFromToml(currency, issuer, domain);
                        if (tomlImageUrl) {
                            console.log(`Found token image in TOML: ${tomlImageUrl}`);
                            imageUrl = tomlImageUrl;
                        }
                    } catch (tomlError) {
                        console.error(`Error fetching token image from TOML:`, tomlError.message);
                    }
                }
                
                // If no image was found in TOML, try the original fallbacks
                if (!imageUrl) {
                    try {
                        // Try XRPLMeta format 1 (dot format)
                        const xrplMetaIconUrl = `https://api.xrplmeta.org/icon/${currency}.${issuer}`;
                        // Just test if the URL is valid, don't send yet
                        await axios.head(xrplMetaIconUrl, { timeout: 3000 });
                        imageUrl = xrplMetaIconUrl;
                    } catch (error) {
                        try {
                            // Try XRPLMeta format 2 (plus format)
                            const altXrplMetaIconUrl = `https://api.xrplmeta.org/icon/${currency}+${issuer}`;
                            await axios.head(altXrplMetaIconUrl, { timeout: 3000 });
                            imageUrl = altXrplMetaIconUrl;
                        } catch (altError) {
                            try {
                                // Try XRPScan format
                                const xrpscanIconUrl = `https://xrpscan.com/static/icons/currency/${issuer}.png`;
                                await axios.head(xrpscanIconUrl, { timeout: 3000 });
                                imageUrl = xrpscanIconUrl;
                            } catch (finalError) {
                                console.log(`No valid image URL found for ${currency}:${issuer}`);
                                // No image found, will send text only
                            }
                        }
                    }
                }
                
                // Check if the description is short enough to fit in a caption (max 1024 chars)
                const isCaptionLengthValid = formattedDescription.length <= 1024;
                
                // If we have an image URL and the description fits in a caption, send as a single message
                if (imageUrl && isCaptionLengthValid) {
                    try {
                        console.log(`Sending token info with image as caption for ${currency}:${issuer}`);
                        await bot.sendPhoto(callbackQuery.message.chat.id, imageUrl, {
                            caption: formattedDescription,
                                parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: inlineKeyboard
                            }
                        });
                        console.log(`Successfully sent combined image and info for ${currency}:${issuer}`);
                    } catch (error) {
                        console.error(`Error sending combined image and info: ${error.message}`);
                        // Fall back to separate messages
                        await sendSeparateMessagesWithFallback();
                    }
                        } else {
                    // Either the description is too long or we don't have an image
                    await sendSeparateMessagesWithFallback();
                }
                
                // Helper function to send separate messages with fallback
                async function sendSeparateMessagesWithFallback() {
                    // If we have an image URL, send it first
                    if (imageUrl) {
                        try {
                            await bot.sendPhoto(callbackQuery.message.chat.id, imageUrl, {
                                parse_mode: 'Markdown'
                            });
                            console.log(`Successfully sent token image for ${currency}:${issuer}`);
                        } catch (imageError) {
                            console.error(`Error sending token image for ${currency}:${issuer}:`, imageError.message);
                            // If this fails, try the fallback URLs one by one
                            await tryFallbackImages();
                        }
                    } else {
                        // If we don't have an image URL yet, try the fallback URLs
                        await tryFallbackImages();
                    }
                    
                    // Send the token info as a separate message
                    await bot.sendMessage(callbackQuery.message.chat.id, formattedDescription, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: inlineKeyboard
                        },
                        disable_web_page_preview: true
                    });
                }
                
                // Helper function to try fallback image URLs
                async function tryFallbackImages() {
                    let imageFound = false;
                    
                    // Only try these if we haven't already found an image
                    if (!imageUrl) {
                        try {
                            // Corrected URL format - removed /api/v1/ path segment
                            const xrplMetaIconUrl = `https://api.xrplmeta.org/icon/${currency}.${issuer}`;
                            console.log(`Attempting to send token image from URL: ${xrplMetaIconUrl}`);
                            
                            await bot.sendPhoto(callbackQuery.message.chat.id, xrplMetaIconUrl, {
                                parse_mode: 'Markdown'
                            });
                            
                            console.log(`Successfully sent token image for ${currency}:${issuer}`);
                            imageFound = true;
                        } catch (imageError) {
                            console.error(`Error sending token image for ${currency}:${issuer} (Format 1):`, imageError.message);
                            
                            // For specific error types, try an alternative format
                            if (imageError.code === 'ETELEGRAM' || imageError.response?.statusCode === 400) {
                                try {
                                    // Try alternative format with + instead of .
                                    const altXrplMetaIconUrl = `https://api.xrplmeta.org/icon/${currency}+${issuer}`;
                                    console.log(`Attempting alternative token image URL: ${altXrplMetaIconUrl}`);
                                    
                                    await bot.sendPhoto(callbackQuery.message.chat.id, altXrplMetaIconUrl, {
                                        parse_mode: 'Markdown'
                                    });
                                    
                                    console.log(`Successfully sent alternative token image for ${currency}:${issuer}`);
                                    imageFound = true;
                                } catch (altImageError) {
                                    console.error(`Error sending token image for ${currency}:${issuer} (Format 2):`, altImageError.message);
                                    
                                    // Try third fallback with XRPScan icon
                                    try {
                                        const xrpscanIconUrl = `https://xrpscan.com/static/icons/currency/${issuer}.png`;
                                        console.log(`Attempting XRPScan token image URL: ${xrpscanIconUrl}`);
                                        
                                        await bot.sendPhoto(callbackQuery.message.chat.id, xrpscanIconUrl, {
                                            parse_mode: 'Markdown'
                                        });
                                        
                                        console.log(`Successfully sent XRPScan token image for ${currency}:${issuer}`);
                                        imageFound = true;
                                    } catch (finalImageError) {
                                        console.error(`All image formats failed for ${currency}:${issuer}:`, finalImageError.message);
                                    }
                                }
                            }
                        }
                    }
                    
                    return imageFound;
                }
            } else {
                // Send error message
                await bot.sendMessage(callbackQuery.message.chat.id, `❌ Error retrieving token information: ${result.message}`, {
                    parse_mode: 'Markdown'
                });
            }
        } catch (error) {
            console.error('Error handling XRPL token info callback:', error);
            await bot.sendMessage(callbackQuery.message.chat.id, '❌ Error retrieving XRPL token information. Please try again later.');
        }
    }
    else if (data.startsWith('tok:')) {
        try {
            // Extract currency and issuer prefixes from callback data
            const parts = data.split(':');
            if (parts.length !== 3) {
                return bot.answerCallbackQuery(callbackQuery.id, 'Invalid token data');
            }
            
            const currencyPrefix = parts[1];
            const issuerPrefix = parts[2];
            
            // Answer the callback query to remove the loading indicator
            await bot.answerCallbackQuery(callbackQuery.id);
            
            // Send loading message
            const loadingMsg = await bot.sendMessage(callbackQuery.message.chat.id, `🔄 Fetching updated token information...`);
            
            // In a real implementation, you would look up the full currency and issuer
            // For now, we'll just use a dummy call to show a response
            await bot.deleteMessage(callbackQuery.message.chat.id, loadingMsg.message_id);
            await bot.sendMessage(callbackQuery.message.chat.id, 
                `✅ Thanks for adding social information for this token!\n\nThe token database has been updated. Users who view this token in the future will see the information you provided.`,
                { parse_mode: 'Markdown' }
            );
            
        } catch (error) {
            console.error('Error handling token info callback:', error);
            await bot.sendMessage(callbackQuery.message.chat.id, '❌ Error retrieving updated token information. Please try again later.');
        }
    }
    else if (data.startsWith('xrpl_holders:')) {
        try {
            // Extract currency and issuer address from callback data
            const parts = data.split(':');
            if (parts.length !== 3) {
                return bot.answerCallbackQuery(callbackQuery.id, 'Invalid token data');
            }
            
            const currency = parts[1];
            const issuer = parts[2];
            
            // Answer the callback query to remove the loading indicator
            await bot.answerCallbackQuery(callbackQuery.id);
            
            // Send loading message
            const loadingMsg = await bot.sendMessage(callbackQuery.message.chat.id, `🔄 Fetching token holders for ${currency} issued by ${issuer}...`);
            
            // Get token holders with currency filter
            const result = await tokenInfoService.getTokenHolders(issuer, { 
                limit: 20,
                currency: currency
            });
            
            // Delete loading message
            await bot.deleteMessage(callbackQuery.message.chat.id, loadingMsg.message_id);
            
            if (result.success && result.holders.length > 0) {
                // Format the results
                let message = `👥 *Top ${result.holders.length} holders for ${currency}*\n`;
                message += `*Issuer:* \`${issuer}\`\n\n`;
                
                // Sort holders by balance in descending order
                const sortedHolders = result.holders.sort((a, b) => 
                    parseFloat(b.balance) - parseFloat(a.balance)
                );
                
                // Calculate total supply in circulation
                const totalSupply = sortedHolders.reduce((sum, holder) => 
                    sum + parseFloat(holder.balance), 0
                );
                
                // Format each holder with percentage
                sortedHolders.forEach((holder, index) => {
                    const balance = parseFloat(holder.balance);
                    const percentage = (balance / totalSupply * 100).toFixed(2);
                    message += `${index + 1}. \`${holder.account}\`\n`;
                    message += `   Balance: ${balance.toLocaleString()} (${percentage}%)\n`;
                });
                
                // Add pagination button if there's more data
                const inlineKeyboard = [];
                if (result.marker) {
                    inlineKeyboard.push([{
                        text: "Load More Holders",
                        callback_data: `xrpl_holders_more:${currency}:${issuer}:${result.marker}`
                    }]);
                }
                
                // Add other useful buttons
                inlineKeyboard.push([
                    {
                        text: "📊 View on XRPScan",
                        url: `https://xrpscan.com/token/${currency}.${issuer}`
                    }
                ]);
                
                // Send the message
                await bot.sendMessage(callbackQuery.message.chat.id, message, {
                    parse_mode: 'Markdown',
                    reply_markup: inlineKeyboard.length > 0 ? { inline_keyboard: inlineKeyboard } : undefined
                });
            } else {
                // No holders found or error
                let errorMessage = `❌ ${result.success ? 'No holders found' : result.message} for ${currency} token issued by ${issuer}.`;
                await bot.sendMessage(callbackQuery.message.chat.id, errorMessage);
            }
        } catch (error) {
            console.error('Error handling token holders callback:', error);
            await bot.sendMessage(callbackQuery.message.chat.id, '❌ Error retrieving token holders. Please try again later.');
        }
    }
    else if (data.startsWith('twt:') || data.startsWith('tg:') || data.startsWith('web:')) {
        try {
            // Extract currency and issuer from callback data
            const parts = data.split(':');
            if (parts.length !== 3) {
                return bot.answerCallbackQuery(callbackQuery.id, 'Invalid token data');
            }
            
            let socialType = '';
            if (data.startsWith('twt:')) socialType = 'twitter';
            else if (data.startsWith('tg:')) socialType = 'telegram';
            else if (data.startsWith('web:')) socialType = 'website';
            
            const currencyPrefix = parts[1];
            const issuerPrefix = parts[2];
            const userId = callbackQuery.from.id.toString();
            
            // Store that this user is in the process of adding a social link
            if (!global.pendingSocialInputs) {
                global.pendingSocialInputs = {};
            }
            
            global.pendingSocialInputs[userId] = {
                type: socialType,
                currencyPrefix,
                issuerPrefix,
                timestamp: Date.now()
            };
            
            let promptMessage;
            switch (socialType) {
                case 'twitter':
                    promptMessage = 'Please send the Twitter URL for this token (e.g., https://twitter.com/username)';
                    break;
                case 'telegram':
                    promptMessage = 'Please send the Telegram group URL for this token (e.g., https://t.me/groupname)';
                    break;
                case 'website':
                    promptMessage = 'Please send the website URL for this token (e.g., https://example.com)';
                    break;
                default:
                    promptMessage = 'Please send the URL for this token';
            }
            
            // Answer the callback query
            await bot.answerCallbackQuery(callbackQuery.id);
            
            // Send a message prompting the user to provide the social URL
            await bot.sendMessage(callbackQuery.message.chat.id, `📌 ${promptMessage}\n\nReply directly with the URL or type /cancel to abort.`, {
                reply_markup: {
                    force_reply: true,
                    selective: true
                }
            });
            
        } catch (error) {
            console.error(`Error handling ${data} callback:`, error);
            await bot.answerCallbackQuery(callbackQuery.id, 'Error processing your request. Please try again.');
        }
    }
    else if (data.startsWith('upv:') || data.startsWith('dwv:')) {
        try {
            // Extract token information from callback data
            const parts = data.split(':');
            if (parts.length !== 3) {
                return bot.answerCallbackQuery(callbackQuery.id, 'Invalid token data');
            }
            
            const currencyPrefix = parts[1];
            const issuerPrefix = parts[2];
            const isUpvote = data.startsWith('upv:');
            const userId = callbackQuery.from.id.toString();
            
            // Lookup the full token info
            let currency, issuer;
            
            try {
                const tokenLookup = await tokenInfoService.findTokenByPrefix(currencyPrefix, issuerPrefix);
                
                if (tokenLookup.success) {
                    // We found the token with the prefixes
                    currency = tokenLookup.currency;
                    issuer = tokenLookup.issuer;
                } else {
                    // Fallback to using the original message text for extraction
                    if (callbackQuery.message && callbackQuery.message.text) {
                        const fullTokenText = callbackQuery.message.text;
                        // Try to extract from token address format like `ISSUER`
                        const addressMatch = fullTokenText.match(/`([^`]+)`/);
                        if (addressMatch && addressMatch.length === 2) {
                            issuer = addressMatch[1];
                            
                            // We need to get the currency from the message or lookup by issuer
                            const tokenData = await tokenInfoService.findTokenByPrefix('', issuer);
                            if (tokenData.success) {
                                currency = tokenData.currency;
                            } else {
                                // If we can't find the currency, use a placeholder
                                currency = currencyPrefix;
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Error looking up token from prefix:', error);
                // Try to extract from the message as a fallback
                if (callbackQuery.message && callbackQuery.message.text) {
                    const fullTokenText = callbackQuery.message.text;
                    // Try to extract from token address format like `ISSUER`
                    const addressMatch = fullTokenText.match(/`([^`]+)`/);
                    if (addressMatch && addressMatch.length === 2) {
                        issuer = addressMatch[1];
                        
                        // We need to get the currency from the message or lookup by issuer
                        const tokenData = await tokenInfoService.findTokenByPrefix('', issuer);
                        if (tokenData.success) {
                            currency = tokenData.currency;
                        } else {
                            // If we can't find the currency, use a placeholder
                            currency = currencyPrefix;
                        }
                    }
                }
            }
            
            // Format token address consistently
            const tokenAddress = `${currency}:${issuer}`;
            
            // Use the token service to record the vote
            const tokenService = require('../services/tokenService');
            const result = tokenService.addCommunityVote(tokenAddress, userId, isUpvote);
            
            if (result.success) {
                // Show success message with bull/bear emoji
                const emoji = isUpvote ? '🐂' : '🐻';
                await bot.answerCallbackQuery(callbackQuery.id, `${emoji} ${result.message}`);
                
                // Update the message to refresh vote counts
                if (callbackQuery.message) {
                    try {
                        console.log(`Updating message after vote for token ${tokenAddress}`);
                        // Get token information again to refresh the message
                        const tokenResult = await tokenInfoService.getTokenInformation(currency, issuer);
                        
                        if (tokenResult.success) {
                            console.log(`Successfully retrieved token information for ${currency}:${issuer}`);
                            // Format the token description with updated vote counts
                            const formattedDescription = tokenInfoService.formatTokenDescription(tokenResult);
                            console.log(`Formatted description with updated vote counts`);
                            
                            // Update the message text while keeping the same markup
                            if (callbackQuery.message.text) {
                                console.log(`Updating text message with new vote counts`);
                                // If it's a text message
                                await bot.editMessageText(formattedDescription, {
                                    chat_id: callbackQuery.message.chat.id,
                                    message_id: callbackQuery.message.message_id,
                                    parse_mode: 'Markdown',
                                    reply_markup: callbackQuery.message.reply_markup,
                                    disable_web_page_preview: true
                                });
                                console.log(`Successfully updated text message with new vote counts`);
                            } else if (callbackQuery.message.caption) {
                                console.log(`Updating caption with new vote counts`);
                                // If it's a photo with caption
                                await bot.editMessageCaption(formattedDescription, {
                                    chat_id: callbackQuery.message.chat.id,
                                    message_id: callbackQuery.message.message_id,
                                    parse_mode: 'Markdown',
                                    reply_markup: callbackQuery.message.reply_markup
                                });
                                console.log(`Successfully updated caption with new vote counts`);
                            }
                        }
                    } catch (updateError) {
                        console.error('Error updating message after vote:', updateError);
                        // Don't fail the whole callback if just the update fails
                    }
                }
                
                // Check if we should notify admins
                if (result.shouldNotifyAdmins) {
                    // Notify admins that this token has reached the voting threshold
                    try {
                        const config = require('../config');
                        const adminChatId = config.adminChatId;
                        
                        if (adminChatId) {
                            const token = result.votes;
                            const totalVotes = token.upvotes + token.downvotes;
                            const upvotePercentage = (token.upvotes / totalVotes) * 100;
                            
                            const adminMessage = `🔔 *Token Voting Alert*\n\n` +
                                `*Token:* \`${tokenAddress}\`\n\n` +
                                `*Community Votes:* 🐂 ${token.upvotes} (${upvotePercentage.toFixed(1)}%) | 🐻 ${token.downvotes}\n\n` +
                                `Consider reviewing this token for community listing.`;
                            
                            await bot.sendMessage(adminChatId, adminMessage, {
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    inline_keyboard: [
                                        [
                                            { text: "✅ Approve", callback_data: `approve_token:${tokenAddress}` },
                                            { text: "❌ Reject", callback_data: `reject_token:${tokenAddress}` }
                                        ]
                                    ]
                                }
                            });
                        }
                    } catch (error) {
                        console.error('Error notifying admins:', error);
                    }
                }
            } else {
                // Show error message
                await bot.answerCallbackQuery(callbackQuery.id, result.message);
            }
        } catch (error) {
            console.error('Error handling token vote:', error);
            await bot.answerCallbackQuery(callbackQuery.id, 'Error recording your vote. Please try again.');
        }
    }
    else if (data.startsWith('apv:') || data.startsWith('rej:')) {
        try {
            // Extract currency and issuer from callback data
            const parts = data.split(':');
            if (parts.length !== 3) {
                return bot.answerCallbackQuery(callbackQuery.id, 'Invalid token data');
            }
            
            const isApproved = data.startsWith('apv:');
            let currency, issuer;
            
            // Handle different formats
            if (parts.length === 3) {
                // Format: approve_token:currency:issuer
                currency = parts[1];
                issuer = parts[2];
            } else {
                // Format: approve_token:contractAddress
                const contractAddress = data.substring(data.indexOf(':') + 1);
                // Try to parse as currency.issuer
                const contractParts = contractAddress.split('.');
                if (contractParts.length === 2) {
                    currency = contractParts[0];
                    issuer = contractParts[1];
                } else {
                    return bot.answerCallbackQuery(callbackQuery.id, 'Invalid token format');
                }
            }
            
            const userId = callbackQuery.from.id.toString();
            
            // Check if user is an admin
            const config = require('../config');
            if (!config.admins.includes(userId)) {
                return bot.answerCallbackQuery(callbackQuery.id, '⚠️ Only admins can approve or reject tokens');
            }
            
            if (isApproved) {
                // Admin approval logic
                await bot.answerCallbackQuery(callbackQuery.id, '✅ Token approved');
                
                // Send to master channel if configured
                try {
                    const masterChannelService = require('../services/masterChannelService');
                    const masterChannelId = masterChannelService.getMasterChannelId();
                    
                    if (masterChannelId) {
                        // Get token information
                        const tokenResult = await tokenInfoService.getTokenInformation(currency, issuer);
                        if (tokenResult.success) {
                            // Format token description
                            const formattedDescription = tokenInfoService.formatTokenDescription(tokenResult);
                            
                            // Try to send image with token from XRPLMeta after the text (optional)
                            try {
                                // Corrected URL format - removed /api/v1/ path segment
                                const xrplMetaIconUrl = `https://api.xrplmeta.org/icon/${currency}.${issuer}`;
                                console.log(`Attempting to send token image from URL: ${xrplMetaIconUrl}`);
                                
                                await bot.sendPhoto(masterChannelId, xrplMetaIconUrl, {
                                    parse_mode: 'Markdown'
                                });
                                
                                console.log(`Successfully sent token image for ${currency}:${issuer}`);
                            } catch (imageError) {
                                console.error(`Error sending token image for ${currency}:${issuer} (Format 1):`, imageError.message);
                                
                                // For specific error types, try an alternative format
                                if (imageError.code === 'ETELEGRAM' || imageError.response?.statusCode === 400) {
                                    try {
                                        // Try alternative format with + instead of .
                                        const altXrplMetaIconUrl = `https://api.xrplmeta.org/icon/${currency}+${issuer}`;
                                        console.log(`Attempting alternative token image URL: ${altXrplMetaIconUrl}`);
                                        
                                        await bot.sendPhoto(masterChannelId, altXrplMetaIconUrl, {
                                            parse_mode: 'Markdown'
                                        });
                                        
                                        console.log(`Successfully sent alternative token image for ${currency}:${issuer}`);
                                    } catch (altImageError) {
                                        console.error(`Error sending token image for ${currency}:${issuer} (Format 2):`, altImageError.message);
                                        
                                        // Try third fallback with XRPScan icon
                                        try {
                                            const xrpscanIconUrl = `https://xrpscan.com/static/icons/currency/${issuer}.png`;
                                            console.log(`Attempting XRPScan token image URL: ${xrpscanIconUrl}`);
                                            
                                            await bot.sendPhoto(masterChannelId, xrpscanIconUrl, {
                                                parse_mode: 'Markdown'
                                            });
                                            
                                            console.log(`Successfully sent XRPScan token image for ${currency}:${issuer}`);
                                        } catch (finalImageError) {
                                            console.error(`All image formats failed for ${currency}:${issuer}:`, finalImageError.message);
                                        }
                                    }
                                }
                                // Continue even if image fails - we already sent the text message
                            }
                            
                            // Send to master channel
                            await bot.sendMessage(masterChannelId, 
                                `✅ *New Community-Approved Token!*\n\n${formattedDescription}`, 
                                {
                                    parse_mode: 'Markdown',
                                    reply_markup: {
                                        inline_keyboard: [
                                            [
                                                { text: "👍 Upvote", callback_data: `upv:${currency.substring(0, 8)}:${issuer.substring(0, 8)}` },
                                                { text: "👎 Downvote", callback_data: `dwv:${currency.substring(0, 8)}:${issuer.substring(0, 8)}` }
                                            ],
                                            [
                                                { text: "📊 View Details", callback_data: `xrpl_token_info:${currency}:${issuer}` }
                                            ]
                                        ]
                                    },
                                    disable_web_page_preview: true
                                }
                            );
                        }
                    }
                } catch (error) {
                    console.error('Error sending to master channel:', error);
                }
            } else {
                // Handle rejection if needed
                await bot.answerCallbackQuery(callbackQuery.id, '❌ Token rejected');
            }
        } catch (error) {
            console.error('Error handling token approval/rejection:', error);
            await bot.answerCallbackQuery(callbackQuery.id, 'Error processing approval/rejection. Please try again.');
        }
    }
    else if (data.startsWith('soc:')) {
        try {
            // Extract currency and issuer prefixes from callback data
            const parts = data.split(':');
            if (parts.length !== 3) {
                return bot.answerCallbackQuery(callbackQuery.id, 'Invalid token data');
            }
            
            const currencyPrefix = parts[1];
            const issuerPrefix = parts[2];
            const userId = callbackQuery.from.id.toString();
            
            // Look up complete token information if needed (simplified here)
            // In a real implementation, you'd query your database
            
            // Store that this user is in the process of adding a social link
            if (!global.pendingSocialInputs) {
                global.pendingSocialInputs = {};
            }
            
            global.pendingSocialInputs[userId] = {
                step: 'twitter',
                currencyPrefix,
                issuerPrefix,
                twitter: '',
                telegram: '',
                website: '',
                timestamp: Date.now()
            };
            
            // Answer the callback query
            await bot.answerCallbackQuery(callbackQuery.id);
            
            // Start the social collection process with Twitter
            await bot.sendMessage(callbackQuery.message.chat.id, 
                "📱 *Social Information Collection - Step 1/3*\n\n" +
                "Please send the Twitter URL for this token (e.g., https://twitter.com/example)\n\n" +
                "Type /cancel at any time to abort the process.",
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        force_reply: true,
                        selective: true
                    }
                }
            );
            
        } catch (error) {
            console.error(`Error handling socials callback:`, error);
            await bot.answerCallbackQuery(callbackQuery.id, 'Error starting social collection. Please try again.');
        }
    }
    // Map like/dislike callbacks to the bull/bear voting system
    else if (data.startsWith('like_') || data.startsWith('dislike_')) {
        try {
            // Extract token contract address from callback data
            const contractAddress = data.substring(data.indexOf('_') + 1);
            const isUpvote = data.startsWith('like_');
            const userId = callbackQuery.from.id.toString();
            
            // Try to parse the contract address as currency:issuer
            let currency, issuer;
            const parts = contractAddress.split(':');
            if (parts.length === 2) {
                currency = parts[0];
                issuer = parts[1];
            } else {
                // Try to extract from the message
                if (callbackQuery.message && callbackQuery.message.text) {
                    const fullTokenText = callbackQuery.message.text;
                    // Try to extract from token address format like `ISSUER`
                    const addressMatch = fullTokenText.match(/`([^`]+)`/);
                    if (addressMatch && addressMatch.length === 2) {
                        issuer = addressMatch[1];
                        
                        // We need to get the currency from the message or lookup by issuer
                        const tokenInfoService = require('../services/tokenInfoService');
                        const tokenData = await tokenInfoService.findTokenByPrefix('', issuer);
                        if (tokenData.success) {
                            currency = tokenData.currency;
                        }
                    }
                }
                
                // If we still don't have both currency and issuer, we can't process the vote
                if (!currency || !issuer) {
                    return bot.answerCallbackQuery(callbackQuery.id, '❌ Unable to identify token. Please try again.');
                }
            }
            
            // Use the token service to record the vote
            const tokenService = require('../services/tokenService');
            const tokenAddress = `${currency}:${issuer}`;
            const result = tokenService.addCommunityVote(tokenAddress, userId, isUpvote);
            
            if (result.success) {
                // Show success message with bull/bear emojis instead of thumbs
                const emoji = isUpvote ? '🐂' : '🐻';
                await bot.answerCallbackQuery(callbackQuery.id, `${emoji} ${result.message}`);
                
                // If the message contains a token description, update it to show new vote counts
                if (callbackQuery.message && callbackQuery.message.text && 
                    callbackQuery.message.text.includes('INNER CIRCLE ANALYSIS')) {
                    try {
                            // Get token information again to refresh the message
                        const tokenInfoService = require('../services/tokenInfoService');
                            const tokenResult = await tokenInfoService.getTokenInformation(currency, issuer);
                            
                            if (tokenResult.success) {
                                // Format the token description with updated vote counts
                                const formattedDescription = tokenInfoService.formatTokenDescription(tokenResult);
                                
                                // Keep the same inline keyboard
                                await bot.editMessageText(formattedDescription, {
                                    chat_id: callbackQuery.message.chat.id,
                                    message_id: callbackQuery.message.message_id,
                                    parse_mode: 'Markdown',
                                reply_markup: callbackQuery.message.reply_markup,
                                disable_web_page_preview: true
                                });
                        }
                    } catch (updateError) {
                        console.error('Error updating message after vote:', updateError);
                    }
                }
                
                // Check if we should notify admins
                if (result.shouldNotifyAdmins) {
                    // Notify admins that this token has reached the voting threshold
                    try {
                        const config = require('../config');
                        const adminChatId = config.adminChatId;
                        
                        if (adminChatId) {
                            const token = result.votes;
                            const totalVotes = token.upvotes + token.downvotes;
                            const upvotePercentage = (token.upvotes / totalVotes) * 100;
                            
                            const adminMessage = `🔔 *Token Voting Alert*\n\n` +
                                `*Token:* \`${tokenAddress}\`\n\n` +
                                `*Community Votes:* 🐂 ${token.upvotes} (${upvotePercentage.toFixed(1)}%) | 🐻 ${token.downvotes}\n\n` +
                                `Consider reviewing this token for community listing.`;
                            
                            await bot.sendMessage(adminChatId, adminMessage, {
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    inline_keyboard: [
                                        [
                                            { text: "✅ Approve", callback_data: `approve_token:${tokenAddress}` },
                                            { text: "❌ Reject", callback_data: `reject_token:${tokenAddress}` }
                                        ]
                                    ]
                                }
                            });
                        }
                    } catch (error) {
                        console.error('Error notifying admins:', error);
                    }
                }
            } else {
                // Show error message
                await bot.answerCallbackQuery(callbackQuery.id, result.message);
            }
        } catch (error) {
            console.error('Error handling like/dislike callback:', error);
            await bot.answerCallbackQuery(callbackQuery.id, 'Error recording your vote. Please try again.');
        }
    }
    else if (data.startsWith('approve_token:') || data.startsWith('reject_token:')) {
        try {
            // Extract token data from callback data
            const parts = data.split(':');
            if (parts.length < 2) {
                return bot.answerCallbackQuery(callbackQuery.id, 'Invalid token data');
            }
            
            const isApproval = data.startsWith('approve_token:');
            let currency, issuer;
            
            // Handle different formats
            if (parts.length === 3) {
                // Format: approve_token:currency:issuer
                currency = parts[1];
                issuer = parts[2];
            } else {
                // Format: approve_token:contractAddress
                const contractAddress = data.substring(data.indexOf(':') + 1);
                // Try to parse as currency.issuer
                const contractParts = contractAddress.split('.');
                if (contractParts.length === 2) {
                    currency = contractParts[0];
                    issuer = contractParts[1];
                } else {
                    return bot.answerCallbackQuery(callbackQuery.id, 'Invalid token format');
                }
            }
            
            const userId = callbackQuery.from.id.toString();
            
            // Check if user is an admin
            const config = require('../config');
            if (!config.admins.includes(userId)) {
                return bot.answerCallbackQuery(callbackQuery.id, '⚠️ Only admins can approve or reject tokens');
            }
            
            if (isApproval) {
                // Admin approval logic
                await bot.answerCallbackQuery(callbackQuery.id, '✅ Token approved');
                
                // Send to master channel if configured
                try {
                    const masterChannelService = require('../services/masterChannelService');
                    const masterChannelId = masterChannelService.getMasterChannelId();
                    
                    if (masterChannelId) {
                        // Get token information
                        const tokenResult = await tokenInfoService.getTokenInformation(currency, issuer);
                        if (tokenResult.success) {
                            // Format token description
                            const formattedDescription = tokenInfoService.formatTokenDescription(tokenResult);
                            
                            // Try to send image with token from XRPLMeta after the text (optional)
                            try {
                                // Corrected URL format - removed /api/v1/ path segment
                                const xrplMetaIconUrl = `https://api.xrplmeta.org/icon/${currency}.${issuer}`;
                                console.log(`Attempting to send token image from URL: ${xrplMetaIconUrl}`);
                                
                                await bot.sendPhoto(masterChannelId, xrplMetaIconUrl, {
                                    parse_mode: 'Markdown'
                                });
                                
                                console.log(`Successfully sent token image for ${currency}:${issuer}`);
                            } catch (imageError) {
                                console.error(`Error sending token image for ${currency}:${issuer} (Format 1):`, imageError.message);
                                
                                // For specific error types, try an alternative format
                                if (imageError.code === 'ETELEGRAM' || imageError.response?.statusCode === 400) {
                                    try {
                                        // Try alternative format with + instead of .
                                        const altXrplMetaIconUrl = `https://api.xrplmeta.org/icon/${currency}+${issuer}`;
                                        console.log(`Attempting alternative token image URL: ${altXrplMetaIconUrl}`);
                                        
                                        await bot.sendPhoto(masterChannelId, altXrplMetaIconUrl, {
                                            parse_mode: 'Markdown'
                                        });
                                        
                                        console.log(`Successfully sent alternative token image for ${currency}:${issuer}`);
                                    } catch (altImageError) {
                                        console.error(`Error sending token image for ${currency}:${issuer} (Format 2):`, altImageError.message);
                                        
                                        // Try third fallback with XRPScan icon
                                        try {
                                            const xrpscanIconUrl = `https://xrpscan.com/static/icons/currency/${issuer}.png`;
                                            console.log(`Attempting XRPScan token image URL: ${xrpscanIconUrl}`);
                                            
                                            await bot.sendPhoto(masterChannelId, xrpscanIconUrl, {
                                                parse_mode: 'Markdown'
                                            });
                                            
                                            console.log(`Successfully sent XRPScan token image for ${currency}:${issuer}`);
                                        } catch (finalImageError) {
                                            console.error(`All image formats failed for ${currency}:${issuer}:`, finalImageError.message);
                                        }
                                    }
                                }
                                // Continue even if image fails - we already sent the text message
                            }
                            
                            // Send to master channel
                            await bot.sendMessage(masterChannelId, 
                                `✅ *New Community-Approved Token!*\n\n${formattedDescription}`, 
                                {
                                    parse_mode: 'Markdown',
                                    reply_markup: {
                                        inline_keyboard: [
                                            [
                                                { text: "👍 Upvote", callback_data: `upv:${currency.substring(0, 8)}:${issuer.substring(0, 8)}` },
                                                { text: "👎 Downvote", callback_data: `dwv:${currency.substring(0, 8)}:${issuer.substring(0, 8)}` }
                                            ],
                                            [
                                                { text: "📊 View Details", callback_data: `xrpl_token_info:${currency}:${issuer}` }
                                            ]
                                        ]
                                    },
                                    disable_web_page_preview: true
                                }
                            );
                        }
                    }
                } catch (error) {
                    console.error('Error sending to master channel:', error);
                }
            } else {
                // Handle rejection if needed
                await bot.answerCallbackQuery(callbackQuery.id, '❌ Token rejected');
            }
        } catch (error) {
            console.error('Error handling token approval/rejection:', error);
            await bot.answerCallbackQuery(callbackQuery.id, 'Error processing approval/rejection. Please try again.');
        }
    }
};

/**
 * Process social URL submissions from users
 * This function should be called whenever a message is received
 */
const processSocialUrlSubmission = async (msg) => {
    // Check if there's a pending social input for this user
    if (!global.pendingSocialInputs || !global.pendingSocialInputs[msg.from.id.toString()]) {
        return false; // No pending social input
    }
    
    // Get the pending social input data
    const pendingInput = global.pendingSocialInputs[msg.from.id.toString()];
    
    // Check if the pending input is too old (e.g., more than 10 minutes)
    if (Date.now() - pendingInput.timestamp > 10 * 60 * 1000) {
        delete global.pendingSocialInputs[msg.from.id.toString()];
        await bot.sendMessage(msg.chat.id, '❌ Your social input request has expired. Please try again.', {
            reply_to_message_id: msg.message_id
        });
        return true;
    }
    
    // Check if the user is cancelling
    if (msg.text && msg.text.toLowerCase() === '/cancel') {
        delete global.pendingSocialInputs[msg.from.id.toString()];
        await bot.sendMessage(msg.chat.id, '✅ Social link submission cancelled.', {
            reply_to_message_id: msg.message_id
        });
        return true;
    }
    
    // Validate URL format
    if (!msg.text || !isValidUrl(msg.text)) {
        await bot.sendMessage(msg.chat.id, '❌ Invalid URL format. Please provide a valid URL or type /cancel to abort.', {
            reply_to_message_id: msg.message_id
        });
        return true;
    }
    
    // Process based on the current step
    try {
        const url = msg.text.trim();
        const { step, currencyPrefix, issuerPrefix } = pendingInput;
        
        if (step === 'twitter') {
            // Store Twitter URL and move to Telegram step
            pendingInput.twitter = url;
            pendingInput.step = 'telegram';
            
            await bot.sendMessage(msg.chat.id, 
                "📱 *Social Information Collection - Step 2/3*\n\n" +
                "Twitter URL saved! Now please send the Telegram group URL for this token (e.g., https://t.me/example)\n\n" +
                "Type /cancel at any time to abort the process.",
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        force_reply: true,
                        selective: true
                    }
                }
            );
            
            return true;
        }
        else if (step === 'telegram') {
            // Store Telegram URL and move to Website step
            pendingInput.telegram = url;
            pendingInput.step = 'website';
            
            await bot.sendMessage(msg.chat.id, 
                "📱 *Social Information Collection - Step 3/3*\n\n" +
                "Telegram URL saved! Now please send the Website URL for this token (e.g., https://example.com)\n\n" +
                "Type /cancel at any time to abort the process.",
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        force_reply: true,
                        selective: true
                    }
                }
            );
            
            return true;
        } 
        else if (step === 'website') {
            // Store Website URL and complete the process
            pendingInput.website = url;
            
            // Save all social information to the database
            try {
                // Look up full currency and issuer - in a real implementation
                // For this example, we'll just use the prefixes as is
                const currency = currencyPrefix;
                const issuer = issuerPrefix;
                
                // Save the social information
                const result = await tokenDiscoveryService.addTokenSocials(
                    currency, 
                    issuer, 
                    {
                        twitter: pendingInput.twitter,
                        telegram: pendingInput.telegram,
                        website: url
                    },
                    msg.from.id.toString()
                );
                
                if (result.success) {
                    // Check if this user is the first finder and prompt for wallet
                    const discoveryResult = await tokenDiscoveryService.getTokenDiscovery(currency, issuer);
                    const isFirstFinder = discoveryResult.success && 
                                        discoveryResult.discovery && 
                                        discoveryResult.discovery.firstFinderUserId === msg.from.id.toString();
                    
                    // Thank the user for providing social information
                    await bot.sendMessage(msg.chat.id, 
                        "✅ *Social Information Collection Complete!*\n\n" +
                        "Thank you for providing complete social information for this token. " +
                        "This will help other users discover more about it.",
                        {
                            parse_mode: 'Markdown'
                        }
                    );
                    
                    // If first finder, prompt for wallet
                    if (isFirstFinder) {
                        // Set up wallet collection
                        global.pendingWalletInputs[msg.from.id.toString()] = {
                            currency,
                            issuer,
                            timestamp: Date.now()
                        };
                        
                        // Move to wallet collection
                        delete global.pendingSocialInputs[msg.from.id.toString()];
                        
                        await bot.sendMessage(msg.chat.id, 
                            "💰 *Add Your Wallet for Tips*\n\n" +
                            "Since you're the first to discover this token, would you like to add your XRPL wallet address to receive tips from other users?\n\n" +
                            "Reply with your XRPL wallet address or type /skip to continue without adding one.",
                            {
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    force_reply: true,
                                    selective: true
                                }
                            }
                        );
                    } else {
                        // Clean up
                        delete global.pendingSocialInputs[msg.from.id.toString()];
                        
                        // Show token info
                        await bot.sendMessage(msg.chat.id, 
                            "Would you like to see the updated token information?",
                            {
                                reply_markup: {
                                    inline_keyboard: [
                                        [
                                            { text: "Yes, show me", callback_data: `tok:${currencyPrefix}:${issuerPrefix}` }
                                        ]
                                    ]
                                }
                            }
                        );
                    }
                } else {
                    await bot.sendMessage(msg.chat.id, `❌ Error saving social information: ${result.message}`, {
                        reply_to_message_id: msg.message_id
                    });
                    
                    // Clean up
                    delete global.pendingSocialInputs[msg.from.id.toString()];
                }
            } catch (error) {
                console.error('Error saving social information:', error);
                await bot.sendMessage(msg.chat.id, '❌ An error occurred while saving the social information. Please try again later.');
                
                // Clean up
                delete global.pendingSocialInputs[msg.from.id.toString()];
            }
            
            return true;
        }
        
        return true;
    } catch (error) {
        console.error('Error processing social URL:', error);
        await bot.sendMessage(msg.chat.id, '❌ An error occurred while processing your input. Please try again later.');
        
        // Clean up on error
        delete global.pendingSocialInputs[msg.from.id.toString()];
        return true;
    }
};

/**
 * Helper function to validate URLs
 */
function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

/**
 * Process wallet address submissions from users
 * This function should be called whenever a message is received
 */
const processWalletAddressSubmission = async (msg) => {
    // Check if there's a pending wallet input for this user
    if (!global.pendingWalletInputs || !global.pendingWalletInputs[msg.from.id.toString()]) {
        return false; // No pending wallet input
    }
    
    // Get the pending input data
    const pendingInput = global.pendingWalletInputs[msg.from.id.toString()];
    
    // Check if the pending input is too old (e.g., more than 5 minutes)
    if (Date.now() - pendingInput.timestamp > 5 * 60 * 1000) {
        delete global.pendingWalletInputs[msg.from.id.toString()];
        await bot.sendMessage(msg.chat.id, '⏱️ Wallet address request expired. You can add it later.');
        return true;
    }
    
    // Check if user is skipping
    if (msg.text && msg.text.toLowerCase() === '/skip') {
        delete global.pendingWalletInputs[msg.from.id.toString()];
        await bot.sendMessage(msg.chat.id, '👍 No problem! You can add your wallet address later if you change your mind.');
        return true;
    }
    
    // Validate wallet address format
    if (!msg.text || !xrplService.isValidXRPLAddress(msg.text)) {
        await bot.sendMessage(msg.chat.id, '❌ Invalid XRPL wallet address. Please provide a valid address or type /skip to continue without adding one.');
        return true;
    }
    
    // Save the wallet address
    try {
        const { currency, issuer } = pendingInput;
        const walletAddress = msg.text.trim();
        
        // Save the wallet address
        const result = await tokenDiscoveryService.addFinderWallet(
            currency, 
            issuer, 
            msg.from.id.toString(), 
            walletAddress
        );
        
        // Clean up
        delete global.pendingWalletInputs[msg.from.id.toString()];
        
        if (result.success) {
            await bot.sendMessage(msg.chat.id, 
                "💰 *Wallet Added Successfully!*\n\n" +
                "Your wallet address has been saved. Other users can now send you tips for discovering this token!",
                {
                    parse_mode: 'Markdown'
                }
            );
            
            // Show token info
            await bot.sendMessage(msg.chat.id, 
                "Would you like to see the updated token information?",
                {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "Yes, show me", callback_data: `tok:${currency.substring(0, 10)}:${issuer.substring(0, 10)}` }
                            ]
                        ]
                    }
                }
            );
        } else {
            await bot.sendMessage(msg.chat.id, `❌ Error adding wallet address: ${result.message}`);
        }
        
        return true;
    } catch (error) {
        console.error('Error saving wallet address:', error);
        await bot.sendMessage(msg.chat.id, '❌ An error occurred while saving your wallet address. Please try again later.');
        
        // Clean up on error
        delete global.pendingWalletInputs[msg.from.id.toString()];
        return true;
    }
};

module.exports = {
    initializeCommands,
    handleScanCommand,
    handleSocialCommand,
    handleTwitterCommand,
    handleConnectionTestCommand,
    handleXrplTokenCommand,
    handleXrplSearchCommand,
    handleXrplHoldersCommand,
    handleXrplCallbackQuery,
    processSocialUrlSubmission,
    processWalletAddressSubmission
}; 