const axios = require('axios');

// Rate limiting configuration
const RATE_LIMIT = {
    maxRequests: 30,
    requestDelay: 2000,
    lastRequestTime: 0
};

// Base URL for DexScreener API
const BASE_URL = 'https://api.dexscreener.com/latest/dex';

// Helper function to enforce rate limiting
async function enforceRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - RATE_LIMIT.lastRequestTime;
    
    if (timeSinceLastRequest < RATE_LIMIT.requestDelay) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT.requestDelay - timeSinceLastRequest));
    }
    
    RATE_LIMIT.lastRequestTime = Date.now();
}

// Helper function to make API requests with rate limiting
async function makeRequest(endpoint, params = {}) {
    await enforceRateLimit();
    
    const url = `${BASE_URL}${endpoint}`;
    console.log('Making DexScreener API request to', url, 'with params:', params);
    
    try {
        const response = await axios.get(url, { params });
        return response.data;
    } catch (error) {
        console.error(`DexScreener API error (${endpoint.slice(1)}):`, error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
            console.error('Response status:', error.response.status);
        }
        return null;
    }
}

// Normalize token information
function normalizeToken(token) {
    if (!token) return null;
    return {
        name: token.name || 'Unknown',
        symbol: token.symbol || '',
        address: token.address || null,
        decimals: token.decimals || 0,
        imageUrl: token.logoURI || null
    };
}

// Normalize pair information
function normalizePair(pair) {
    if (!pair) return null;
    
    const normalized = {
        pairId: pair.pairAddress || pair.id,
        baseToken: normalizeToken(pair.baseToken),
        quoteToken: normalizeToken(pair.quoteToken),
        priceUsd: pair.priceUsd || '0',
        priceChange: {
            m5: pair.priceChange?.m5 || '0',
            h1: pair.priceChange?.h1 || 0,
            h6: pair.priceChange?.h6 || 0,
            h24: pair.priceChange?.h24 || 0
        },
        liquidity: {
            usd: pair.liquidity?.usd || 0,
            base: pair.liquidity?.base || 0,
            quote: pair.liquidity?.quote || 0
        },
        volume: {
            m5: pair.volume?.m5 || '0',
            h1: pair.volume?.h1 || 0,
            h6: pair.volume?.h6 || 0,
            h24: pair.volume?.h24 || 0
        },
        createdAt: pair.pairCreatedAt || null,
        dexId: pair.dexId || '',
        url: pair.url || ''
    };

    // Add token information if available
    if (pair.baseToken) {
        normalized.baseToken.imageUrl = pair.baseToken.logoURI || null;
        normalized.info = {
            imageUrl: pair.baseToken.logoURI || null,
            websites: [],
            socials: []
        };

        // Add website information
        if (pair.baseToken.website) {
            normalized.info.websites.push({
                label: 'Website',
                url: pair.baseToken.website
            });
        }

        // Add social media information
        if (pair.baseToken.twitter) {
            normalized.info.socials.push({
                type: 'twitter',
                url: pair.baseToken.twitter.startsWith('http') ? pair.baseToken.twitter : `https://twitter.com/${pair.baseToken.twitter}`
            });
        }
        if (pair.baseToken.telegram) {
            normalized.info.socials.push({
                type: 'telegram',
                url: pair.baseToken.telegram.startsWith('http') ? pair.baseToken.telegram : `https://t.me/${pair.baseToken.telegram}`
            });
        }
    }

    return normalized;
}

// Get new pairs for XRPL
async function getNewPairs(limit = 10) {
    const data = await makeRequest('/search', { q: 'chain:xrpl newpairs' });
    if (!data || !data.pairs) return [];
    
    const pairs = data.pairs
        .filter(pair => pair.chainId === 'xrpl')
        .sort((a, b) => new Date(b.pairCreatedAt) - new Date(a.pairCreatedAt))
        .slice(0, limit);
    
    return pairs.map(normalizePair).filter(Boolean);
}

// Get all pairs for XRPL
async function getAllPairs() {
    const data = await makeRequest('/search', { q: 'chain:xrpl' });
    if (!data || !data.pairs) return [];
    
    return data.pairs
        .filter(pair => pair.chainId === 'xrpl')
        .map(normalizePair)
        .filter(Boolean);
}

// Search pairs by symbol
async function searchPairsBySymbol(symbol) {
    const data = await makeRequest('/search', { q: `${symbol} chain:ripple` });
    if (!data || !data.pairs) return [];
    
    return data.pairs.map(normalizePair).filter(Boolean);
}

// Get pair by address
async function getPairByAddress(address) {
    const data = await makeRequest('/search', { q: address });
    if (!data || !data.pairs || !data.pairs.length) {
        console.log('No data returned from DexScreener API');
        return null;
    }
    
    return normalizePair(data.pairs[0]);
}

module.exports = {
    getNewPairs,
    getAllPairs,
    searchPairsBySymbol,
    getPairByAddress
}; 