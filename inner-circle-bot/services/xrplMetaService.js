const axios = require('axios');
const WebSocket = require('ws');

// XRPL Meta API configuration
const XRPLMETA_API_BASE = 'https://s1.xrplmeta.org';
const XRPLMETA_WS_URL = 'wss://s1.xrplmeta.org';

// WebSocket connection management
let ws = null;
let isConnecting = false;
let commandQueue = [];
let nextId = 1;
let pendingCommands = {};

/**
 * Initialize WebSocket connection to XRPLMeta
 * @returns {Promise} Resolves when connection is established
 */
async function initializeWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        return;
    }

    if (isConnecting) {
        // Wait for the connection to be established
        return new Promise((resolve, reject) => {
            const checkInterval = setInterval(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    clearInterval(checkInterval);
                    resolve();
                } else if (!isConnecting) {
                    clearInterval(checkInterval);
                    reject(new Error('WebSocket connection failed'));
                }
            }, 100);
        });
    }

    isConnecting = true;
    return new Promise((resolve, reject) => {
        try {
            console.log('Initializing WebSocket connection to XRPLMeta...');
            ws = new WebSocket(XRPLMETA_WS_URL);

            ws.on('open', () => {
                console.log('WebSocket connection established with XRPLMeta');
                isConnecting = false;
                
                // Set up message handler
                ws.on('message', (data) => {
                    try {
                        const message = JSON.parse(data);
                        const id = message.id;
                        
                        if (id && pendingCommands[id]) {
                            const { resolve, reject } = pendingCommands[id];
                            
                            if (message.error) {
                                reject(new Error(message.error.message || 'Unknown error'));
                            } else {
                                resolve(message);
                            }
                            
                            delete pendingCommands[id];
                        }
                    } catch (error) {
                        console.error('Error parsing WebSocket message:', error);
                    }
                });
                
                // Process any queued commands
                while (commandQueue.length > 0) {
                    const { command, resolve: queuedResolve, reject: queuedReject } = commandQueue.shift();
                    sendCommand(command).then(queuedResolve).catch(queuedReject);
                }
                
                resolve();
            });

            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                isConnecting = false;
                reject(error);
            });

            ws.on('close', () => {
                console.log('WebSocket connection closed');
                ws = null;
            });
        } catch (error) {
            console.error('Error initializing WebSocket:', error);
            isConnecting = false;
            reject(error);
        }
    });
}

/**
 * Send command to XRPLMeta via WebSocket
 * @param {Object} command - Command to send
 * @returns {Promise} Response from XRPLMeta
 */
async function sendCommand(command) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        if (isConnecting) {
            // Queue command if connection is in progress
            return new Promise((resolve, reject) => {
                commandQueue.push({ command, resolve, reject });
            });
        }
        
        try {
            await initializeWebSocket();
        } catch (error) {
            console.error('Failed to initialize WebSocket:', error);
            throw error;
        }
    }

    return new Promise((resolve, reject) => {
        const id = nextId++;
        const messageWithId = { id, ...command };
        
        pendingCommands[id] = { resolve, reject };
        
        ws.send(JSON.stringify(messageWithId));
    });
}

/**
 * Convert hex currency code to readable form
 * @param {string} hexCurrency - Hex currency code
 * @returns {string} Human-readable currency code
 */
function hexToReadableCurrency(hexCurrency) {
    if (!hexCurrency || hexCurrency.length !== 40) {
        return hexCurrency;
    }
    
    try {
        // For XRP standard hex currency format
        const bytes = Buffer.from(hexCurrency, 'hex');
        
        // Check if it's all 0s or non-printable chars
        let isAllZeros = true;
        let isPrintable = true;
        
        for (let i = 0; i < bytes.length; i++) {
            if (bytes[i] !== 0) {
                isAllZeros = false;
            }
            
            // ASCII printable range is 32-126
            if (bytes[i] < 32 || bytes[i] > 126) {
                isPrintable = false;
            }
        }
        
        if (isAllZeros) {
            return 'XRP';
        }
        
        if (isPrintable) {
            const readable = bytes.toString('utf8').replace(/\0/g, '').trim();
            if (readable) {
                return readable;
            }
        }
        
        return hexCurrency;
    } catch (error) {
        console.error('Error converting hex currency:', error);
        return hexCurrency;
    }
}

/**
 * List all tokens from XRPLMeta
 * @param {Object} options - Request options
 * @returns {Promise} List of tokens
 */
async function listTokens(options = {}) {
    try {
        let url = `${XRPLMETA_API_BASE}/tokens`;
        
        // Add query parameters
        const params = new URLSearchParams();
        if (options.limit) params.append('limit', options.limit);
        if (options.offset) params.append('offset', options.offset);
        if (options.name_like) params.append('name_like', options.name_like);
        if (options.trust_level) params.append('trust_level', options.trust_level);
        if (options.expand_meta) params.append('expand_meta', options.expand_meta);
        
        // Add sorting
        if (options.sort_by) {
            const sortDirection = options.sort_dir || 'desc';
            params.append('sort', `${options.sort_by},${sortDirection}`);
        }
        
        // Append params to URL if we have any
        if (params.toString()) {
            url += `?${params.toString()}`;
        }
        
        const response = await axios.get(url);
        
        return {
            success: true,
            tokens: response.data,
            total: response.headers['x-total-count'] || response.data.length
        };
    } catch (error) {
        console.error('Error listing tokens from XRPLMeta:', error.message);
        return {
            success: false,
            message: `Failed to list tokens: ${error.message}`,
            details: error.response?.data || error
        };
    }
}

/**
 * Get detailed token information from XRPLMeta REST API
 * @param {string} currency - Currency code
 * @param {string} issuer - Issuer address
 * @param {Object} options - Additional options for the request
 * @returns {Promise} Token information
 */
async function getTokenInfo(currency, issuer, options = {}) {
    try {
        // Construct the token identifier
        const tokenIdentifier = `${currency}:${issuer}`;
        
        // Build the URL with query parameters
        let url = `${XRPLMETA_API_BASE}/token/${tokenIdentifier}`;
        
        // Add query parameters
        const params = new URLSearchParams();
        if (options.include_changes) params.append('include_changes', 'true');
        if (options.include_sources) params.append('include_sources', 'true');
        
        // Append params to URL if we have any
        if (params.toString()) {
            url += `?${params.toString()}`;
        }
        
        const response = await axios.get(url);
        
        return {
            success: true,
            token: response.data
        };
    } catch (error) {
        console.error(`Error getting token info for ${currency}:${issuer}:`, error.message);
        return {
            success: false,
            message: `Failed to get token info: ${error.message}`,
            details: error.response?.data || error
        };
    }
}

/**
 * Get historical metrics for a token from XRPLMeta
 * @param {string} currency - Currency code
 * @param {string} issuer - Issuer address
 * @param {string} metric - Metric to retrieve
 * @param {Object} options - Additional options for the request
 * @returns {Promise} Historical metrics data
 */
async function getTokenMetricsSeries(currency, issuer, metric, options = {}) {
    try {
        // Construct the token identifier
        const tokenIdentifier = `${currency}:${issuer}`;
        
        // Build the URL
        let url = `${XRPLMETA_API_BASE}/token/${tokenIdentifier}/series/${metric}`;
        
        // Add query parameters
        const params = new URLSearchParams();
        if (options.resolution) params.append('resolution', options.resolution);
        if (options.from) params.append('from', options.from);
        if (options.to) params.append('to', options.to);
        
        // Append params to URL if we have any
        if (params.toString()) {
            url += `?${params.toString()}`;
        }
        
        const response = await axios.get(url);
        
        return {
            success: true,
            series: response.data
        };
    } catch (error) {
        console.error(`Error getting token metric series for ${currency}:${issuer}:`, error.message);
        return {
            success: false,
            message: `Failed to get token metric series: ${error.message}`,
            details: error.response?.data || error
        };
    }
}

/**
 * Get token info via WebSocket
 * @param {string} currency - Currency code
 * @param {string} issuer - Issuer address
 * @returns {Promise} Token information
 */
async function getTokenInfoWS(currency, issuer) {
    try {
        // Construct the token identifier
        const tokenIdentifier = `${currency}:${issuer}`;
        
        const command = {
            command: 'token',
            identifier: tokenIdentifier
        };
        
        const response = await sendCommand(command);
        
        return {
            success: true,
            token: response
        };
    } catch (error) {
        console.error(`Error getting token info via WebSocket for ${currency}:${issuer}:`, error.message);
        return {
            success: false,
            message: `Failed to get token info via WebSocket: ${error.message}`,
            details: error
        };
    }
}

/**
 * Get complete token data (combines basic info and metrics)
 * @param {string} currency - Currency code
 * @param {string} issuer - Issuer address
 * @param {boolean} useWebSocket - Whether to use WebSocket instead of REST API
 * @returns {Promise} Complete token data
 */
async function getCompleteTokenData(currency, issuer, useWebSocket = false) {
    try {
        let tokenInfo;
        
        if (useWebSocket) {
            tokenInfo = await getTokenInfoWS(currency, issuer);
            
            if (!tokenInfo.success) {
                throw new Error(tokenInfo.message);
            }
            
            return {
                success: true,
                data: tokenInfo.token
            };
        } else {
            // Get token basic info
            tokenInfo = await getTokenInfo(currency, issuer, { include_changes: true });
            
            if (!tokenInfo.success) {
                throw new Error(tokenInfo.message);
            }
            
            // Get historical metrics
            const metrics = await getTokenMetricsSeries(
                currency, 
                issuer, 
                'supply,holders,trustlines,volume,price'
            );
            
            if (!metrics.success) {
                console.warn(`Could not get metrics series for ${currency}:${issuer}: ${metrics.message}`);
            }
            
            return {
                success: true,
                data: {
                    token: tokenInfo.token,
                    metrics: metrics.success ? metrics.series : null
                }
            };
        }
    } catch (error) {
        console.error(`Error getting complete token data for ${currency}:${issuer}:`, error.message);
        return {
            success: false,
            message: `Failed to get complete token data: ${error.message}`,
            details: error
        };
    }
}

module.exports = {
    listTokens,
    getTokenInfo,
    getTokenMetricsSeries,
    getTokenInfoWS,
    getCompleteTokenData,
    hexToReadableCurrency,
    initializeWebSocket
}; 