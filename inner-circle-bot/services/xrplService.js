const xrpl = require("xrpl");

/**
 * Connect to XRPL network
 * @returns {Object} XRPL client
 */
const connectToXRPL = async () => {
    try {
        const client = new xrpl.Client("wss://xrplcluster.com");
        await client.connect();
        console.log("✅ Connected to XRPL");
        return client;
    } catch (error) {
        console.error("❌ XRPL Connection Failed:", error.message);
        throw error;
    }
};

/**
 * Disconnect from XRPL network
 * @param {Object} client - XRPL client
 */
const disconnectFromXRPL = async (client) => {
    if (client && client.isConnected()) {
        await client.disconnect();
        console.log("✅ Disconnected from XRPL");
    }
};

/**
 * Get account information from XRPL
 * @param {string} address - The account address
 * @returns {Object} Account information
 */
const getAccountInfo = async (address) => {
    let client;
    
    try {
        client = await connectToXRPL();
        
        const response = await client.request({
            command: "account_info",
            account: address,
            ledger_index: "validated"
        });
        
        return {
            success: true,
            balance: xrpl.dropsToXrp(response.result.account_data.Balance),
            sequence: response.result.account_data.Sequence,
            domain: response.result.account_data.Domain ? 
                Buffer.from(response.result.account_data.Domain, 'hex').toString('utf8') : null,
            details: response.result.account_data
        };
    } catch (error) {
        console.error(`❌ Failed to get account info for ${address}:`, error.message);
        return {
            success: false,
            message: `❌ Error retrieving account info: ${error.message}`,
            details: error
        };
    } finally {
        if (client) {
            await disconnectFromXRPL(client);
        }
    }
};

/**
 * Get gateway balances (issued currencies) from XRPL
 * @param {string} address - The issuer address
 * @returns {Object} Gateway balances information
 */
const getGatewayBalances = async (address, hotWallets = []) => {
    let client;
    
    try {
        client = await connectToXRPL();
        
        const response = await client.request({
            command: "gateway_balances",
            account: address,
            ledger_index: "validated",
            hotwallet: hotWallets
        });
        
        return {
            success: true,
            obligations: response.result.obligations || {},
            balances: response.result.balances || {},
            assets: response.result.assets || {},
            details: response.result
        };
    } catch (error) {
        console.error(`❌ Failed to get gateway balances for ${address}:`, error.message);
        return {
            success: false,
            message: `❌ Error retrieving gateway balances: ${error.message}`,
            details: error
        };
    } finally {
        if (client) {
            await disconnectFromXRPL(client);
        }
    }
};

/**
 * Get account trust lines from XRPL
 * @param {string} address - The account address
 * @param {Object} options - Options for the request
 * @returns {Object} Account lines information
 */
const getAccountLines = async (address, options = {}) => {
    let client;
    
    try {
        client = await connectToXRPL();
        
        const request = {
            command: "account_lines",
            account: address,
            ledger_index: "validated"
        };
        
        if (options.limit) request.limit = options.limit;
        if (options.marker) request.marker = options.marker;
        
        const response = await client.request(request);
        
        return {
            success: true,
            lines: response.result.lines || [],
            marker: response.result.marker,
            details: response.result
        };
    } catch (error) {
        console.error(`❌ Failed to get account lines for ${address}:`, error.message);
        return {
            success: false,
            message: `❌ Error retrieving account lines: ${error.message}`,
            details: error
        };
    } finally {
        if (client) {
            await disconnectFromXRPL(client);
        }
    }
};

/**
 * Validate an XRPL address
 * @param {string} address - The address to validate
 * @returns {boolean} Whether the address is valid
 */
const isValidXRPLAddress = (address) => {
    try {
        return xrpl.isValidAddress(address);
    } catch (error) {
        return false;
    }
};

/**
 * Fetch the XRPL Toml file from a domain
 * @param {string} domain - The domain to fetch the TOML from
 * @returns {Object} The parsed TOML file or null if not found
 */
const fetchXrplToml = async (domain) => {
    if (!domain) return null;
    
    try {
        const axios = require('axios');
        const tomlUrl = `https://${domain}/.well-known/xrp-ledger.toml`;
        const response = await axios.get(tomlUrl, { timeout: 5000 });
        
        if (response.status === 200) {
            // Simple TOML parser - for a real implementation, use a proper TOML library
            const toml = {};
            const lines = response.data.split('\n');
            let currentSection = '';
            
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine === '' || trimmedLine.startsWith('#')) continue;
                
                if (trimmedLine.startsWith('[') && trimmedLine.endsWith(']')) {
                    currentSection = trimmedLine.substring(1, trimmedLine.length - 1);
                    toml[currentSection] = {};
                } else if (currentSection && trimmedLine.includes('=')) {
                    const parts = trimmedLine.split('=').map(p => p.trim());
                    const key = parts[0];
                    let value = parts.slice(1).join('=');
                    
                    // Remove quotes if present
                    if (value.startsWith('"') && value.endsWith('"')) {
                        value = value.substring(1, value.length - 1);
                    }
                    
                    toml[currentSection][key] = value;
                }
            }
            
            return {
                success: true,
                toml: toml
            };
        }
        
        return {
            success: false,
            message: `Failed to fetch TOML file: HTTP ${response.status}`
        };
    } catch (error) {
        console.error(`❌ Failed to fetch TOML file from ${domain}:`, error.message);
        return {
            success: false,
            message: `Error fetching TOML file: ${error.message}`
        };
    }
};

module.exports = {
    connectToXRPL,
    disconnectFromXRPL,
    getAccountInfo,
    getGatewayBalances,
    getAccountLines,
    isValidXRPLAddress,
    fetchXrplToml
}; 