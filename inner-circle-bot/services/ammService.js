const config = require('../config');
const xrplService = require('./xrplService');
const axios = require('axios');

/**
 * AMM Service for interacting with XRPL AMMs
 */

/**
 * Get AMM information for a token
 * @param {string} currency - Token currency code
 * @param {string} issuer - Token issuer address
 * @returns {Promise<object>} - AMM information
 */
const getAMMInfo = async (currency, issuer) => {
    try {
        // Connect to XRPL
        const api = await xrplService.getXrplApi();
        
        // Convert currency format if needed (hex for non-standard currencies)
        const formattedCurrency = currency.length > 3 
            ? currency 
            : currency;
        
        // Get AMM account
        const ammAccount = await findAMMAccount(api, formattedCurrency, issuer);
        
        if (!ammAccount) {
            return {
                success: false,
                message: 'No AMM found for this token'
            };
        }
        
        // Get AMM info
        const ammInfo = await api.request({
            command: 'account_info',
            account: ammAccount,
            ledger_index: 'validated'
        });
        
        // Get AMM balances
        const ammBalances = await api.request({
            command: 'account_lines',
            account: ammAccount,
            ledger_index: 'validated'
        });
        
        // Extract the token balance and XRP balance
        const tokenBalance = ammBalances.result.lines.find(
            line => line.currency === formattedCurrency && line.account === issuer
        );
        
        const xrpBalance = ammInfo.result.account_data.Balance / 1000000; // Convert drops to XRP
        
        return {
            success: true,
            amm: {
                account: ammAccount,
                tokenBalance: tokenBalance ? parseFloat(tokenBalance.balance) : 0,
                xrpBalance,
                lpTokens: 0, // Would need additional calls to get LP tokens
                tradingFee: 0.005 // Default fee, would need additional calls to get actual fee
            }
        };
    } catch (error) {
        console.error('Error getting AMM info:', error);
        return {
            success: false,
            message: error.message || 'Error fetching AMM information'
        };
    }
};

/**
 * Find the AMM account for a token pair (token/XRP)
 * @param {object} api - XRPL API instance
 * @param {string} currency - Token currency code
 * @param {string} issuer - Token issuer address
 * @returns {Promise<string|null>} - AMM account address or null if not found
 */
const findAMMAccount = async (api, currency, issuer) => {
    try {
        // This is a simplified approach. In a real implementation,
        // you would need to query the AMM info using the AMM endpoint
        // or search for AMM accounts based on token pair relationships
        
        // For now, we'll use an external API to find AMM accounts
        const response = await axios.get(
            `https://api.xrpldata.com/api/v1/amm/pairs?asset1=XRP&asset2=${currency}&issuer2=${issuer}`
        );
        
        if (response.data && response.data.data && response.data.data.length > 0) {
            return response.data.data[0].amm_account;
        }
        
        return null;
    } catch (error) {
        console.error('Error finding AMM account:', error);
        return null;
    }
};

/**
 * Calculate token price based on AMM reserves
 * @param {number} tokenReserve - Token reserve in the AMM
 * @param {number} xrpReserve - XRP reserve in the AMM
 * @returns {number} - Token price in XRP
 */
const calculateTokenPrice = (tokenReserve, xrpReserve) => {
    if (tokenReserve <= 0) return 0;
    return xrpReserve / tokenReserve;
};

/**
 * Get token price from AMM
 * @param {string} currency - Token currency code
 * @param {string} issuer - Token issuer address
 * @returns {Promise<object>} - Token price information
 */
const getTokenPriceFromAMM = async (currency, issuer) => {
    try {
        const ammInfo = await getAMMInfo(currency, issuer);
        
        if (!ammInfo.success) {
            return {
                success: false,
                message: ammInfo.message
            };
        }
        
        const { tokenBalance, xrpBalance } = ammInfo.amm;
        const price = calculateTokenPrice(tokenBalance, xrpBalance);
        
        return {
            success: true,
            price,
            tokenReserve: tokenBalance,
            xrpReserve: xrpBalance
        };
    } catch (error) {
        console.error('Error getting token price from AMM:', error);
        return {
            success: false,
            message: error.message || 'Error calculating token price'
        };
    }
};

module.exports = {
    getAMMInfo,
    getTokenPriceFromAMM,
    calculateTokenPrice
}; 