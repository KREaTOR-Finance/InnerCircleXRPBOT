const axios = require('axios');
const config = require('../config');
const dexscreener = require('./adapters/dexscreenerAdapter');
const xrplDex = require('./adapters/xrplDexAdapter');

/**
 * Parse token data from a pair object
 * @param {Object} pair - The pair object from DexScreener API
 * @returns {Object} Parsed token data
 */
const parseTokenData = (pair) => {
    // Extract social links if available
    const links = {};
    
    if (pair.links) {
        if (pair.links.website) links.website = pair.links.website;
        if (pair.links.telegram) links.telegram = pair.links.telegram;
        if (pair.links.twitter) links.twitter = pair.links.twitter;
        if (pair.links.discord) links.discord = pair.links.discord;
        if (pair.links.medium) links.medium = pair.links.medium;
        if (pair.links.github) links.github = pair.links.github;
    }
    
    // Extract liquidity value properly
    let liquidityValue = 0;
    if (pair.liquidity) {
        if (typeof pair.liquidity === 'object' && pair.liquidity.usd !== undefined) {
            liquidityValue = parseFloat(pair.liquidity.usd);
        } else if (typeof pair.liquidity === 'number') {
            liquidityValue = pair.liquidity;
        } else if (typeof pair.liquidity === 'string') {
            liquidityValue = parseFloat(pair.liquidity);
        }
    }
    
    // Extract logo/image URL
    let logoUrl = null;
    
    // Check for logo in various locations
    if (pair.baseToken?.logoURI) {
        logoUrl = pair.baseToken.logoURI;
    } else if (pair.info?.imageUrl) {
        logoUrl = pair.info.imageUrl;
    } else if (pair.logo) {
        logoUrl = pair.logo;
    } else if (pair.baseToken?.logo) {
        logoUrl = pair.baseToken.logo;
    } else if (pair.baseToken?.image) {
        logoUrl = pair.baseToken.image;
    } else if (pair.baseToken?.icon) {
        logoUrl = pair.baseToken.icon;
    }
    
    // Check if image URL is a base64 string and convert to null if it is
    if (logoUrl && logoUrl.startsWith('data:image')) {
        logoUrl = null;
    }
    
    // Format result
    return {
        contractAddress: pair.baseToken?.address || '',
        name: pair.baseToken?.name || 'Unknown',
        symbol: pair.baseToken?.symbol || 'UNKNOWN',
        price: parseFloat(pair.priceUsd || 0),
        priceChange24h: parseFloat(pair.priceChange?.h24 || 0),
        priceChange7d: parseFloat(pair.priceChange?.h7d || 0),
        volume24h: parseFloat(pair.volume?.h24 || 0),
        marketCap: parseFloat(pair.fdv || 0),
        liquidity: liquidityValue,
        chartUrl: pair.url || '',
        createdAt: pair.pairCreatedAt || null,
        dexId: pair.dexId || '',
        pairAddress: pair.pairAddress || '',
        fdv: parseFloat(pair.fdv || 0),
        links,
        logo: logoUrl
    };
};

/**
 * Get all pairs from DexScreener API
 * @returns {Array} All token pairs
 */
const getAllPairs = async () => {
    try {
        const response = await axios.get(config.dexscreenerApi.allPairs);
        
        if (!response.data || !response.data.pairs) {
            console.error('Invalid response from DexScreener API (getAllPairs)');
            return [];
        }
        
        return response.data.pairs.map(pair => parseTokenData(pair));
    } catch (error) {
        console.error('Error fetching all pairs from DexScreener:', error.message);
        return [];
    }
};

/**
 * Get token by address
 * @param {string} contractAddress - The token contract address
 * @returns {Object|null} Token data or null if not found
 */
const getTokenByAddress = async (contractAddress) => {
    if (!contractAddress) {
        console.error('No contract address provided');
        return null;
    }
    
    try {
        // Try DexScreener first
        const dexscreenerUrl = `${config.dexscreenerApi.pairDetails}/xrpl/${contractAddress}`;
        const response = await axios.get(dexscreenerUrl);
        
        if (response.data && response.data.pairs && response.data.pairs.length > 0) {
            return parseTokenData(response.data.pairs[0]);
        }
        
        // Try XP.Market as a fallback
        const xpMarketToken = await getXPMarketTokenByAddress(contractAddress);
        if (xpMarketToken) {
            return xpMarketToken;
        }
        
        console.log(`Token not found for address: ${contractAddress}`);
        return null;
    } catch (error) {
        console.error(`Error fetching token by address (${contractAddress}):`, error.message);
        
        // Try XP.Market as a fallback
        try {
            const xpMarketToken = await getXPMarketTokenByAddress(contractAddress);
            if (xpMarketToken) {
                return xpMarketToken;
            }
        } catch (fallbackError) {
            console.error(`Error fetching token from XP.Market fallback:`, fallbackError.message);
        }
        
        return null;
    }
};

/**
 * Track token prices for multiple addresses
 * @param {Array} tokenAddresses - Array of token addresses to track
 * @returns {Object} Object with token addresses as keys and price data as values
 */
const trackTokenPrices = async (tokenAddresses) => {
    const result = {};
    
    if (!tokenAddresses || !Array.isArray(tokenAddresses) || tokenAddresses.length === 0) {
        return result;
    }
    
    for (const address of tokenAddresses) {
        try {
            const token = await getTokenByAddress(address);
            
            if (token) {
                result[address] = {
                    price: token.price,
                    priceChange24h: token.priceChange24h,
                    name: token.name,
                    symbol: token.symbol
                };
            }
        } catch (error) {
            console.error(`Error tracking price for ${address}:`, error.message);
        }
    }
    
    return result;
};

/**
 * Search for tokens by name or symbol
 * @param {string} query - The search query
 * @returns {Array} Matching tokens
 */
const searchTokens = async (query) => {
    if (!query || query.trim().length === 0) {
        return [];
    }
    
    try {
        const allPairs = await getAllPairs();
        const searchQueryLower = query.toLowerCase();
        
        return allPairs.filter(token => 
            token.name.toLowerCase().includes(searchQueryLower) || 
            token.symbol.toLowerCase().includes(searchQueryLower)
        );
    } catch (error) {
        console.error('Error searching tokens:', error.message);
        return [];
    }
};

/**
 * Get detailed token info from multiple sources
 * @param {string} contractAddress - The token contract address
 * @returns {Object|null} Detailed token data or null if not found
 */
const getDetailedTokenInfo = async (contractAddress) => {
    try {
        // Get basic token data
        const token = await getTokenByAddress(contractAddress);
        
        if (!token) {
            return null;
        }
        
        // Get additional data from XRPL if needed
        // This is a placeholder for future implementation
        
        return token;
    } catch (error) {
        console.error(`Error getting detailed token info for ${contractAddress}:`, error.message);
        return null;
    }
};

/**
 * Format token for Telegram display
 * @param {Object} token - The token object
 * @returns {string} Formatted message for Telegram
 */
const formatTokenForTelegram = (token) => {
    if (!token) {
        return 'Token data not available.';
    }
    
    // Format price with appropriate precision
    const formatPrice = (price) => {
        if (!price || price === 0) return '0';
        
        if (price < 0.000001) {
            return price.toExponential(4);
        } else if (price < 0.0001) {
            return price.toFixed(8);
        } else if (price < 0.01) {
            return price.toFixed(6);
        } else if (price < 1) {
            return price.toFixed(4);
        } else {
            return price.toFixed(2);
        }
    };
    
    // Format percentage
    const formatPercentage = (value) => {
        if (!value || isNaN(value)) return '0%';
        return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
    };
    
    // Format number with commas
    const formatNumber = (num) => {
        if (!num || isNaN(num)) return '0';
        
        if (num > 1000000000) {
            return `$${(num / 1000000000).toFixed(2)}B`;
        } else if (num > 1000000) {
            return `$${(num / 1000000).toFixed(2)}M`;
        } else if (num > 1000) {
            return `$${(num / 1000).toFixed(2)}K`;
        } else {
            return `$${num.toFixed(2)}`;
        }
    };
    
    // Build message
    let message = `*${token.name} (${token.symbol})*\n\n`;
    message += `💰 *Price*: $${formatPrice(token.price)}\n`;
    
    if (token.priceChange24h) {
        message += `📈 *24h Change*: ${formatPercentage(token.priceChange24h)}\n`;
    }
    
    if (token.marketCap && token.marketCap > 0) {
        message += `🧢 *Market Cap*: ${formatNumber(token.marketCap)}\n`;
    }
    
    if (token.liquidity && token.liquidity > 0) {
        message += `💧 *Liquidity*: ${formatNumber(token.liquidity)}\n`;
    }
    
    if (token.contractAddress) {
        message += `📝 *Contract*: \`${token.contractAddress}\`\n`;
    }
    
    // Add chart link if available
    if (token.chartUrl) {
        message += `\n[📊 View Chart](${token.chartUrl})\n`;
    }
    
    return message;
};

/**
 * Format XRPL address for display
 * @param {string} address - The XRPL address
 * @param {string} currency - Optional currency code
 * @returns {string} Formatted address
 */
const formatXRPLAddress = (address, currency = null) => {
    if (!address) return '';
    
    // For long addresses, show first 6 and last 6 characters
    if (address.length > 15) {
        const shortened = `${address.substring(0, 6)}...${address.substring(address.length - 6)}`;
        return currency ? `${shortened} (${currency})` : shortened;
    }
    
    return currency ? `${address} (${currency})` : address;
};

/**
 * Get the most recent tokens
 * @param {number} limit - Maximum number of tokens to return
 * @returns {Array} Recent tokens
 */
const getMostRecentTokens = async (limit = 5) => {
    try {
        const allPairs = await getAllPairs();
        
        if (!allPairs || allPairs.length === 0) {
            return [];
        }
        
        // Filter out tokens without creation date
        const tokensWithDate = allPairs.filter(token => token.createdAt);
        
        // Sort by creation date descending
        tokensWithDate.sort((a, b) => {
            const dateA = new Date(a.createdAt);
            const dateB = new Date(b.createdAt);
            return dateB - dateA;
        });
        
        // Return limited number
        return tokensWithDate.slice(0, limit);
    } catch (error) {
        console.error('Error getting most recent tokens:', error.message);
        return [];
    }
};

/**
 * Add a community vote for a token
 * @param {string} tokenAddress - Token contract address
 * @param {string} userId - User ID
 * @param {boolean} isUpvote - Whether the vote is an upvote
 * @returns {Object} Result of the operation
 */
const addCommunityVote = (tokenAddress, userId, isUpvote) => {
    try {
        // This is a placeholder for a future database implementation
        // For now, we'll just return a mock result
        
        return {
            success: true,
            message: `Your ${isUpvote ? 'upvote' : 'downvote'} has been recorded.`
        };
    } catch (error) {
        console.error(`Error adding community vote for ${tokenAddress}:`, error.message);
        return {
            success: false,
            message: 'Failed to record your vote. Please try again.'
        };
    }
};

/**
 * Get community votes for a token
 * @param {string} tokenAddress - Token contract address
 * @returns {Object} Vote counts
 */
const getCommunityVotes = (tokenAddress) => {
    try {
        // This is a placeholder for a future database implementation
        // For now, we'll just return mock data
        
        return {
            upvotes: Math.floor(Math.random() * 50),
            downvotes: Math.floor(Math.random() * 10)
        };
    } catch (error) {
        console.error(`Error getting community votes for ${tokenAddress}:`, error.message);
        return {
            upvotes: 0,
            downvotes: 0
        };
    }
};

/**
 * Format community votes for display
 * @param {string} tokenAddress - Token contract address
 * @returns {string} Formatted vote string
 */
const formatCommunityVotes = (tokenAddress) => {
    const { upvotes, downvotes } = getCommunityVotes(tokenAddress);
    return `👍 ${upvotes} | 👎 ${downvotes}`;
};

/**
 * Get all community votes
 * @returns {Object} All vote data
 */
const getAllCommunityVotes = () => {
    try {
        // This is a placeholder for a future database implementation
        // For now, we'll just return an empty object
        
        return {};
    } catch (error) {
        console.error('Error getting all community votes:', error.message);
        return {};
    }
};

/**
 * Parse token data from XP.Market
 * @param {Object} token - The token data from XP.Market
 * @returns {Object} Parsed token data
 */
const parseXPMarketTokenData = (token) => {
    // Extract necessary data
    const contractAddress = token.contract_address || '';
    
    // Determine token name and symbol
    let name = token.name || 'Unknown';
    let symbol = token.symbol || 'UNKNOWN';
    
    // Default values for missing data
    const price = parseFloat(token.price || 0);
    const priceChange24h = parseFloat(token.price_change_24h || 0);
    const priceChange7d = parseFloat(token.price_change_7d || 0);
    const volume24h = parseFloat(token.volume_24h || 0);
    const marketCap = parseFloat(token.market_cap || 0);
    const liquidity = parseFloat(token.liquidity || 0);
    
    // Extract social links if available
    const links = {};
    
    if (token.links) {
        if (token.links.website) links.website = token.links.website;
        if (token.links.telegram) links.telegram = token.links.telegram;
        if (token.links.twitter) links.twitter = token.links.twitter;
        if (token.links.discord) links.discord = token.links.discord;
    }
    
    // Extract logo/image URL
    let logoUrl = token.logo || null;
    
    // Generate chart URL
    const chartUrl = token.chart_url || `https://xrpscan.com/account/${contractAddress}`;
    
    // Format result
    return {
        contractAddress,
        name,
        symbol,
        price,
        priceChange24h,
        priceChange7d,
        volume24h,
        marketCap,
        liquidity,
        chartUrl,
        links,
        logo: logoUrl,
        source: 'xpmarket'
    };
};

/**
 * Get tokens from XP.Market
 * @returns {Array} Tokens from XP.Market
 */
const getXPMarketTokens = async () => {
    try {
        console.log('Fetching tokens from XP.Market...');
        const response = await axios.get(config.xpmarketApi.url);
        
        if (!response.data || !Array.isArray(response.data)) {
            console.error('Invalid response from XP.Market API');
            return [];
        }
        
        console.log(`Found ${response.data.length} tokens from XP.Market`);
        
        return response.data.map(token => parseXPMarketTokenData(token));
    } catch (error) {
        console.error('Error fetching tokens from XP.Market:', error.message);
        return [];
    }
};

/**
 * Get token by address from XP.Market
 * @param {string} address - The token contract address
 * @returns {Object|null} Token data or null if not found
 */
const getXPMarketTokenByAddress = async (address) => {
    if (!address) {
        console.error('No address provided for XP.Market lookup');
        return null;
    }
    
    try {
        const allTokens = await getXPMarketTokens();
        
        if (!allTokens || allTokens.length === 0) {
            return null;
        }
        
        // Clean input address for comparison
        const cleanAddress = address.trim().toLowerCase();
        
        // Find token by address
        const token = allTokens.find(t => 
            t.contractAddress && t.contractAddress.toLowerCase() === cleanAddress
        );
        
        return token || null;
    } catch (error) {
        console.error(`Error getting token by address from XP.Market (${address}):`, error.message);
        return null;
    }
};

/**
 * Display tokens in terminal (for debugging)
 * @param {Array} tokens - Array of tokens to display
 */
const displayTokensInTerminal = (tokens) => {
    if (!tokens || tokens.length === 0) {
        console.log('No tokens to display');
        return;
    }
    
    console.log(`Displaying ${tokens.length} tokens:`);
    console.log('============================================================');
    
    tokens.forEach((token, index) => {
        console.log(`${index + 1}. ${token.name} (${token.symbol})`);
        console.log(`   Address: ${token.contractAddress}`);
        console.log(`   Price: $${token.price}`);
        console.log(`   Market Cap: $${token.marketCap}`);
        console.log(`   Liquidity: $${token.liquidity}`);
        
        if (token.createdAt) {
            const createdDate = new Date(token.createdAt);
            console.log(`   Created: ${createdDate.toLocaleString()}`);
        }
        
        console.log('------------------------------------------------------------');
    });
};

/**
 * Get token by address with fallback options
 * @param {string} address - The token contract address
 * @returns {Object|null} Token data or null if not found
 */
const getTokenByAddressWithFallback = async (address) => {
    if (!address) {
        console.error('No address provided for token lookup');
        return null;
    }
    
    try {
        // Try DexScreener first
        console.log(`Looking up token by address: ${address} (DexScreener)`);
        const token = await getTokenByAddress(address);
        
        if (token) {
            console.log(`Found token via DexScreener: ${token.name} (${token.symbol})`);
            return token;
        }
        
        // Try XP.Market as a fallback
        console.log(`Token not found on DexScreener, trying XP.Market for: ${address}`);
        const xpMarketToken = await getXPMarketTokenByAddress(address);
        
        if (xpMarketToken) {
            console.log(`Found token via XP.Market: ${xpMarketToken.name} (${xpMarketToken.symbol})`);
            return xpMarketToken;
        }
        
        // If still not found, try XRPL directly
        // This could be implemented in the future
        
        console.log(`Token not found by address: ${address}`);
        return null;
    } catch (error) {
        console.error(`Error in getTokenByAddressWithFallback (${address}):`, error.message);
        return null;
    }
};

module.exports = {
    parseTokenData,
    getAllPairs,
    getTokenByAddress,
    trackTokenPrices,
    searchTokens,
    getDetailedTokenInfo,
    formatTokenForTelegram,
    formatXRPLAddress,
    getMostRecentTokens,
    addCommunityVote,
    getCommunityVotes,
    formatCommunityVotes,
    getAllCommunityVotes,
    parseXPMarketTokenData,
    getXPMarketTokens,
    getXPMarketTokenByAddress,
    displayTokensInTerminal,
    getTokenByAddressWithFallback
}; 