/**
 * XRPL Address Service
 * 
 * This service provides functions to fetch and parse XRPL address information
 * using either the Bithomp API or XRPScan API.
 */

const axios = require('axios');
const config = require('../config');

/**
 * Fetch address information from XRPL Explorer API.
 * @param {string} address - The XRPL address.
 * @returns {Promise<Object|null>} The JSON response from the API.
 */
async function fetchAddressInfo(address) {
  try {
    // First try using XRPScan API (no API key required)
    try {
      const xrpscanUrl = `${config.xrpscanApi.account}/${address}`;
      const xrpscanResponse = await axios.get(xrpscanUrl);
      
      // If successful, return the data with a source flag
      if (xrpscanResponse.data) {
        return { 
          ...xrpscanResponse.data,
          source: 'xrpscan'
        };
      }
    } catch (xrpscanError) {
      console.log('XRPScan API error, falling back to Bithomp:', xrpscanError.message);
    }
    
    // Fall back to Bithomp API if XRPScan fails
    const bithompUrl = `https://bithomp.com/api/v2/address/${address}?username=true&service=true&verifiedDomain=true&inception=true&ledgerInfo=true`;
    const bithompResponse = await axios.get(bithompUrl, {
      headers: {
        'x-bithomp-token': config.xrplExplorer.bithompApiKey
      }
    });
    
    // Return the data with a source flag
    return { 
      ...bithompResponse.data,
      source: 'bithomp'
    };
  } catch (error) {
    console.error('Error fetching address info:', error.message);
    return null;
  }
}

/**
 * Fetch token/asset information for an XRPL address.
 * @param {string} address - The XRPL address.
 * @returns {Promise<Array|null>} The assets held by the address.
 */
async function fetchAddressAssets(address) {
  try {
    const url = config.xrpscanApi.assets.replace('{address}', address);
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error('Error fetching address assets:', error.message);
    return null;
  }
}

/**
 * Fetch username information for an XRPL address from XRPScan.
 * @param {string} address - The XRPL address.
 * @returns {Promise<Object|null>} The username information.
 */
async function fetchUsernameInfo(address) {
  try {
    const url = config.xrpscanApi.username.replace('{address}', address);
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error('Error fetching username info:', error.message);
    return null;
  }
}

/**
 * Parse the address info to extract key details.
 * @param {Object} data - The JSON data returned from the API.
 * @returns {Object|null} - Parsed address information or null if no data.
 */
function parseAddressInfo(data) {
  if (!data) {
    console.error('No data to parse.');
    return null;
  }

  // Different parsing based on the source
  if (data.source === 'xrpscan') {
    return parseXRPScanData(data);
  } else {
    return parseBithompData(data);
  }
}

/**
 * Parse data from XRPScan API.
 * @param {Object} data - The data from XRPScan API.
 * @returns {Object} - Parsed address information.
 */
function parseXRPScanData(data) {
  // Extract username from the username object if it exists
  let username = null;
  if (data.username) {
    if (typeof data.username === 'object' && data.username.username) {
      username = data.username.username;
    } else if (typeof data.username === 'object' && data.username.name) {
      username = data.username.name;
    }
  }
  
  // Try to extract domain from the Domain field (hex encoded)
  let domain = null;
  if (data.Domain) {
    try {
      // Convert hex to ASCII
      domain = Buffer.from(data.Domain, 'hex').toString('ascii');
    } catch (error) {
      console.error('Error converting domain from hex:', error.message);
    }
  }
  
  // Extract service information
  let service = null;
  if (username || domain) {
    service = {
      name: username,
      domain: domain,
      twitter: data.username && typeof data.username === 'object' ? data.username.twitter : null
    };
  }
  
  return {
    address: data.Account || data.account,
    xAddress: data.xAddress,
    username: username,
    inception: data.activationDate ? Math.floor(new Date(data.activationDate).getTime() / 1000) : null,
    ledgerInfo: {
      activated: true, // If we have data, the account is activated
      ledger: data.previousAffectingTransactionLedgerVersion || null,
      balance: data.Balance || data.xrpBalance ? (parseFloat(data.Balance || data.xrpBalance) * (data.Balance ? 1 : 1000000)).toString() : "0",
      ownerCount: data.OwnerCount || data.ownerCount || 0
    },
    service: service
  };
}

/**
 * Parse data from Bithomp API.
 * @param {Object} data - The data from Bithomp API.
 * @returns {Object} - Parsed address information.
 */
function parseBithompData(data) {
  return {
    address: data.address,
    xAddress: data.xAddress,
    username: data.username,
    inception: data.inception,
    ledgerInfo: data.ledgerInfo ? {
      activated: data.ledgerInfo.activated,
      ledger: data.ledgerInfo.ledger,
      balance: data.ledgerInfo.balance,
      ownerCount: data.ledgerInfo.ownerCount
    } : null,
    service: data.service ? {
      name: data.service.name,
      domain: data.service.domain,
      twitter: data.service.socialAccounts ? data.service.socialAccounts.twitter : null
    } : null
  };
}

/**
 * Format address information into a readable message for Telegram.
 * @param {Object} parsedInfo - The parsed address information.
 * @returns {String} - Formatted message with HTML formatting.
 */
function formatAddressMessage(parsedInfo) {
  if (!parsedInfo) {
    return '❌ Could not retrieve address information.';
  }

  let message = `<b>🔍 XRPL Address Information</b>\n\n`;
  
  message += `<b>Address:</b> <code>${parsedInfo.address}</code>\n`;
  
  if (parsedInfo.xAddress) {
    message += `<b>X-Address:</b> <code>${parsedInfo.xAddress}</code>\n`;
  }
  
  if (parsedInfo.username) {
    message += `<b>Username:</b> ${parsedInfo.username}\n`;
  }
  
  if (parsedInfo.inception) {
    // Convert Unix timestamp (seconds) to milliseconds
    const date = new Date(parsedInfo.inception * 1000);
    message += `<b>Created:</b> ${date.toLocaleDateString()} ${date.toLocaleTimeString()}\n`;
  }
  
  if (parsedInfo.ledgerInfo) {
    message += `\n<b>Ledger Information:</b>\n`;
    
    if (parsedInfo.ledgerInfo.balance) {
      // Format the balance as XRP (divide by 1,000,000)
      const xrpBalance = parseFloat(parsedInfo.ledgerInfo.balance) / 1000000;
      message += `<b>Balance:</b> ${xrpBalance.toLocaleString()} XRP\n`;
    }
    
    if (parsedInfo.ledgerInfo.ownerCount !== undefined) {
      message += `<b>Owner Count:</b> ${parsedInfo.ledgerInfo.ownerCount}\n`;
    }
    
    if (parsedInfo.ledgerInfo.activated) {
      message += `<b>Activated:</b> Yes\n`;
    }
  }
  
  if (parsedInfo.service) {
    message += `\n<b>Service Information:</b>\n`;
    
    if (parsedInfo.service.name) {
      message += `<b>Name:</b> ${parsedInfo.service.name}\n`;
    }
    
    if (parsedInfo.service.domain) {
      message += `<b>Domain:</b> ${parsedInfo.service.domain}\n`;
    }
    
    if (parsedInfo.service.twitter) {
      message += `<b>Twitter:</b> @${parsedInfo.service.twitter}\n`;
    }
  }
  
  return message;
}

/**
 * Format asset information into a readable message for Telegram.
 * @param {Array} assets - The assets held by the address.
 * @returns {String} - Formatted message with HTML formatting.
 */
function formatAssetsMessage(assets) {
  if (!assets || assets.length === 0) {
    return '❌ No assets found for this address.';
  }

  let message = `<b>🪙 XRPL Assets</b>\n\n`;
  
  // Limit to top 10 assets to avoid message length issues
  const topAssets = assets.slice(0, 10);
  
  topAssets.forEach((asset, index) => {
    // Get the currency name
    let currency = asset.currency || 'Unknown';
    
    // Get the amount
    let amount = '';
    if (asset.value) {
      amount = parseFloat(asset.value).toLocaleString();
    } else if (asset.amount) {
      amount = parseFloat(asset.amount).toLocaleString();
    }
    
    // Get the issuer
    let issuer = '';
    if (asset.issuer) {
      issuer = asset.issuer;
    } else if (asset.counterparty) {
      issuer = asset.counterparty;
    }
    
    // Format the asset information
    message += `<b>${index + 1}. ${currency}</b>\n`;
    
    if (amount) {
      message += `   Amount: ${amount}\n`;
    }
    
    if (issuer) {
      message += `   Issuer: <code>${issuer}</code>\n`;
      
      // Add issuer name if available
      if (asset.counterpartyName) {
        let issuerName = '';
        if (typeof asset.counterpartyName === 'object' && asset.counterpartyName.username) {
          issuerName = asset.counterpartyName.username;
        } else if (typeof asset.counterpartyName === 'object' && asset.counterpartyName.name) {
          issuerName = asset.counterpartyName.name;
        } else if (typeof asset.counterpartyName === 'string') {
          issuerName = asset.counterpartyName;
        }
        
        if (issuerName) {
          message += `   Issuer Name: ${issuerName}\n`;
        }
      }
    }
    
    message += '\n';
  });
  
  if (assets.length > 10) {
    message += `<i>...and ${assets.length - 10} more assets</i>\n`;
  }
  
  return message;
}

/**
 * Get formatted address information for a given XRPL address.
 * @param {string} address - The XRPL address to look up.
 * @returns {Promise<String>} - Formatted message with address information.
 */
async function getAddressInfo(address) {
  try {
    // Send a loading message
    console.log(`Fetching comprehensive information for address: ${address}`);
    
    // Fetch data from all available sources in parallel
    const [addressData, assets] = await Promise.all([
      fetchAddressInfo(address),
      fetchAddressAssets(address)
    ]);
    
    // If using XRPScan and no username, try to fetch it separately
    if (addressData && addressData.source === 'xrpscan' && !addressData.username) {
      const usernameData = await fetchUsernameInfo(address);
      if (usernameData) {
        addressData.username = usernameData;
      }
    }
    
    const parsedInfo = parseAddressInfo(addressData);
    
    // Start building the comprehensive message
    let message = `<b>🔍 XRPL Address Report</b>\n\n`;
    
    // Basic Information Section
    message += `<b>📋 Basic Information</b>\n`;
    message += `<b>Address:</b> <code>${parsedInfo.address}</code>\n`;
    if (parsedInfo.xAddress) {
      message += `<b>X-Address:</b> <code>${parsedInfo.xAddress}</code>\n`;
    }
    if (parsedInfo.username) {
      message += `<b>Username:</b> ${parsedInfo.username}\n`;
    }
    if (parsedInfo.inception) {
      const date = new Date(parsedInfo.inception * 1000);
      const age = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
      message += `<b>Created:</b> ${date.toLocaleDateString()} (${age} days ago)\n`;
    }
    
    // Account Status Section
    message += `\n<b>💳 Account Status</b>\n`;
    if (parsedInfo.ledgerInfo) {
      if (parsedInfo.ledgerInfo.balance) {
        const xrpBalance = parseFloat(parsedInfo.ledgerInfo.balance) / 1000000;
        const usdValue = xrpBalance * 0.62; // Approximate USD value (you may want to fetch real-time price)
        message += `<b>Balance:</b> ${xrpBalance.toLocaleString()} XRP (≈$${usdValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})})\n`;
      }
      if (parsedInfo.ledgerInfo.ownerCount !== undefined) {
        message += `<b>Owner Count:</b> ${parsedInfo.ledgerInfo.ownerCount}\n`;
      }
      if (parsedInfo.ledgerInfo.activated) {
        message += `<b>Status:</b> Active ✅\n`;
      }
    }
    
    // Service Information Section
    if (parsedInfo.service) {
      message += `\n<b>🌐 Service Information</b>\n`;
      if (parsedInfo.service.name) {
        message += `<b>Name:</b> ${parsedInfo.service.name}\n`;
      }
      if (parsedInfo.service.domain) {
        message += `<b>Domain:</b> ${parsedInfo.service.domain}\n`;
      }
      if (parsedInfo.service.twitter) {
        message += `<b>Twitter:</b> @${parsedInfo.service.twitter}\n`;
      }
    }
    
    // Assets Section
    if (assets && assets.length > 0) {
      message += `\n<b>💎 Held Assets (Top ${Math.min(assets.length, 10)})</b>\n`;
      const topAssets = assets.slice(0, 10);
      
      topAssets.forEach((asset, index) => {
        const currency = asset.currency || 'Unknown';
        let amount = '';
        if (asset.value) {
          amount = parseFloat(asset.value).toLocaleString();
        } else if (asset.amount) {
          amount = parseFloat(asset.amount).toLocaleString();
        }
        
        message += `${index + 1}. <b>${currency}</b>: ${amount}\n`;
        
        if (asset.issuer || asset.counterparty) {
          const issuer = asset.issuer || asset.counterparty;
          message += `   └ Issuer: <code>${issuer}</code>`;
          
          if (asset.counterpartyName) {
            let issuerName = '';
            if (typeof asset.counterpartyName === 'object' && asset.counterpartyName.username) {
              issuerName = asset.counterpartyName.username;
            } else if (typeof asset.counterpartyName === 'object' && asset.counterpartyName.name) {
              issuerName = asset.counterpartyName.name;
            } else if (typeof asset.counterpartyName === 'string') {
              issuerName = asset.counterpartyName;
            }
            
            if (issuerName) {
              message += ` (${issuerName})`;
            }
          }
          message += '\n';
        }
      });
      
      if (assets.length > 10) {
        message += `<i>...and ${assets.length - 10} more assets</i>\n`;
      }
    }
    
    // Explorer Links Section
    message += `\n<b>🔗 Explorer Links</b>\n`;
    message += `• <a href="https://bithomp.com/explorer/${parsedInfo.address}">Bithomp</a>\n`;
    message += `• <a href="https://xrpscan.com/account/${parsedInfo.address}">XRPScan</a>\n`;
    message += `• <a href="https://xrpl.org/explorer/accounts/${parsedInfo.address}">XRPL Explorer</a>\n`;
    
    return message;
  } catch (error) {
    console.error('Error in getAddressInfo:', error);
    return '❌ An error occurred while retrieving address information.';
  }
}

/**
 * Get formatted asset information for a given XRPL address.
 * @param {string} address - The XRPL address to look up.
 * @returns {Promise<String>} - Formatted message with asset information.
 */
async function getAddressAssets(address) {
  try {
    const assets = await fetchAddressAssets(address);
    return formatAssetsMessage(assets);
  } catch (error) {
    console.error('Error in getAddressAssets:', error);
    return '❌ An error occurred while retrieving asset information.';
  }
}

module.exports = {
  fetchAddressInfo,
  fetchAddressAssets,
  fetchUsernameInfo,
  parseAddressInfo,
  formatAddressMessage,
  formatAssetsMessage,
  getAddressInfo,
  getAddressAssets
}; 