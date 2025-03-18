require('dotenv').config();
const tokenInfoService = require('./services/tokenInfoService');

// Command-line arguments
const args = process.argv.slice(2);
const command = args[0];

/**
 * Print usage instructions
 */
function printUsage() {
    console.log('XRP Ledger Token Information Tool');
    console.log('================================');
    console.log('');
    console.log('Usage:');
    console.log('  node index.js info <currency> <issuer>   - Get detailed token information');
    console.log('  node index.js search <query>             - Search for tokens by name');
    console.log('  node index.js holders <issuer>           - Get token holders for an issuer');
    console.log('');
    console.log('Examples:');
    console.log('  node index.js info USD rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B');
    console.log('  node index.js search Bitstamp');
    console.log('  node index.js holders rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B');
}

/**
 * Get token information
 */
async function getTokenInfo(currency, issuer) {
    try {
        console.log(`Fetching information for token ${currency}:${issuer}...`);
        const result = await tokenInfoService.getTokenInformation(currency, issuer);
        
        if (result.success) {
            const description = tokenInfoService.formatTokenDescription(result);
            console.log(description);
        } else {
            console.error(`Error: ${result.message}`);
        }
    } catch (error) {
        console.error('An error occurred:', error.message);
    }
}

/**
 * Search for tokens
 */
async function searchForTokens(query) {
    try {
        console.log(`Searching for tokens matching "${query}"...`);
        const result = await tokenInfoService.searchTokens(query);
        
        if (result.success) {
            console.log(`Found ${result.tokens.length} tokens:`);
            console.log('');
            
            result.tokens.forEach((token, index) => {
                console.log(`${index + 1}. ${token.meta?.name || 'Unknown'} (${token.currency}:${token.issuer})`);
                
                if (token.meta?.description) {
                    console.log(`   Description: ${token.meta.description}`);
                }
                
                if (token.metrics?.trustlines) {
                    console.log(`   Trustlines: ${token.metrics.trustlines}`);
                }
                
                if (token.metrics?.holders) {
                    console.log(`   Holders: ${token.metrics.holders}`);
                }
                
                console.log('');
            });
        } else {
            console.error(`Error: ${result.message}`);
        }
    } catch (error) {
        console.error('An error occurred:', error.message);
    }
}

/**
 * Get token holders
 */
async function getHolders(issuer) {
    try {
        console.log(`Fetching holders for issuer ${issuer}...`);
        const result = await tokenInfoService.getTokenHolders(issuer);
        
        if (result.success) {
            console.log(`Found ${result.holders.length} holders:`);
            console.log('');
            
            result.holders.forEach((holder, index) => {
                console.log(`${index + 1}. Account: ${holder.account}`);
                console.log(`   Currency: ${holder.currency}`);
                console.log(`   Balance: ${holder.balance}`);
                console.log(`   Limit: ${holder.limit}`);
                console.log('');
            });
            
            if (result.marker) {
                console.log('More holders available. Use pagination to see more.');
            }
        } else {
            console.error(`Error: ${result.message}`);
        }
    } catch (error) {
        console.error('An error occurred:', error.message);
    }
}

/**
 * Main function
 */
async function main() {
    if (!command || command === 'help') {
        printUsage();
        return;
    }
    
    switch (command) {
        case 'info':
            const currency = args[1];
            const issuer = args[2];
            
            if (!currency || !issuer) {
                console.error('Error: Both currency and issuer are required');
                printUsage();
                return;
            }
            
            await getTokenInfo(currency, issuer);
            break;
            
        case 'search':
            const query = args[1];
            
            if (!query) {
                console.error('Error: Search query is required');
                printUsage();
                return;
            }
            
            await searchForTokens(query);
            break;
            
        case 'holders':
            const holderIssuer = args[1];
            
            if (!holderIssuer) {
                console.error('Error: Issuer address is required');
                printUsage();
                return;
            }
            
            await getHolders(holderIssuer);
            break;
            
        default:
            console.error(`Unknown command: ${command}`);
            printUsage();
    }
}

// Run the main function
main().catch(error => {
    console.error('Fatal error:', error);
}).finally(() => {
    // Ensure the process exits properly
    setTimeout(() => process.exit(), 1000);
}); 