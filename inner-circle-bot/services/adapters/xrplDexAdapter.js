const axios = require('axios');

// Base URL for XRPL DEX API
const BASE_URL = 'https://api.onthedex.live/public/v1';

// Rate limiting configuration
const RATE_LIMIT = {
    maxRequests: 30,
    requestDelay: 2000,
    lastRequestTime: 0
};

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
    console.log('Making XRPL DEX API request to', url, 'with params:', params);
    
    try {
        const response = await axios.get(url, { params });
        return response.data;
    } catch (error) {
        console.error(`XRPL DEX API error (${endpoint}):`, error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
            console.error('Response status:', error.response.status);
        }
        return null;
    }
}

// Normalize token information to match DexScreener format
function normalizeToken(token) {
    if (!token) return null;
    
    return {
        name: token.token_name || token.currency || 'Unknown',
        symbol: token.currency || '',
        address: token.issuer || null,
        decimals: 0, // XRPL uses drops, we'll handle conversion if needed
        imageUrl: token.logo_file || null
    };
}

// Normalize pair information to match DexScreener format
function normalizePair(pair) {
    if (!pair) return null;
    
    const baseToken = normalizeToken({
        token_name: pair.base_token_name || pair.currency,
        currency: pair.currency,
        issuer: pair.issuer,
        logo_file: pair.logo_file
    });
    
    const quoteToken = {
        name: 'XRP',
        symbol: 'XRP',
        address: null,
        decimals: 6,
        imageUrl: null
    };
    
    const normalized = {
        pairId: `${pair.currency}:${pair.issuer}`,
        baseToken,
        quoteToken,
        priceUsd: pair.price_mid_usd?.toString() || '0',
        priceChange: {
            m5: 0, // XRPL DEX API doesn't provide these granular changes
            h1: 0,
            h6: 0,
            h24: pair.price_change_24h || 0
        },
        liquidity: {
            usd: pair.liquidity_usd || 0,
            base: pair.supply || 0,
            quote: 0 // Would need to calculate based on price and supply
        },
        volume: {
            m5: '0',
            h1: 0,
            h6: 0,
            h24: pair.volume_usd || 0
        },
        createdAt: new Date(pair.last_trade_at || Date.now()).getTime(),
        dexId: 'xrpl',
        url: `https://onthedex.live/market/${pair.currency}:${pair.issuer}`
    };

    // Add token information
    normalized.info = {
        imageUrl: pair.logo_file || null,
        websites: [],
        socials: []
    };

    return normalized;
}

// Get new pairs from XRPL DEX
async function getNewPairs(limit = 10) {
    const data = await makeRequest('/daily/pairs');
    if (!data || !Array.isArray(data.pairs)) return [];
    
    const pairs = data.pairs
        .sort((a, b) => new Date(b.last_trade_at) - new Date(a.last_trade_at))
        .slice(0, limit);
    
    return pairs.map(normalizePair).filter(Boolean);
}

// Get all pairs from XRPL DEX
async function getAllPairs() {
    const data = await makeRequest('/daily/pairs');
    if (!data || !Array.isArray(data.pairs)) return [];
    
    return data.pairs.map(normalizePair).filter(Boolean);
}

// Search pairs by symbol
async function searchPairsBySymbol(symbol) {
    const data = await makeRequest('/daily/pairs', { token: symbol });
    if (!data || !Array.isArray(data.pairs)) return [];
    
    return data.pairs.map(normalizePair).filter(Boolean);
}

// Get pair by address
async function getPairByAddress(address) {
    const [currency, issuer] = address.split(':');
    if (!currency || !issuer) {
        console.log('Invalid XRPL address format');
        return null;
    }
    
    const data = await makeRequest('/daily/pairs', { token: `${currency}.${issuer}` });
    if (!data || !Array.isArray(data.pairs) || !data.pairs.length) {
        console.log('No data returned from XRPL DEX API');
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