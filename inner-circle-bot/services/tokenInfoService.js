const axios = require('axios');
const xrpl = require('xrpl');
require('dotenv').config();

// Constants for API URLs - using the correct environment variables
const XRPL_API_URL = process.env.XRPL_HTTP_API || 'https://xrplcluster.com';
const XRPL_META_API_URL = process.env.XRPLMETA_API_BASE || 'https://s1.xrplmeta.org';

/**
 * Service for retrieving and processing token information from XRPL and XRPLMeta
 */
class TokenInfoService {
    /**
     * Get account information from XRPL using JSON-RPC
     * @param {string} address - The XRPL address to get information for
     * @returns {Promise<object>} - The account information
     */
    async getAccountInfo(address) {
        try {
            console.log(`Fetching account info for ${address} from ${XRPL_API_URL} using JSON-RPC`);
            
            // Using JSON-RPC method as per XRPL API documentation
            const response = await axios.post(XRPL_API_URL, {
                method: "account_info",
                params: [{
                    account: address,
                    ledger_index: "validated",
                    strict: true
                }]
            }, {
                headers: { 'Content-Type': 'application/json' }
            });
            
            // Check for successful response
            if (response.data.result && response.data.result.status === "success") {
                return { 
                    success: true, 
                    data: {
                        account_data: response.data.result.account_data
                    }
                };
            } else {
                throw new Error(response.data.result?.error_message || "Unknown error occurred");
            }
        } catch (error) {
            console.error('Error fetching account info via JSON-RPC:', error.message);
            
            // Try to connect directly using XRPL.js library as a fallback
            try {
                console.log(`Trying XRPL.js client for account info fallback`);
                const client = new xrpl.Client(XRPL_API_URL);
                await client.connect();
                
                const accountInfo = await client.request({
                    command: "account_info",
                    account: address,
                    ledger_index: "validated"
                });
                
                await client.disconnect();
                
                if (accountInfo.result && accountInfo.result.status === "success") {
                    return { 
                        success: true, 
                        data: {
                            account_data: accountInfo.result.account_data
                        }
                    };
                } else {
                    throw new Error(accountInfo.result?.error_message || "Unknown error with XRPL.js client");
                }
            } catch (fallbackError) {
                console.error('Fallback error using XRPL.js client:', fallbackError.message);
                return { 
                    success: false, 
                    message: error.response?.data?.result?.error_message || error.message 
                };
            }
        }
    }

    /**
     * Get tokens issued by an account using gateway_balances method
     * @param {string} address - The XRPL address of the issuer
     * @returns {Promise<object>} - The tokens issued by the account
     */
    async getIssuedTokens(address) {
        try {
            console.log(`Fetching issued tokens for ${address} from ${XRPL_API_URL} using gateway_balances`);
            
            // Using JSON-RPC method as per XRPL API documentation
            const response = await axios.post(XRPL_API_URL, {
                method: "gateway_balances",
                params: [{
                    account: address,
                    ledger_index: "validated",
                    hotwallet: []
                }]
            }, {
                headers: { 'Content-Type': 'application/json' }
            });
            
            // Check for successful response
            if (response.data.result && response.data.result.status === "success") {
                // Format the response to match expected structure
                const obligations = response.data.result.obligations || {};
                const tokens = Object.entries(obligations).map(([currency, amount]) => ({
                    currency,
                    amount: amount.toString(),
                    issuer: address
                }));
                
                return { 
                    success: true, 
                    data: {
                        tokens: tokens
                    }
                };
            } else {
                throw new Error(response.data.result?.error_message || "Unknown error occurred");
            }
        } catch (error) {
            console.error('Error fetching issued tokens via JSON-RPC:', error.message);
            
            // Try account_lines method as a fallback to find tokens with trustlines
            try {
                console.log(`Trying account_lines fallback for issued tokens`);
                
                const response = await axios.post(XRPL_API_URL, {
                    method: "account_lines",
                    params: [{
                        account: address,
                        ledger_index: "validated"
                    }]
                }, {
                    headers: { 'Content-Type': 'application/json' }
                });
                
                if (response.data.result && response.data.result.status === "success") {
                    // Identify which currencies this account issues by looking at trust lines
                    // (This is a fallback, not as reliable as gateway_balances)
                    const issuedCurrencies = new Set();
                    
                    // Get any trust lines where this account is the issuer
                    if (response.data.result.lines) {
                        response.data.result.lines.forEach(line => {
                            if (line.account === address) {
                                issuedCurrencies.add(line.currency);
                            }
                        });
                    }
                    
                    const tokens = Array.from(issuedCurrencies).map(currency => ({
                        currency,
                        amount: "0", // We don't know the amount from account_lines
                        issuer: address
                    }));
                    
                    return { 
                        success: true, 
                        data: {
                            tokens: tokens
                        }
                    };
                } else {
                    throw new Error(response.data.result?.error_message || "Unknown error occurred");
                }
            } catch (fallbackError) {
                console.error('Fallback error fetching issued tokens:', fallbackError.message);
                
                // Try XRPL Meta API as a last resort to find tokens
                try {
                    console.log(`Trying XRPL Meta API as last resort to find tokens issued by ${address}`);
                    
                    const metaResponse = await axios.get(`${XRPL_META_API_URL}/tokens?issuer=${address}`);
                    
                    if (metaResponse.data && Array.isArray(metaResponse.data.items)) {
                        const tokens = metaResponse.data.items.map(item => ({
                            currency: item.currency,
                            amount: "0", // We don't have amount data from this endpoint
                            issuer: address
                        }));
                        
                        return { 
                            success: true, 
                            data: {
                                tokens: tokens
                            }
                        };
                    }
                } catch (metaError) {
                    console.error('Error with XRPL Meta fallback:', metaError.message);
                }
                
                return { 
                    success: false, 
                    message: error.response?.data?.result?.error_message || error.message 
                };
            }
        }
    }

    /**
     * Get token holders information using account_lines
     * @param {string} issuer - The XRPL address of the token issuer
     * @param {object} options - Options for the request (limit, marker, currency)
     * @returns {Promise<object>} - The token holders information
     */
    async getTokenHolders(issuer, options = {}) {
        try {
            const { limit = 200, currency, marker } = options;
            console.log(`Fetching token holders for ${issuer} ${currency ? 'currency: ' + currency : ''}`);
            
            // Build request payload
            const payload = {
                method: "account_lines",
                params: [{
                    account: issuer,
                    ledger_index: "validated",
                    limit: limit
                }]
            };
            
            // Add marker if provided for pagination
            if (marker) {
                payload.params[0].marker = marker;
            }
            
            // Make JSON-RPC request
            const response = await axios.post(XRPL_API_URL, payload, {
                headers: { 'Content-Type': 'application/json' }
            });
            
            // Process the response
            if (response.data.result && response.data.result.status === "success") {
                let holders = [];
                
                // Filter by the specified currency if provided
                if (response.data.result.lines) {
                    holders = response.data.result.lines
                        .filter(line => !currency || line.currency === currency)
                        .filter(line => parseFloat(line.balance) > 0) // Only include positive balances
                        .map(line => ({
                            account: line.account,
                            currency: line.currency,
                            balance: line.balance
                        }));
                }
                
                return { 
                    success: true, 
                    holders: holders,
                    marker: response.data.result.marker
                };
            } else {
                throw new Error(response.data.result?.error_message || "Unknown error occurred");
            }
        } catch (error) {
            console.error('Error fetching token holders:', error.message);
            
            return { 
                success: false, 
                message: error.response?.data?.result?.error_message || error.message 
            };
        }
    }

    /**
     * Get comprehensive token information combining XRPL and XRPLMeta data
     * @param {string} currency - The currency code of the token
     * @param {string} issuer - The XRPL address of the issuer
     * @returns {Promise<object>} - The comprehensive token information
     */
    async getTokenInformation(currency, issuer) {
        try {
            console.log(`Getting comprehensive token information for ${currency}:${issuer}`);
            
            // Get basic token information from XRPL
            const accountInfoPromise = this.getAccountInfo(issuer);
            
            // Get token metadata from XRPLMeta
            console.log(`Fetching token metadata from ${XRPL_META_API_URL}/token/${currency}:${issuer}`);
            const metaPromise = axios.get(`${XRPL_META_API_URL}/token/${currency}:${issuer}`)
                .catch(error => {
                    console.error(`Error fetching token metadata: ${error.message}`);
                    // Try alternative format with + instead of :
                    return axios.get(`${XRPL_META_API_URL}/token/${currency}+${issuer}`)
                        .catch(err => {
                            console.error(`Error with alternative token metadata endpoint: ${err.message}`);
                            return { data: { error: error.message } };
                        });
                });
            
            // Get market metrics if available - try both series/price and metrics endpoints
            console.log(`Fetching market metrics from ${XRPL_META_API_URL}/token/${currency}:${issuer}/series/price?period=30d`);
            const metricsPromise = axios.get(`${XRPL_META_API_URL}/token/${currency}:${issuer}/series/price?period=30d`)
                .catch(error => {
                    console.error(`Error fetching market metrics: ${error.message}`);
                    // Try alternative format
                    return axios.get(`${XRPL_META_API_URL}/token/${currency}+${issuer}/series/price?period=30d`)
                        .catch(err => {
                            console.error(`Error with alternative metrics endpoint: ${err.message}`);
                            return { data: { error: error.message } };
                        });
                });
                
            // Get more comprehensive metrics directly 
            console.log(`Fetching comprehensive metrics from ${XRPL_META_API_URL}/token/${currency}:${issuer}/metrics`);
            const comprehensiveMetricsPromise = axios.get(`${XRPL_META_API_URL}/token/${currency}:${issuer}/metrics`)
                .catch(error => {
                    console.error(`Error fetching comprehensive metrics: ${error.message}`);
                    // Try alternative format
                    return axios.get(`${XRPL_META_API_URL}/token/${currency}+${issuer}/metrics`)
                        .catch(err => {
                            console.error(`Error with alternative comprehensive metrics endpoint: ${err.message}`);
                            return { data: { error: error.message } };
                        });
                });
                
            // Get token trustlines count for holders information
            console.log(`Fetching trustlines for ${currency}:${issuer}`);
            const trustlinesPromise = axios.post(XRPL_API_URL, {
                method: "account_lines",
                params: [{
                    account: issuer,
                    ledger_index: "validated",
                    limit: 5 // Just to get an idea, not the full count
                }]
            }, {
                headers: { 'Content-Type': 'application/json' }
            }).catch(error => {
                console.error(`Error fetching trustlines: ${error.message}`);
                return { data: { error: error.message } };
            });
            
            // Wait for all promises to resolve
            const [accountInfo, meta, metrics, comprehensiveMetrics, trustlines] = await Promise.all([
                accountInfoPromise,
                metaPromise,
                metricsPromise,
                comprehensiveMetricsPromise,
                trustlinesPromise
            ]);
            
            // Get trustlines count from response
            let trustlinesCount = 0;
            if (trustlines && !trustlines.data.error && trustlines.data.result && trustlines.data.result.lines) {
                trustlinesCount = trustlines.data.result.lines.filter(line => 
                    line.currency && line.currency === currency
                ).length;
            }
            
            // Try to get additional info from DexScreener for better market data
            let dexScreenerData = null;
            try {
                const dexScreenerResponse = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${currency}.${issuer}`);
                if (dexScreenerResponse.data && dexScreenerResponse.data.pairs && dexScreenerResponse.data.pairs.length > 0) {
                    dexScreenerData = dexScreenerResponse.data.pairs[0];
                }
            } catch (dexError) {
                console.error(`Error fetching DexScreener data: ${dexError.message}`);
            }
            
            // Combine all data into a single object
            return { 
                success: true, 
                data: {
                    issuerInfo: accountInfo.success ? accountInfo.data : null,
                    meta: meta.data,
                    metrics: metrics.data,
                    comprehensiveMetrics: comprehensiveMetrics.data,
                    dexScreenerData,
                    trustlinesCount,
                    currency,
                    issuer
                }
            };
        } catch (error) {
            console.error('Error getting token information:', error.message);
            return { 
                success: false, 
                message: error.message 
            };
        }
    }

    /**
     * Format token description for display
     * @param {object} result - The token information result
     * @returns {string} - The formatted token description
     */
    formatTokenDescription(result) {
        const { data } = result;
        const { issuerInfo, meta, metrics, comprehensiveMetrics, dexScreenerData, trustlinesCount, currency, issuer } = data;
        
        let symbol = currency;
        if (/^[0-9A-F]{40}$/i.test(currency)) {
            // Convert hex currency to ASCII if possible
            try {
                const bytes = Buffer.from(currency, 'hex');
                const ascii = bytes.toString('utf8').replace(/\0/g, '').trim();
                if (ascii) {
                    symbol = ascii;
                }
            } catch (error) {
                console.error('Error converting hex currency:', error);
            }
        }
        
        // Get account data and extract domain if available
        let issuerDomain = 'Unknown';
        try {
            if (issuerInfo?.account_data?.Domain) {
                const domainHex = issuerInfo.account_data.Domain;
                issuerDomain = Buffer.from(domainHex, 'hex').toString('utf8').replace(/\0/g, '').trim();
            }
        } catch (error) {
            console.error('Error decoding domain hex:', error);
        }
        
        // Get token name and basic info - handle different response formats
        const tokenName = meta?.name || meta?.token?.name || meta?.token?.meta?.name || symbol;
        const issuerName = meta?.issuer?.name || meta?.token?.issuer?.name || meta?.token?.meta?.issuer?.name || 'Unknown';
        
        // Set up default metrics values
        let price = 'Unknown';
        let priceChange24h = 0;
        let priceChange1h = 0;
        let marketCap = 'Unknown';
        let liquidity = 'Unknown';
        let liquidityRatio = 'Unknown';
        let supply = 'Unknown';
        let created = null;
        let volume24h = 'Unknown';
        let ath = 'Unknown';
        let athDate = 'Unknown';
        let buyVolume = 0;
        let sellVolume = 0;
        let holders = trustlinesCount > 0 ? trustlinesCount : 'Unknown';
        
        // Extract metrics from different possible response formats
        if (metrics?.data?.length > 0) {
            // Response from series/price endpoint
            const latestMetric = metrics.data[metrics.data.length - 1];
            price = latestMetric.value || 'Unknown';
            
            if (metrics.data.length > 1) {
                const previousPrice = metrics.data[metrics.data.length - 2].value;
                if (previousPrice && price !== 'Unknown') {
                    priceChange24h = ((price - previousPrice) / previousPrice) * 100;
                }
            }
        } else if (metrics?.metrics?.length > 0) {
            // Alternative response format
            const latestMetric = metrics.metrics[metrics.metrics.length - 1];
            price = latestMetric?.price?.usd || 'Unknown';
            priceChange24h = latestMetric?.price?.usd_change_24h || 0;
            marketCap = latestMetric?.marketcap?.usd || 'Unknown';
            liquidity = latestMetric?.liquidity?.usd || 'Unknown';
            volume24h = latestMetric?.volume?.usd_24h || 'Unknown';
            holders = latestMetric?.holders?.count || holders;
        }
        
        // Try to get metrics from comprehensive metrics endpoint if not available
        if (comprehensiveMetrics && comprehensiveMetrics.metrics) {
            if (price === 'Unknown') price = comprehensiveMetrics.metrics.price?.usd || price;
            if (priceChange24h === 0) priceChange24h = comprehensiveMetrics.metrics.price?.usd_change_24h || priceChange24h;
            if (priceChange1h === 0) priceChange1h = comprehensiveMetrics.metrics.price?.usd_change_1h || priceChange1h;
            if (marketCap === 'Unknown') marketCap = comprehensiveMetrics.metrics.marketcap?.usd || marketCap;
            if (liquidity === 'Unknown') liquidity = comprehensiveMetrics.metrics.liquidity?.usd || liquidity;
            if (volume24h === 'Unknown') volume24h = comprehensiveMetrics.metrics.volume?.usd_24h || volume24h;
            if (holders === 'Unknown') holders = comprehensiveMetrics.metrics.holders?.count || holders;
            
            // Get ATH data if available
            if (comprehensiveMetrics.metrics.price?.usd_ath) {
                ath = comprehensiveMetrics.metrics.price.usd_ath;
                athDate = comprehensiveMetrics.metrics.price.usd_ath_date || 'Unknown';
            }
            
            // Get buy/sell volumes if available
            if (comprehensiveMetrics.metrics.volume) {
                buyVolume = comprehensiveMetrics.metrics.volume.buy_usd_24h || 0;
                sellVolume = comprehensiveMetrics.metrics.volume.sell_usd_24h || 0;
            }
            
            // Calculate liquidity ratio if both liquidity and marketcap are available
            if (typeof liquidity === 'number' && typeof marketCap === 'number' && marketCap > 0) {
                liquidityRatio = (liquidity / marketCap);
            }
        }
        
        // Try to get metrics from DexScreener data if not available
        if (dexScreenerData) {
            if (price === 'Unknown') price = dexScreenerData.priceUsd || price;
            if (marketCap === 'Unknown') marketCap = dexScreenerData.fdv || marketCap;
            if (liquidity === 'Unknown') liquidity = dexScreenerData.liquidity?.usd || liquidity;
            if (volume24h === 'Unknown') volume24h = dexScreenerData.volume?.h24 || volume24h;
            if (priceChange24h === 0) priceChange24h = dexScreenerData.priceChange?.h24 || priceChange24h;
            if (priceChange1h === 0) priceChange1h = dexScreenerData.priceChange?.h1 || priceChange1h;
            if (ath === 'Unknown' && dexScreenerData.priceAth) ath = dexScreenerData.priceAth;
        }
        
        // Get supply information
        supply = meta?.supply || meta?.token?.supply || 'Unknown';
        
        // Get token creation date
        created = meta?.created || meta?.token?.created
            ? new Date((meta?.created || meta?.token?.created) * 1000)
            : dexScreenerData?.pairCreatedAt ? new Date(dexScreenerData.pairCreatedAt) : null;
            
        // Format the values for display
        const formattedPrice = typeof price === 'number' || typeof price === 'string' && !isNaN(parseFloat(price))
            ? `$${parseFloat(price).toFixed(10).replace(/\.?0+$/, '')}` 
            : 'Unknown';
            
        const formattedMarketCap = typeof marketCap === 'number' || typeof marketCap === 'string' && !isNaN(parseFloat(marketCap))
            ? `$${this.formatLargeNumber(parseFloat(marketCap))}`
            : 'Unknown';
            
        const formattedLiquidity = typeof liquidity === 'number' || typeof liquidity === 'string' && !isNaN(parseFloat(liquidity))
            ? `$${this.formatLargeNumber(parseFloat(liquidity))}`
            : 'Unknown';
            
        const formattedVolume = typeof volume24h === 'number' || typeof volume24h === 'string' && !isNaN(parseFloat(volume24h))
            ? `$${this.formatLargeNumber(parseFloat(volume24h))}`
            : 'Unknown';
            
        const formattedAth = typeof ath === 'number' || typeof ath === 'string' && !isNaN(parseFloat(ath))
            ? `$${this.formatLargeNumber(parseFloat(ath))}`
            : 'Unknown';
            
        // Format liquidity ratio (x-times)
        const liquidityRatioText = typeof liquidityRatio === 'number'
            ? `[x${liquidityRatio.toFixed(1)}]`
            : '';
            
        // Format age to match screenshot (2mo instead of 2 months)
        let shortTokenAge = 'Unknown';
        if (created) {
            const now = new Date();
            const diffTime = Math.abs(now - created);
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays < 1) {
                shortTokenAge = '<1d';
            } 
            else if (diffDays < 30) {
                shortTokenAge = `${diffDays}d`;
            } 
            else if (diffDays < 365) {
                const months = Math.floor(diffDays / 30);
                shortTokenAge = `${months}mo`;
            } 
            else {
                const years = Math.floor(diffDays / 365);
                shortTokenAge = `${years}y`;
            }
        }
        
        // Format ATH date
        let athPeriod = 'Unknown';
        if (athDate !== 'Unknown' && typeof athDate === 'string') {
            try {
                const athDateObj = new Date(athDate);
                const now = new Date();
                const diffTime = Math.abs(now - athDateObj);
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                
                if (diffDays < 30) {
                    athPeriod = `${diffDays}d`;
                } 
                else if (diffDays < 365) {
                    const months = Math.floor(diffDays / 30);
                    athPeriod = `${months}mo`;
                } 
                else {
                    const years = Math.floor(diffDays / 365);
                    athPeriod = `${years}y`;
                }
            } catch (error) {
                console.error('Error parsing ATH date:', error);
            }
        }

        // Format price change percentages
        const priceChange1hFormatted = typeof priceChange1h === 'number' 
            ? `${priceChange1h >= 0 ? '+' : ''}${priceChange1h.toFixed(1)}%` 
            : '0%';
            
        const priceChange24hFormatted = typeof priceChange24h === 'number' 
            ? `${priceChange24h >= 0 ? '+' : ''}${priceChange24h.toFixed(1)}%` 
            : '0%';
        
        // Build message with Inner Circle branding at the top
        let message = `🔴 *INNER CIRCLE ANALYSIS* 🔴\n\n`;
        
        // Get community vote counts and display as bull/bear emojis
        const tokenService = require('./tokenService');
        const tokenAddress = `${currency}:${issuer}`;
        console.log(`Getting community votes for token address: ${tokenAddress}`);
        const votes = tokenService.getCommunityVotes(tokenAddress);
        console.log(`Votes retrieved for token ${tokenAddress}: Upvotes: ${votes.upvotes}, Downvotes: ${votes.downvotes}`);
        message += `🐂 *Bulls*: ${votes.upvotes} | 🐻 *Bears*: ${votes.downvotes}\n\n`;
        
        // Main token info section with real-time data
        message += `🟡 ${tokenName} [${formattedMarketCap}/${priceChange24hFormatted}] $${symbol.toUpperCase()}\n`;
        message += `🌐 Xrpl @ ${issuerName !== 'Unknown' ? issuerName : 'Xrpl'}\n`;
        message += `💎 FDV: ${formattedMarketCap} ⇨ ATH: ${formattedAth} [${athPeriod}]\n`;
        message += `💦 Liq: ${formattedLiquidity} ${liquidityRatioText}\n`;
        message += `📊 Vol: ${formattedVolume} ⋅ Age: ${shortTokenAge}\n`;
        
        // Add token ID - make it copy-ready with backticks - show only R address
        message += `\n\`${issuer}\`\n`;
        
        // Add shortcuts with actual links - removed DEXScreener link, updated XLS link with referral
        const xlsUrl = `https://t.me/XrpLedgerSniperBot?start=rpDLbEi1C19YxF3mjEbAU9nh8xevfNNMgm-HTQ0DG`;
        const expUrl = `https://xrpscan.com/account/${issuer}`;
        const twUrl = `https://twitter.com/search?q=$${symbol}`;
        
        message += `[XLS](${xlsUrl}) ⋅ [EXP](${expUrl}) ⋅ [TW](${twUrl})`;
        
        return message;
    }

    /**
     * Format large numbers with K, M, B suffixes
     * @param {number} num - The number to format
     * @returns {string} - The formatted number
     */
    formatLargeNumber(num) {
        if (num >= 1e9) {
            return (num / 1e9).toFixed(2) + 'B';
        } 
        else if (num >= 1e6) {
            return (num / 1e6).toFixed(2) + 'M';
        } 
        else if (num >= 1e3) {
            return (num / 1e3).toFixed(2) + 'K';
        }
        return num.toString();
    }

    /**
     * Calculate age from a date to now
     * @param {Date} date - The date to calculate age from
     * @returns {string} - The formatted age
     */
    calculateAge(date) {
        const now = new Date();
        const diffTime = Math.abs(now - date);
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays < 1) {
            return 'Less than a day';
        } 
        else if (diffDays < 30) {
            return `${diffDays} days`;
        } 
        else if (diffDays < 365) {
            const months = Math.floor(diffDays / 30);
            return `${months} month${months > 1 ? 's' : ''}`;
        } 
        else {
            const years = Math.floor(diffDays / 365);
            const remainingMonths = Math.floor((diffDays % 365) / 30);
            if (remainingMonths > 0) {
                return `${years} year${years > 1 ? 's' : ''} ${remainingMonths} month${remainingMonths > 1 ? 's' : ''}`;
            } 
            else {
                return `${years} year${years > 1 ? 's' : ''}`;
            }
        }
    }

    /**
     * Find a token by its currency and issuer prefixes
     * @param {string} currencyPrefix - First part of the currency code
     * @param {string} issuerPrefix - First part of the issuer address
     * @returns {Promise<Object>} Result object with success flag and token data
     */
    async findTokenByPrefix(currencyPrefix, issuerPrefix) {
        try {
            console.log(`Finding token with currency prefix ${currencyPrefix} and issuer prefix ${issuerPrefix}`);
            
            // First try to find it in any cached data
            if (global.tokenCache) {
                const cachedMatch = global.tokenCache.find(token => 
                    token.currency && token.currency.startsWith(currencyPrefix) && 
                    token.issuer && token.issuer.startsWith(issuerPrefix)
                );
                
                if (cachedMatch) {
                    console.log(`Found token in cache: ${cachedMatch.currency}:${cachedMatch.issuer}`);
                    return {
                        success: true,
                        currency: cachedMatch.currency,
                        issuer: cachedMatch.issuer
                    };
                }
            }
            
            // Try to search for tokens with this issuer
            try {
                // Using the xrplmeta API to search
                const metaApiUrl = process.env.XRPLMETA_API_BASE || 'https://s1.xrplmeta.org';
                const response = await axios.get(`${metaApiUrl}/api/v1/token`, {
                    params: {
                        q: issuerPrefix,
                        limit: 20
                    }
                });
                
                if (response.data && Array.isArray(response.data.tokens)) {
                    // Find a match that starts with both prefixes
                    const match = response.data.tokens.find(token => 
                        token.currency && token.currency.startsWith(currencyPrefix) && 
                        token.issuer && token.issuer.startsWith(issuerPrefix)
                    );
                    
                    if (match) {
                        console.log(`Found token via API search: ${match.currency}:${match.issuer}`);
                        
                        // Cache this result for future lookups
                        if (!global.tokenCache) {
                            global.tokenCache = [];
                        }
                        
                        if (!global.tokenCache.some(t => t.currency === match.currency && t.issuer === match.issuer)) {
                            global.tokenCache.push(match);
                            
                            // Ensure cache doesn't grow too large
                            if (global.tokenCache.length > 100) {
                                global.tokenCache = global.tokenCache.slice(-100);
                            }
                        }
                        
                        return {
                            success: true,
                            currency: match.currency,
                            issuer: match.issuer
                        };
                    }
                }
            } catch (apiError) {
                console.error('Error searching token via API:', apiError.message);
            }
            
            // If we can't find a definitive match, return the prefixes
            return {
                success: false,
                message: 'No token found with these prefixes',
                currency: currencyPrefix,
                issuer: issuerPrefix
            };
        } catch (error) {
            console.error('Error in findTokenByPrefix:', error.message);
            return {
                success: false,
                message: error.message,
                currency: currencyPrefix,
                issuer: issuerPrefix
            };
        }
    }
}

module.exports = new TokenInfoService(); 