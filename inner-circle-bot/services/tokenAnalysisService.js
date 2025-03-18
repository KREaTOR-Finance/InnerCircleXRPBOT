require('dotenv').config();
const axios = require('axios');
const WebSocket = require('ws');
const config = require('../config');
const xrpl = require('xrpl');

let ws = null;
let isConnecting = false;
let commandQueue = [];
let nextId = 1;
let pendingCommands = {};

// API endpoints
const XRPLMETA_API_BASE = 'https://s1.xrplmeta.org';
const XRPLMETA_WS_URL = 'wss://s1.xrplmeta.org';
const XRPSCAN_AMM_POOLS_API = config.xrpscanApi.ammPools;
const DEXSCREENER_API = config.dexscreenerApi.pairDetails;
const XRPL_NODE = process.env.XRPL_NODE || 'wss://xrplcluster.com'; // Official XRPL API endpoint

/**
 * Initialize WebSocket connection to XRPLMeta
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
                console.log('WebSocket connection established');
                isConnecting = false;
                
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
 */
async function sendCommand(command) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
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
        
        console.log('Sending command:', JSON.stringify(messageWithId));
        ws.send(JSON.stringify(messageWithId));
        
        const messageHandler = (data) => {
            try {
                const response = JSON.parse(data);
                
                if (response.id === id) {
                    ws.removeListener('message', messageHandler);
                    
                    if (response.error) {
                        reject(new Error(response.error.message || 'Unknown error'));
                    } else {
                        resolve(response);
                    }
                    
                    delete pendingCommands[id];
                }
            } catch (error) {
                console.error('Error parsing WebSocket response:', error);
            }
        };
        
        ws.on('message', messageHandler);
        
        // Set timeout for the request
        setTimeout(() => {
            ws.removeListener('message', messageHandler);
            reject(new Error('WebSocket request timeout'));
        }, 10000);
    });
}

/**
 * Convert a hexadecimal currency code to its human-readable form
 * @param {string} hexCurrency - The hexadecimal currency code
 * @returns {string} The human-readable currency code
 */
function hexToReadableCurrency(hexCurrency) {
    // Check if it's a standard 3-character currency code in hex
    if (hexCurrency.length === 40) { // 40 characters = 20 bytes
        // Try to convert from hex to ASCII
        try {
            // Convert hex to buffer
            const buffer = Buffer.from(hexCurrency, 'hex');
            
            // Convert buffer to string and trim null bytes
            let currencyString = '';
            for (let i = 0; i < buffer.length; i++) {
                if (buffer[i] !== 0) {
                    currencyString += String.fromCharCode(buffer[i]);
                }
            }
            
            // If we have a valid ASCII string, return it
            if (/^[A-Za-z0-9]{3,}$/.test(currencyString)) {
                console.log(`Converted hex currency ${hexCurrency} to ${currencyString}`);
                return currencyString;
            }
        } catch (error) {
            console.error('Error converting hex currency:', error);
        }
    }
    
    // If conversion failed or it's not a standard format, return the original
    return hexCurrency;
}

/**
 * Get the currency code for a token issued by an address
 * @param {string} address - The issuer address
 * @returns {Promise<string|null>} The currency code or null if not found
 */
async function getIssuedCurrency(address) {
    console.log(`Attempting to find currency issued by address: ${address}`);
    try {
        // Connect to XRPL
        const xrplClient = new xrpl.Client(XRPL_NODE);
        await xrplClient.connect();
        console.log(`Connected to XRPL node: ${XRPL_NODE}`);
        
        try {
            // First approach: Check account_objects for RippleState entries
            console.log('Checking account_objects for RippleState entries...');
            const accountObjects = await xrplClient.request({
                command: 'account_objects',
                account: address,
                ledger_index: 'validated',
                type: 'state'
            });
            
            if (accountObjects.result && accountObjects.result.account_objects) {
                // Look for RippleState objects where this account is the issuer
                const rippleStates = accountObjects.result.account_objects.filter(obj => 
                    obj.LedgerEntryType === 'RippleState' && 
                    (obj.HighLimit.issuer === address || obj.LowLimit.issuer === address)
                );
                
                if (rippleStates.length > 0) {
                    // Use the first RippleState's currency
                    const hexCurrency = rippleStates[0].Balance.currency;
                    const currency = hexToReadableCurrency(hexCurrency);
                    console.log(`Found currency from RippleState: ${currency} (hex: ${hexCurrency})`);
                    await xrplClient.disconnect();
                    return currency;
                }
            }
            
            // Second approach: Use account_currencies
            console.log('Checking account_currencies...');
            const accountCurrencies = await xrplClient.request({
                command: 'account_currencies',
                account: address,
                strict: true,
                ledger_index: 'validated'
            });
            
            if (accountCurrencies.result && accountCurrencies.result.send_currencies && accountCurrencies.result.send_currencies.length > 0) {
                const hexCurrency = accountCurrencies.result.send_currencies[0];
                const currency = hexToReadableCurrency(hexCurrency);
                console.log(`Found currency from account_currencies: ${currency} (hex: ${hexCurrency})`);
                await xrplClient.disconnect();
                return currency;
            }
            
            // Third approach: Use account_lines to find trustlines
            console.log('Checking account_lines for trustlines...');
            const accountLines = await xrplClient.request({
                command: 'account_lines',
                account: address,
                ledger_index: 'validated'
            });
            
            if (accountLines.result && accountLines.result.lines && accountLines.result.lines.length > 0) {
                // Look for lines where this account is the issuer
                const issuedTokens = accountLines.result.lines.filter(line => 
                    line.account === address || line.issuer === address
                );
                
                if (issuedTokens.length > 0) {
                    const hexCurrency = issuedTokens[0].currency;
                    const currency = hexToReadableCurrency(hexCurrency);
                    console.log(`Found currency from account_lines: ${currency} (hex: ${hexCurrency})`);
                    await xrplClient.disconnect();
                    return currency;
                }
            }
            
            // Fourth approach: Use a different account to look up trustlines to this issuer
            console.log('Checking for trustlines to this issuer from a known account...');
            // Use Bitstamp's address as a reference account that might have trustlines
            const referenceAccount = 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B';
            const referenceLines = await xrplClient.request({
                command: 'account_lines',
                account: referenceAccount,
                peer: address,
                ledger_index: 'validated'
            });
            
            if (referenceLines.result && referenceLines.result.lines && referenceLines.result.lines.length > 0) {
                const hexCurrency = referenceLines.result.lines[0].currency;
                const currency = hexToReadableCurrency(hexCurrency);
                console.log(`Found currency from reference account trustlines: ${currency} (hex: ${hexCurrency})`);
                await xrplClient.disconnect();
                return currency;
            }
            
            // Fifth approach: Use rippled server_info to get a validator
            // and then check its trustlines to our issuer
            console.log('Trying to find a validator to check trustlines...');
            const serverInfo = await xrplClient.request({
                command: 'server_info'
            });
            
            if (serverInfo.result && serverInfo.result.info && serverInfo.result.info.validated_ledger) {
                // Get a list of accounts from the ledger
                const ledgerData = await xrplClient.request({
                    command: 'ledger_data',
                    ledger_index: 'validated',
                    limit: 10,
                    type: 'account'
                });
                
                if (ledgerData.result && ledgerData.result.state) {
                    for (const entry of ledgerData.result.state) {
                        if (entry.LedgerEntryType === 'AccountRoot') {
                            const account = entry.Account;
                            try {
                                const lines = await xrplClient.request({
                                    command: 'account_lines',
                                    account: account,
                                    peer: address,
                                    ledger_index: 'validated'
                                });
                                
                                if (lines.result && lines.result.lines && lines.result.lines.length > 0) {
                                    const hexCurrency = lines.result.lines[0].currency;
                                    const currency = hexToReadableCurrency(hexCurrency);
                                    console.log(`Found currency from ledger account trustlines: ${currency} (hex: ${hexCurrency})`);
                                    await xrplClient.disconnect();
                                    return currency;
                                }
                            } catch (error) {
                                console.log(`Error checking lines for account ${account}: ${error.message}`);
                            }
                        }
                    }
                }
            }
            
            // Special case for known addresses
            if (address === 'rpDLbEi1C19YxF3mjEbAU9nh8xevfNNMgm') {
                console.log('Using known currency CULT for address rpDLbEi1C19YxF3mjEbAU9nh8xevfNNMgm');
                await xrplClient.disconnect();
                return 'CULT';
            }
            
            console.log('Could not determine currency for address');
            await xrplClient.disconnect();
            return null;
        } catch (error) {
            console.error('Error querying XRPL:', error);
            await xrplClient.disconnect();
            return null;
        }
    } catch (error) {
        console.error('Error connecting to XRPL:', error);
        return null;
    }
}

/**
 * Get comprehensive token data directly from the XRPL
 * @param {string} address - The issuer address
 * @returns {Promise<Object>} Token data from XRPL
 */
async function getTokenDataFromXRPL(address) {
    console.log(`Getting token data directly from XRPL for address: ${address}`);
    try {
        // Connect to XRPL
        const xrplClient = new xrpl.Client(XRPL_NODE);
        await xrplClient.connect();
        console.log(`Connected to XRPL node: ${XRPL_NODE}`);
        
        let tokenData = {
            issuer: address,
            currency: null,
            name: null,
            trustlines: 0,
            holders: 0,
            supply: "0",
            flags: {},
            created_at: null
        };
        
        try {
            // First get the currency code
            const currency = await getIssuedCurrency(address);
            if (currency) {
                tokenData.currency = currency;
                tokenData.name = `${currency} Token`;
            }
            
            // Get account info to check flags and creation time
            try {
                const accountInfo = await xrplClient.request({
                    command: 'account_info',
                    account: address,
                    ledger_index: 'validated'
                });
                
                if (accountInfo.result && accountInfo.result.account_data) {
                    const flags = accountInfo.result.account_data.Flags || 0;
                    
                    // Parse account flags
                    tokenData.flags = {
                        frozen: (flags & 0x00200000) !== 0,
                        global_freeze: (flags & 0x00400000) !== 0,
                        no_freeze: (flags & 0x00100000) !== 0,
                        transfer_rate: (flags & 0x00000001) !== 0
                    };
                    
                    // Get account creation time from ledger
                    if (accountInfo.result.ledger_index) {
                        try {
                            const ledgerInfo = await xrplClient.request({
                                command: 'ledger',
                                ledger_index: accountInfo.result.ledger_index,
                                transactions: false,
                                expand: false
                            });
                            
                            if (ledgerInfo.result && ledgerInfo.result.ledger && ledgerInfo.result.ledger.close_time) {
                                // XRPL epoch starts on January 1, 2000
                                const xrplEpoch = 946684800;
                                const closeTime = ledgerInfo.result.ledger.close_time;
                                const timestamp = (parseInt(closeTime) + xrplEpoch) * 1000; // Convert to milliseconds
                                tokenData.created_at = new Date(timestamp).toISOString();
                            }
                        } catch (error) {
                            console.log(`Error getting ledger info: ${error.message}`);
                        }
                    }
                }
            } catch (error) {
                console.log(`Error getting account info: ${error.message}`);
            }
            
            // Get trustlines count
            try {
                // Use account_objects to find trustlines
                const accountObjects = await xrplClient.request({
                    command: 'account_objects',
                    account: address,
                    ledger_index: 'validated',
                    type: 'state'
                });
                
                if (accountObjects.result && accountObjects.result.account_objects) {
                    // Count RippleState objects where this account is the issuer
                    const trustlines = accountObjects.result.account_objects.filter(obj => 
                        obj.LedgerEntryType === 'RippleState' && 
                        (obj.HighLimit.issuer === address || obj.LowLimit.issuer === address)
                    );
                    
                    tokenData.trustlines = trustlines.length;
                    
                    // Estimate holders (unique accounts with trustlines)
                    const uniqueHolders = new Set();
                    trustlines.forEach(line => {
                        if (line.HighLimit.issuer === address) {
                            uniqueHolders.add(line.LowLimit.issuer);
                        } else {
                            uniqueHolders.add(line.HighLimit.issuer);
                        }
                    });
                    
                    tokenData.holders = uniqueHolders.size;
                    
                    // Calculate total supply
                    let totalSupply = 0;
                    trustlines.forEach(line => {
                        const balance = parseFloat(line.Balance.value || 0);
                        if (!isNaN(balance)) {
                            totalSupply += Math.abs(balance);
                        }
                    });
                    
                    tokenData.supply = totalSupply.toString();
                }
            } catch (error) {
                console.log(`Error getting trustlines: ${error.message}`);
            }
            
            await xrplClient.disconnect();
            return tokenData;
        } catch (error) {
            console.error('Error querying XRPL:', error);
            await xrplClient.disconnect();
            return tokenData;
        }
    } catch (error) {
        console.error('Error connecting to XRPL:', error);
        return {
            issuer: address,
            currency: null,
            name: null,
            trustlines: 0,
            holders: 0,
            supply: "0",
            flags: {},
            created_at: null
        };
    }
}

/**
 * Get token data from XRPLMeta via REST API
 */
async function getXRPLMetaDataREST(address) {
    console.log('Getting XRPLMeta data via REST API for address:', address);
    try {
        // Check if the address already contains a currency code (format: currency:issuer)
        let tokenIdentifier = address;
        let currencyDetermined = false;
        let currency = null;
        
        if (!address.includes(':')) {
            // If no currency code is provided, we need to determine the default currency
            console.log('No currency code provided in address, attempting to fetch token information');
            
            // First try to get the currency using our improved function
            currency = await getIssuedCurrency(address);
            
            if (currency) {
                tokenIdentifier = `${currency}:${address}`;
                currencyDetermined = true;
                console.log(`Determined token identifier: ${tokenIdentifier}`);
            } else if (address === 'rpDLbEi1C19YxF3mjEbAU9nh8xevfNNMgm') {
                // Fallback for CULT token
                currency = 'CULT';
                tokenIdentifier = `${currency}:${address}`;
                currencyDetermined = true;
                console.log(`Using known currency CULT for address ${address}`);
            } else {
                // Try some common currency codes as a last resort
                const possibleCurrencies = ['XRP', 'USD', 'EUR', 'BTC', 'ETH', 'CULT'];
                
                for (const testCurrency of possibleCurrencies) {
                    try {
                        console.log(`Trying currency ${testCurrency} for address ${address}...`);
                        const testIdentifier = `${testCurrency}:${address}`;
                        const testResponse = await axios.get(`${XRPLMETA_API_BASE}/token/${testIdentifier}`);
                        
                        if (testResponse.status === 200) {
                            tokenIdentifier = testIdentifier;
                            currency = testCurrency;
                            currencyDetermined = true;
                            console.log(`Found working token identifier: ${tokenIdentifier}`);
                            break;
                        }
                    } catch (error) {
                        console.log(`Currency ${testCurrency} not valid for this address`);
                    }
                }
            }
        } else {
            // Extract currency from the provided identifier
            currency = address.split(':')[0];
            currencyDetermined = true;
        }

        // Only proceed with XRPLMeta if we have a currency code
        if (currencyDetermined) {
            // Get token information
            console.log('Fetching token information via REST for:', tokenIdentifier);
            try {
                const tokenResponse = await axios.get(`${XRPLMETA_API_BASE}/token/${tokenIdentifier}`);
                const tokenData = tokenResponse.data;
                console.log('Token data received:', JSON.stringify(tokenData, null, 2));

                // Get token metrics
                console.log('Fetching token metrics via REST...');
                const metricsResponse = await axios.get(`${XRPLMETA_API_BASE}/token/${tokenIdentifier}/series/supply,holders,trustlines,volume,price`);
                const metricsData = metricsResponse.data;
                console.log('Metrics data received:', JSON.stringify(metricsData, null, 2));

                return {
                    token: { result: tokenData },
                    metrics: { result: metricsData }
                };
            } catch (error) {
                console.error(`Error fetching data from XRPLMeta for ${tokenIdentifier}:`, error.message);
                // Fall through to the fallback response
            }
        }
        
        // If we couldn't determine the currency or XRPLMeta request failed, get data directly from XRPL
        console.log('Getting token data directly from XRPL');
        const xrplTokenData = await getTokenDataFromXRPL(address);
        
        // Create a response with XRPL data
        return {
            token: { 
                result: {
                    issuer: address,
                    currency: xrplTokenData.currency || currency || 'Unknown',
                    name: xrplTokenData.name || (currency ? `${currency} Token` : 'Unknown Token'),
                    flags: xrplTokenData.flags,
                    age: xrplTokenData.created_at ? Math.floor((Date.now() - new Date(xrplTokenData.created_at).getTime()) / 1000) : null,
                    metadata: {
                        description: xrplTokenData.currency 
                            ? `Token with currency code ${xrplTokenData.currency} issued by ${address}` 
                            : 'Token information could not be retrieved from XRPLMeta'
                    }
                }
            },
            metrics: {
                result: {
                    series: [{
                        supply: xrplTokenData.supply,
                        holders: xrplTokenData.holders,
                        trustlines: xrplTokenData.trustlines
                    }]
                }
            }
        };
    } catch (error) {
        console.error('Error in getXRPLMetaDataREST:', error);
        
        // Try to get data directly from XRPL as a last resort
        try {
            const xrplTokenData = await getTokenDataFromXRPL(address);
            return {
                token: { 
                    result: {
                        issuer: address,
                        currency: xrplTokenData.currency || 'Unknown',
                        name: xrplTokenData.name || 'Unknown Token',
                        flags: xrplTokenData.flags,
                        age: xrplTokenData.created_at ? Math.floor((Date.now() - new Date(xrplTokenData.created_at).getTime()) / 1000) : null,
                        metadata: {
                            description: xrplTokenData.currency 
                                ? `Token with currency code ${xrplTokenData.currency} issued by ${address}` 
                                : 'Token information could not be retrieved'
                        }
                    }
                },
                metrics: {
                    result: {
                        series: [{
                            supply: xrplTokenData.supply,
                            holders: xrplTokenData.holders,
                            trustlines: xrplTokenData.trustlines
                        }]
                    }
                }
            };
        } catch (xrplError) {
            console.error('Error getting data from XRPL:', xrplError);
            
            // Return a placeholder response
            return {
                token: { 
                    result: {
                        issuer: address,
                        currency: 'Unknown',
                        name: 'Unknown Token',
                        metadata: {
                            description: 'Token information could not be retrieved'
                        }
                    }
                },
                metrics: {
                    result: {
                        series: []
                    }
                }
            };
        }
    }
}

/**
 * Get token data from XRPLMeta
 */
async function getXRPLMetaData(address) {
    try {
        // First try WebSocket
        try {
            await initializeWebSocket();
            return await getXRPLMetaDataWS(address);
        } catch (wsError) {
            console.log('WebSocket connection failed, falling back to REST API:', wsError);
            return await getXRPLMetaDataREST(address);
        }
    } catch (error) {
        console.error('Error fetching XRPLMeta data:', error);
        throw error;
    }
}

/**
 * Get token data from XRPLMeta via WebSocket (renamed from old getXRPLMetaData)
 */
async function getXRPLMetaDataWS(address) {
    console.log('Getting XRPLMeta data via WebSocket for address:', address);
    try {
        // Check if the address already contains a currency code (format: currency:issuer)
        let tokenIdentifier = address;
        let currencyDetermined = false;
        let currency = null;
        
        if (!address.includes(':')) {
            // If no currency code is provided, we need to determine the default currency
            console.log('No currency code provided in address, attempting to fetch token information');
            
            // Use our improved function to get the currency
            currency = await getIssuedCurrency(address);
            
            if (currency) {
                tokenIdentifier = `${currency}:${address}`;
                currencyDetermined = true;
                console.log(`Determined token identifier: ${tokenIdentifier}`);
            } else if (address === 'rpDLbEi1C19YxF3mjEbAU9nh8xevfNNMgm') {
                // Fallback for CULT token
                currency = 'CULT';
                tokenIdentifier = `${currency}:${address}`;
                currencyDetermined = true;
                console.log(`Using known currency CULT for address ${address}`);
            }
        } else {
            // Extract currency from the provided identifier
            currency = address.split(':')[0];
            currencyDetermined = true;
        }

        // Only proceed with XRPLMeta if we have a currency code
        if (currencyDetermined) {
            try {
                // Get token information
                console.log('Fetching token information via WebSocket for:', tokenIdentifier);
                const tokenCommand = {
                    command: "token",
                    params: {
                        identifier: tokenIdentifier
                    }
                };
                const tokenData = await sendCommand(tokenCommand);
                console.log('Token data received:', JSON.stringify(tokenData, null, 2));

                // Get token metrics
                console.log('Fetching token metrics via WebSocket...');
                const metricsCommand = {
                    command: "token_series",
                    params: {
                        identifier: tokenIdentifier,
                        metrics: ["supply", "holders", "trustlines", "volume", "price"],
                        interval: "1d",
                        limit: 1
                    }
                };
                const metricsData = await sendCommand(metricsCommand);
                console.log('Metrics data received:', JSON.stringify(metricsData, null, 2));

                return {
                    token: tokenData,
                    metrics: metricsData
                };
            } catch (error) {
                console.error(`Error fetching data from XRPLMeta WebSocket for ${tokenIdentifier}:`, error.message);
                // Fall through to the fallback response
            }
        }
        
        // If we couldn't determine the currency or XRPLMeta request failed, get data directly from XRPL
        console.log('Getting token data directly from XRPL');
        const xrplTokenData = await getTokenDataFromXRPL(address);
        
        // Create a response with XRPL data
        return {
            token: { 
                result: {
                    issuer: address,
                    currency: xrplTokenData.currency || currency || 'Unknown',
                    name: xrplTokenData.name || (currency ? `${currency} Token` : 'Unknown Token'),
                    flags: xrplTokenData.flags,
                    age: xrplTokenData.created_at ? Math.floor((Date.now() - new Date(xrplTokenData.created_at).getTime()) / 1000) : null,
                    metadata: {
                        description: xrplTokenData.currency 
                            ? `Token with currency code ${xrplTokenData.currency} issued by ${address}` 
                            : 'Token information could not be retrieved from XRPLMeta'
                    }
                }
            },
            metrics: {
                result: {
                    series: [{
                        supply: xrplTokenData.supply,
                        holders: xrplTokenData.holders,
                        trustlines: xrplTokenData.trustlines
                    }]
                }
            }
        };
    } catch (error) {
        console.error('Error in getXRPLMetaDataWS:', error);
        
        // Try to get data directly from XRPL as a last resort
        try {
            const xrplTokenData = await getTokenDataFromXRPL(address);
            return {
                token: { 
                    result: {
                        issuer: address,
                        currency: xrplTokenData.currency || 'Unknown',
                        name: xrplTokenData.name || 'Unknown Token',
                        flags: xrplTokenData.flags,
                        age: xrplTokenData.created_at ? Math.floor((Date.now() - new Date(xrplTokenData.created_at).getTime()) / 1000) : null,
                        metadata: {
                            description: xrplTokenData.currency 
                                ? `Token with currency code ${xrplTokenData.currency} issued by ${address}` 
                                : 'Token information could not be retrieved'
                        }
                    }
                },
                metrics: {
                    result: {
                        series: [{
                            supply: xrplTokenData.supply,
                            holders: xrplTokenData.holders,
                            trustlines: xrplTokenData.trustlines
                        }]
                    }
                }
            };
        } catch (xrplError) {
            console.error('Error getting data from XRPL:', xrplError);
            
            // Return a placeholder response
            return {
                token: { 
                    result: {
                        issuer: address,
                        currency: 'Unknown',
                        name: 'Unknown Token',
                        metadata: {
                            description: 'Token information could not be retrieved'
                        }
                    }
                },
                metrics: {
                    result: {
                        series: []
                    }
                }
            };
        }
    }
}

/**
 * Get market data from external sources
 * @param {string} currency - The currency code
 * @param {string} issuer - The issuer address
 * @returns {Promise<Object>} Market data
 */
async function getExternalMarketData(currency, issuer) {
    console.log(`Getting external market data for ${currency}:${issuer}`);
    let marketData = {
        price: null,
        price_change_24h: null,
        volume_24h: null,
        market_cap: null,
        liquidity: null,
        last_updated: null,
        source: null
    };
    
    // Skip if currency is not determined
    if (!currency) {
        console.log('Cannot fetch market data without currency code');
        return marketData;
    }
    
    try {
        // Special case for XRP (native token)
        if (currency === 'XRP' && issuer === 'rrrrrrrrrrrrrrrrrrrrrhoLvTp') {
            try {
                console.log('Fetching XRP market data from CoinGecko...');
                const response = await axios.get('https://api.coingecko.com/api/v3/coins/ripple', {
                    params: {
                        localization: false,
                        tickers: false,
                        market_data: true,
                        community_data: false,
                        developer_data: false
                    },
                    timeout: 5000
                });
                
                if (response.data && response.data.market_data) {
                    const data = response.data.market_data;
                    marketData.price = data.current_price.usd.toString();
                    marketData.price_change_24h = data.price_change_percentage_24h.toString();
                    marketData.volume_24h = data.total_volume.usd.toString();
                    marketData.market_cap = data.market_cap.usd.toString();
                    marketData.last_updated = new Date().toISOString();
                    marketData.source = 'CoinGecko';
                    console.log(`Found XRP market data: $${marketData.price}`);
                    return marketData;
                }
            } catch (error) {
                console.log('Error fetching XRP data from CoinGecko:', error.message);
            }
        }
        
        // For CULT token
        if (currency === 'CULT' && issuer === 'rpDLbEi1C19YxF3mjEbAU9nh8xevfNNMgm') {
            try {
                console.log('Fetching CULT market data from CoinGecko...');
                const response = await axios.get('https://api.coingecko.com/api/v3/coins/cult-dao', {
                    params: {
                        localization: false,
                        tickers: false,
                        market_data: true,
                        community_data: false,
                        developer_data: false
                    },
                    timeout: 5000
                });
                
                if (response.data && response.data.market_data) {
                    const data = response.data.market_data;
                    marketData.price = data.current_price.usd.toString();
                    marketData.price_change_24h = data.price_change_percentage_24h.toString();
                    marketData.volume_24h = data.total_volume.usd.toString();
                    marketData.market_cap = data.market_cap.usd.toString();
                    marketData.last_updated = new Date().toISOString();
                    marketData.source = 'CoinGecko';
                    console.log(`Found CULT market data: $${marketData.price}`);
                    return marketData;
                }
            } catch (error) {
                console.log('Error fetching CULT data from CoinGecko:', error.message);
            }
        }
        
        // For USD (Bitstamp)
        if (currency === 'USD' && issuer === 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B') {
            // USD stablecoin is pegged to $1
            marketData.price = '1.00';
            marketData.price_change_24h = '0.00';
            marketData.last_updated = new Date().toISOString();
            marketData.source = 'Fixed Price (Stablecoin)';
            console.log(`Using fixed price for USD stablecoin: $${marketData.price}`);
            return marketData;
        }
        
        // Try to get data from OnXRP API
        try {
            console.log('Attempting to fetch data from OnXRP API...');
            const onXrpUrl = `https://api.onxrp.com/api/tokens/${currency}/${issuer}`;
            const onXrpResponse = await axios.get(onXrpUrl, {
                timeout: 5000
            });
            
            if (onXrpResponse.data && onXrpResponse.data.data) {
                const tokenData = onXrpResponse.data.data;
                if (tokenData.price) {
                    marketData.price = tokenData.price.toString();
                    if (tokenData.volume_24h) marketData.volume_24h = tokenData.volume_24h.toString();
                    if (tokenData.market_cap) marketData.market_cap = tokenData.market_cap.toString();
                    marketData.last_updated = new Date().toISOString();
                    marketData.source = 'OnXRP';
                    console.log(`Found market data from OnXRP: $${marketData.price}`);
                    return marketData;
                }
            }
        } catch (error) {
            console.log('Error fetching data from OnXRP:', error.message);
        }
        
        // Try to get data from XRPScan AMM pools
        try {
            console.log('Attempting to fetch data from XRPScan AMM pools...');
            const ammData = await getAMMData(issuer);
            if (ammData && ammData.pools && ammData.pools.length > 0) {
                // Calculate average price from all pools
                let totalPrice = 0;
                let totalVolume = 0;
                let totalLiquidity = 0;
                let poolCount = 0;
                
                ammData.pools.forEach(pool => {
                    if (pool.price_usd) {
                        totalPrice += parseFloat(pool.price_usd);
                        poolCount++;
                    }
                    if (pool.volume_24h_usd) {
                        totalVolume += parseFloat(pool.volume_24h_usd);
                    }
                    if (pool.tvl_usd) {
                        totalLiquidity += parseFloat(pool.tvl_usd);
                    }
                });
                
                if (poolCount > 0) {
                    marketData.price = (totalPrice / poolCount).toString();
                    marketData.volume_24h = totalVolume.toString();
                    marketData.liquidity = totalLiquidity.toString();
                    marketData.last_updated = new Date().toISOString();
                    marketData.source = 'XRPScan AMM';
                    console.log(`Found market data from XRPScan AMM: $${marketData.price}`);
                    return marketData;
                }
            }
        } catch (error) {
            console.log('Error fetching data from XRPScan AMM:', error.message);
        }
        
        // Try to get data from DexScreener
        try {
            console.log('Attempting to fetch data from DexScreener...');
            // Use the correct endpoint for DexScreener
            const dexScreenerUrl = `${DEXSCREENER_API}/xrpl/${currency}_${issuer}`;
            const dexScreenerResponse = await axios.get(dexScreenerUrl, {
                timeout: 5000
            });
            
            if (dexScreenerResponse.data && dexScreenerResponse.data.pair) {
                const pair = dexScreenerResponse.data.pair;
                marketData.price = pair.priceUsd;
                marketData.price_change_24h = pair.priceChange?.h24;
                marketData.volume_24h = pair.volume?.h24;
                marketData.liquidity = pair.liquidity?.usd;
                marketData.last_updated = new Date().toISOString();
                marketData.source = 'DexScreener';
                console.log(`Found market data from DexScreener: $${marketData.price}`);
                return marketData;
            }
        } catch (error) {
            console.log('Error fetching data from DexScreener:', error.message);
        }
        
        // If all else fails, try to estimate from XRPL data
        console.log('No external market data found, using XRPL data to estimate');
        return marketData;
    } catch (error) {
        console.error('Error getting external market data:', error);
        return marketData;
    }
}

/**
 * Get comprehensive token analysis from multiple sources
 * @param {string} address - XRPL token address or identifier (format: currency:issuer)
 * @returns {Promise<Object>} Analysis results
 */
async function analyzeToken(address) {
    try {
        // Extract issuer address if format is currency:issuer
        const issuerAddress = address.includes(':') ? address.split(':')[1] : address;
        let currency = address.includes(':') ? address.split(':')[0] : null;
        
        // First try to get data directly from XRPL
        console.log('Getting token data directly from XRPL');
        const xrplTokenData = await getTokenDataFromXRPL(issuerAddress);
        
        // If currency wasn't provided, use the one from XRPL data
        if (!currency && xrplTokenData.currency) {
            currency = xrplTokenData.currency;
        }
        
        // Get external market data
        const marketData = await getExternalMarketData(currency, issuerAddress);
        
        // Then try to get data from XRPLMeta
        let xrplMetaData;
        try {
            xrplMetaData = await getXRPLMetaData(address);
        } catch (error) {
            console.error('Error fetching XRPLMeta data:', error);
            
            // Check if this is a 400 error with a specific message about token not existing
            if (error.response && error.response.status === 400 && 
                error.response.data && error.response.data.type === 'entryNotFound') {
                console.log(`Token not found in XRPLMeta: ${error.response.data.message}`);
                // Continue with XRPL data only
            } else {
                console.log('Using XRPL data only due to XRPLMeta error');
            }
            
            // Create a synthetic XRPLMeta response using XRPL data
            xrplMetaData = {
                token: { 
                    result: {
                        issuer: issuerAddress,
                        currency: xrplTokenData.currency || 'Unknown',
                        name: xrplTokenData.name || 'Unknown Token',
                        flags: xrplTokenData.flags,
                        age: xrplTokenData.created_at ? Math.floor((Date.now() - new Date(xrplTokenData.created_at).getTime()) / 1000) : null,
                        metadata: {
                            description: xrplTokenData.currency 
                                ? `Token with currency code ${xrplTokenData.currency} issued by ${issuerAddress}` 
                                : 'Token information could not be retrieved from XRPLMeta'
                        }
                    }
                },
                metrics: {
                    result: {
                        series: [{
                            supply: xrplTokenData.supply,
                            holders: xrplTokenData.holders,
                            trustlines: xrplTokenData.trustlines,
                            price: marketData.price,
                            volume: marketData.volume_24h
                        }]
                    }
                }
            };
        }
        
        // Fetch AMM data from XRPScan
        const ammData = await getAMMData(issuerAddress);
        
        // Fetch DexScreener data
        const dexScreenerData = await getDexScreenerData(issuerAddress);

        // Combine and format the data
        const analysis = formatAnalysis(xrplMetaData, ammData, dexScreenerData, xrplTokenData, marketData);
        
        return analysis;
    } catch (error) {
        console.error('Error analyzing token:', error);
        throw error;
    }
}

/**
 * Get AMM data from XRPScan
 */
async function getAMMData(address) {
    if (!XRPSCAN_AMM_POOLS_API) {
        console.log('XRPScan AMM API endpoint not configured');
        return null;
    }

    try {
        const response = await axios.get(`${XRPSCAN_AMM_POOLS_API}?issuer=${address}`);
        return response.data;
    } catch (error) {
        console.error('Error fetching AMM data:', error);
        return null;
    }
}

/**
 * Get token data from DexScreener
 */
async function getDexScreenerData(address) {
    if (!DEXSCREENER_API) {
        console.log('DexScreener API endpoint not configured');
        return null;
    }

    try {
        // For XRPL, we need to use the search endpoint with chain filter
        const response = await axios.get(`${DEXSCREENER_API}/search?q=chain:xrpl ${address}`);
        if (response.data && response.data.pairs && response.data.pairs.length > 0) {
            return response.data;
        }
        return null;
    } catch (error) {
        console.error('Error fetching DexScreener data:', error);
        return null;
    }
}

/**
 * Format analysis results with available data
 */
function formatAnalysis(xrplMetaData, ammData, dexScreenerData, xrplTokenData = null, marketData = null) {
    let analysis = '⭕️ *INNER CIRCLE ANALYSIS*\n\n';

    // Token Information
    analysis += `📊 *Token Information*\n`;
    if (xrplMetaData?.token?.result) {
        const token = xrplMetaData.token.result;
        analysis += `• Name: ${token.name || 'Unknown'}\n`;
        analysis += `• Symbol: ${token.currency || 'Unknown'}\n`;
        analysis += `• Issuer: ${token.issuer || 'Unknown'}\n`;
        
        if (token.metadata) {
            if (token.metadata.domain) {
                analysis += `• Domain: ${token.metadata.domain}\n`;
            }
            if (token.metadata.description) {
                analysis += `• Description: ${token.metadata.description}\n`;
            }
        }
    } else {
        analysis += `• Basic token information unavailable\n`;
    }
    analysis += '\n';

    // Market Information
    analysis += `📈 *Market Information*\n`;
    
    // First check if we have market data from external sources
    if (marketData && marketData.price) {
        analysis += `• Price: $${formatNumber(marketData.price)}\n`;
        
        if (marketData.price_change_24h) {
            const priceChange = parseFloat(marketData.price_change_24h);
            const changeSymbol = priceChange >= 0 ? '🟢' : '🔴';
            analysis += `• 24h Change: ${changeSymbol} ${priceChange.toFixed(2)}%\n`;
        }
        
        if (marketData.volume_24h) {
            analysis += `• 24h Volume: $${formatNumber(marketData.volume_24h)}\n`;
        }
        
        if (marketData.liquidity) {
            analysis += `• Liquidity: $${formatNumber(marketData.liquidity)}\n`;
        }
        
        if (marketData.source) {
            analysis += `• Data Source: ${marketData.source}\n`;
        }
    }
    // Then check XRPLMeta data
    else if (xrplMetaData?.metrics?.result) {
        const metrics = xrplMetaData.metrics.result;
        const latestMetrics = metrics.series?.[metrics.series.length - 1] || {};
        
        if (latestMetrics.price) {
            analysis += `• Price: $${formatNumber(latestMetrics.price)}\n`;
        }
        if (latestMetrics.volume) {
            analysis += `• 24h Volume: $${formatNumber(latestMetrics.volume)}\n`;
        }
        
        analysis += `• Data Source: XRPLMeta\n`;
    }
    
    // Add supply, holders, and trustlines data
    if (xrplMetaData?.metrics?.result) {
        const metrics = xrplMetaData.metrics.result;
        const latestMetrics = metrics.series?.[metrics.series.length - 1] || {};
        
        analysis += `• Supply: ${formatNumber(latestMetrics.supply || 0)}\n`;
        analysis += `• Holders: ${formatNumber(latestMetrics.holders || 0)}\n`;
        analysis += `• Trustlines: ${formatNumber(latestMetrics.trustlines || 0)}\n`;
    } else if (xrplTokenData) {
        // Use XRPL data if XRPLMeta data is not available
        analysis += `• Supply: ${formatNumber(xrplTokenData.supply || 0)}\n`;
        analysis += `• Holders: ${formatNumber(xrplTokenData.holders || 0)}\n`;
        analysis += `• Trustlines: ${formatNumber(xrplTokenData.trustlines || 0)}\n`;
        
        if (!marketData?.source && !xrplMetaData?.metrics?.result) {
            analysis += `• Data Source: XRPL Direct\n`;
        }
    } else {
        analysis += `• No market data found\n`;
    }
    
    // Calculate market cap if we have price and supply
    if ((marketData && marketData.price) || 
        (xrplMetaData?.metrics?.result?.series?.[0]?.price)) {
        const price = marketData?.price || xrplMetaData.metrics.result.series[0].price;
        const supply = xrplTokenData?.supply || 
                      xrplMetaData?.metrics?.result?.series?.[0]?.supply || 0;
        
        if (price && supply) {
            const marketCap = parseFloat(price) * parseFloat(supply);
            if (!isNaN(marketCap)) {
                analysis += `• Market Cap: $${formatNumber(marketCap)}\n`;
            }
        }
    }
    
    analysis += '\n';

    // Liquidity Information
    analysis += `💧 *Liquidity Information*\n`;
    if (ammData && ammData.pools && ammData.pools.length > 0) {
        const totalLiquidity = ammData.pools.reduce((sum, pool) => sum + (parseFloat(pool.tvl_usd) || 0), 0);
        analysis += `• Total Value Locked: $${formatNumber(totalLiquidity)}\n`;
        analysis += `• Number of AMM Pools: ${ammData.pools.length}\n`;
        
        // List top pools
        analysis += `• Top Pools:\n`;
        const sortedPools = [...ammData.pools].sort((a, b) => 
            (parseFloat(b.tvl_usd) || 0) - (parseFloat(a.tvl_usd) || 0)
        ).slice(0, 3);
        
        sortedPools.forEach(pool => {
            if (pool.tvl_usd) {
                analysis += `  - ${pool.asset_a}/${pool.asset_b}: $${formatNumber(pool.tvl_usd)}\n`;
            }
        });
        
        analysis += `• Data Source: XRPScan\n`;
    } else if (marketData && marketData.liquidity) {
        analysis += `• Liquidity: $${formatNumber(marketData.liquidity)}\n`;
        
        if (marketData.source && !analysis.includes(`• Data Source: ${marketData.source}`)) {
            analysis += `• Data Source: ${marketData.source}\n`;
        }
    } else {
        analysis += `• No liquidity data found\n`;
    }
    analysis += '\n';

    // Risk Analysis
    analysis += `⚠️ *Risk Analysis*\n`;
    if (xrplMetaData?.token?.result) {
        const token = xrplMetaData.token.result;
        if (token.trust_score) {
            analysis += `• Trust Score: ${token.trust_score}/100\n`;
        }
        if (token.flags) {
            analysis += `• Flags: ${formatFlags(token.flags)}\n`;
        }
        if (token.age) {
            analysis += `• Age: ${formatAge(token.age)}\n`;
        }
    } else if (xrplTokenData) {
        // Use XRPL data if XRPLMeta data is not available
        if (xrplTokenData.flags) {
            analysis += `• Flags: ${formatFlags(xrplTokenData.flags)}\n`;
        }
        if (xrplTokenData.created_at) {
            const ageInSeconds = Math.floor((Date.now() - new Date(xrplTokenData.created_at).getTime()) / 1000);
            analysis += `• Age: ${formatAge(ageInSeconds)}\n`;
        }
    } else {
        analysis += `• Risk data unavailable\n`;
    }

    return analysis;
}

/**
 * Format numbers with commas and decimals
 */
function formatNumber(num) {
    return new Intl.NumberFormat('en-US').format(num);
}

/**
 * Format token age
 */
function formatAge(seconds) {
    const days = Math.floor(seconds / (24 * 60 * 60));
    if (days > 365) {
        const years = (days / 365).toFixed(1);
        return `${years} years`;
    }
    return `${days} days`;
}

/**
 * Format token flags for display
 */
function formatFlags(flags) {
    const flagDescriptions = [];
    if (flags.frozen) flagDescriptions.push('❄️ Frozen');
    if (flags.global_freeze) flagDescriptions.push('🌨️ Global Freeze');
    if (flags.no_freeze) flagDescriptions.push('🛡️ No Freeze');
    if (flags.transfer_rate) flagDescriptions.push('💱 Transfer Fee');
    
    return flagDescriptions.length > 0 ? flagDescriptions.join(', ') : 'None';
}

/**
 * Get social analysis for a token
 */
async function getSocialAnalysis(address) {
    try {
        // Get token data from XRPLMeta for social links
        const xrplMetaData = await getXRPLMetaData(address);
        
        let analysis = '🌐 *Social Analysis*\n\n';
        
        if (xrplMetaData && xrplMetaData.token.metadata) {
            const metadata = xrplMetaData.token.metadata;
            
            if (metadata.domain) {
                analysis += `🔗 Website: ${metadata.domain}\n`;
            }
            
            if (metadata.social) {
                if (metadata.social.twitter) {
                    analysis += `🐦 Twitter: @${metadata.social.twitter}\n`;
                }
                if (metadata.social.telegram) {
                    analysis += `📱 Telegram: ${metadata.social.telegram}\n`;
                }
                if (metadata.social.discord) {
                    analysis += `💬 Discord: ${metadata.social.discord}\n`;
                }
            }
        } else {
            analysis += '❌ No social information found for this token.\n';
        }
        
        return analysis;
    } catch (error) {
        console.error('Error getting social analysis:', error);
        return '❌ Error fetching social analysis. Please try again later.';
    }
}

// Initialize WebSocket connection
initializeWebSocket();

// Export the module
module.exports = {
    analyzeToken,
    getXRPLMetaData,
    getXRPLMetaDataREST,
    getXRPLMetaDataWS,
    getIssuedCurrency,
    getSocialAnalysis,
    hexToReadableCurrency,
    getTokenDataFromXRPL,
    getExternalMarketData
}; 