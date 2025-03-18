const path = require('path');
const fs = require('fs');
const axios = require('axios');

// Define image paths
const IMAGES = {
    WELCOME: path.join(__dirname, '../images/welcome.gif'),
    OFFICIAL_CALL: path.join(__dirname, '../images/official_call.gif'),
    COMMUNITY_VOTE: path.join(__dirname, '../images/community_vote.gif'),
    PARTNER: path.join(__dirname, '../images/partner.gif'),
    LOGO: path.join(__dirname, '../images/logo.png')
};

/**
 * Check if an image exists
 * @param {string} imagePath - Path to the image
 * @returns {boolean} Whether the image exists
 */
const imageExists = (imagePath) => {
    try {
        return fs.existsSync(imagePath);
    } catch (error) {
        console.error(`Error checking if image exists: ${error.message}`);
        return false;
    }
};

/**
 * Get image path by type
 * @param {string} type - Type of image (WELCOME, OFFICIAL_CALL, etc.)
 * @returns {string|null} Path to the image or null if not found
 */
const getImagePath = (type) => {
    const imagePath = IMAGES[type];
    return imageExists(imagePath) ? imagePath : null;
};

/**
 * Try to fetch a token image URL from the issuer's TOML file
 * @param {string} currency - The currency code
 * @param {string} issuer - The issuer address
 * @param {string|null} domain - The domain to fetch TOML from (optional)
 * @returns {Promise<string|null>} The token image URL or null if not found
 */
const getTokenImageFromToml = async (currency, issuer, domain) => {
    if (!domain) return null;
    
    try {
        console.log(`Attempting to fetch token image from TOML for ${currency}:${issuer} using domain ${domain}`);
        
        // Try well-known locations for TOML files
        const tomlLocations = [
            `https://${domain}/.well-known/xrp-ledger.toml`,
            `https://${domain}/.well-known/ripple.toml`,
            `https://${domain}/xrp-ledger.toml`,
            `https://${domain}/ripple.toml`
        ];
        
        let tomlData = null;
        let fetchedFromUrl = null;
        
        // Try each location until we find a valid TOML file
        for (const tomlUrl of tomlLocations) {
            try {
                console.log(`Trying TOML URL: ${tomlUrl}`);
                const response = await axios.get(tomlUrl, { 
                    timeout: 5000,
                    validateStatus: status => status === 200
                });
                
                if (response.status === 200 && response.data) {
                    tomlData = response.data;
                    fetchedFromUrl = tomlUrl;
                    console.log(`Successfully fetched TOML from ${tomlUrl}`);
                    break;
                }
            } catch (err) {
                // Silent catch, try next URL
                console.log(`Failed to fetch from ${tomlUrl}: ${err.message}`);
                continue;
            }
        }
        
        if (!tomlData) {
            console.log(`No TOML file found for domain ${domain}`);
            return null;
        }
        
        // For debugging - dump the TOML content
        console.log(`TOML content (first 500 chars):\n${tomlData.substring(0, 500)}...`);
        
        // Parse TOML file to look for token image URLs
        // First try currency specific sections
        const currencyCode = typeof currency === 'string' ? 
            currency.replace(/0+$/, '') : // Remove trailing zeros for hex currencies
            currency;
            
        // For hex currencies, also try the ASCII representation
        let currencyAsAscii = '';
        if (currencyCode.match(/^[0-9A-F]+$/i)) {
            try {
                // Try to convert from hex to ASCII if it appears to be a hex string
                currencyAsAscii = Buffer.from(currencyCode, 'hex').toString('utf8').replace(/\u0000/g, '');
                console.log(`Converted hex currency to ASCII: ${currencyAsAscii}`);
            } catch (e) {
                console.log(`Failed to convert currency from hex to ASCII: ${e.message}`);
            }
        }
        
        // Search patterns to try (in order of specificity)
        const searchTerms = [
            currency,
            currencyCode,
            currencyAsAscii
        ].filter(Boolean); // Remove empty strings
        
        console.log(`Will search for these currency codes in TOML: ${JSON.stringify(searchTerms)}`);
        
        // Special case for the [[TOKENS]] section format which is common in XRPL TOML files
        // This section often contains an 'icon' field for the token image
        const tokensRegex = /\[\[TOKENS\]\]([\s\S]*?)(\[\[|$)/gi;
        let tokensMatch;
        let logoFound = null;
        
        while ((tokensMatch = tokensRegex.exec(tomlData)) !== null) {
            const tokenSection = tokensMatch[1];
            
            // Check if this token section matches our currency and issuer
            const currencyMatches = searchTerms.some(term => 
                tokenSection.includes(`currency = "${term}"`) || 
                tokenSection.includes(`currency = '${term}'`) ||
                tokenSection.includes(`currency = ${term}`)
            );
            
            const issuerMatches = 
                tokenSection.includes(`issuer = "${issuer}"`) || 
                tokenSection.includes(`issuer = '${issuer}'`) ||
                tokenSection.includes(`issuer = ${issuer}`);
            
            if (currencyMatches && issuerMatches) {
                console.log(`Found matching TOKENS section for ${currency}:${issuer}`);
                
                // Look for icon, logo, or image field
                const iconRegex = /\bicon\s*=\s*["']?(https?:\/\/[^"'\s]+)["']?/i;
                const logoRegex = /\blogo\s*=\s*["']?(https?:\/\/[^"'\s]+)["']?/i;
                const imageRegex = /\bimage\s*=\s*["']?(https?:\/\/[^"'\s]+)["']?/i;
                
                const iconMatch = tokenSection.match(iconRegex);
                const logoMatch = tokenSection.match(logoRegex);
                const imageMatch = tokenSection.match(imageRegex);
                
                if (iconMatch && iconMatch[1]) {
                    logoFound = iconMatch[1];
                    console.log(`Found icon in TOKENS section: ${logoFound}`);
                    break;
                }
                
                if (logoMatch && logoMatch[1]) {
                    logoFound = logoMatch[1];
                    console.log(`Found logo in TOKENS section: ${logoFound}`);
                    break;
                }
                
                if (imageMatch && imageMatch[1]) {
                    logoFound = imageMatch[1];
                    console.log(`Found image in TOKENS section: ${logoFound}`);
                    break;
                }
            }
        }
        
        // If we still haven't found a logo, check the original TOML parsing methods
        if (!logoFound) {
            // Look for sections that might contain our currency info
            const lines = tomlData.split('\n');
            let currentSection = '';
            let insideCurrenciesSection = false;
            let currencySection = null;
            let allSections = [];
            
            // First pass - collect all section names for debugging
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine === '' || trimmedLine.startsWith('#')) continue;
                
                if (trimmedLine.startsWith('[') && trimmedLine.endsWith(']')) {
                    const section = trimmedLine.substring(1, trimmedLine.length - 1);
                    allSections.push(section);
                }
            }
            
            console.log(`Found these sections in TOML: ${JSON.stringify(allSections)}`);
            
            // Second pass - scan all potential image/logo fields
            for (const line of lines) {
                const trimmedLine = line.trim().toLowerCase();
                if (trimmedLine === '' || trimmedLine.startsWith('#')) continue;
                
                // Check for section headers
                if (trimmedLine.startsWith('[') && trimmedLine.endsWith(']')) {
                    currentSection = trimmedLine.substring(1, trimmedLine.length - 1).toUpperCase();
                    
                    // Check if we're entering a currencies section
                    if (currentSection === 'CURRENCIES') {
                        insideCurrenciesSection = true;
                        console.log(`Found CURRENCIES section`);
                    } else if (currentSection.startsWith('CURRENCIES.')) {
                        // This might be a currency-specific section like [CURRENCIES.XRP]
                        const sectionCurrency = currentSection.substring('CURRENCIES.'.length);
                        console.log(`Found currency section: ${sectionCurrency}`);
                        
                        // Check if this section matches any of our search terms
                        for (const term of searchTerms) {
                            if (sectionCurrency.includes(term) || term.includes(sectionCurrency)) {
                                currencySection = currentSection;
                                console.log(`Match found! Using section: ${currencySection}`);
                                break;
                            }
                        }
                    } else {
                        insideCurrenciesSection = false;
                    }
                    
                    continue;
                }
                
                // If we're in a section for our currency, look for image/logo
                if (currencySection && currentSection === currencySection && trimmedLine.includes('=')) {
                    const parts = trimmedLine.split('=').map(p => p.trim());
                    const key = parts[0].toLowerCase();
                    let value = parts.slice(1).join('=').trim();
                    
                    // Remove quotes if present
                    if (value.startsWith('"') && value.endsWith('"')) {
                        value = value.substring(1, value.length - 1);
                    }
                    
                    // Check for image/logo keys
                    if (key === 'image' || key === 'logo' || key === 'icon' || key.includes('logo') || key.includes('image') || key.includes('icon')) {
                        logoFound = value;
                        console.log(`Found logo in currency-specific section: ${logoFound}`);
                        break;
                    }
                }
                
                // Generic scan for all image/logo fields regardless of section
                if (trimmedLine.includes('image=') || 
                    trimmedLine.includes('logo=') || 
                    trimmedLine.includes('icon=') ||
                    trimmedLine.includes('logo_uri=') ||
                    trimmedLine.includes('image_uri=') ||
                    trimmedLine.includes('icon_uri=')) {
                    
                    const parts = trimmedLine.split('=').map(p => p.trim());
                    let value = parts.slice(1).join('=').trim();
                    
                    // Remove quotes if present
                    if (value.startsWith('"') && value.endsWith('"')) {
                        value = value.substring(1, value.length - 1);
                    }
                    
                    // Only use this as a fallback if we don't find a more specific match
                    if (!logoFound) {
                        logoFound = value;
                        console.log(`Found generic logo in section ${currentSection}: ${logoFound}`);
                    }
                }
                
                // If we're in the general currencies section, check for our currency and image
                if (insideCurrenciesSection && trimmedLine.includes('=')) {
                    const parts = trimmedLine.split('=').map(p => p.trim());
                    const key = parts[0].toLowerCase();
                    let value = parts.slice(1).join('=').trim();
                    
                    // Remove quotes if present
                    if (value.startsWith('"') && value.endsWith('"')) {
                        value = value.substring(1, value.length - 1);
                    }
                    
                    // Check if this line contains any of our search terms
                    const matchesCurrency = searchTerms.some(term => 
                        (key === 'code' && (value.includes(term) || term.includes(value))) ||
                        (key === 'currency' && (value.includes(term) || term.includes(value)))
                    );
                    
                    if (matchesCurrency) {
                        console.log(`Found currency match in CURRENCIES section: ${key}=${value}`);
                        
                        // Next few lines might contain the image
                        let i = lines.indexOf(line) + 1;
                        while (i < lines.length && i < lines.indexOf(line) + 15) {
                            const nextLine = lines[i].trim().toLowerCase();
                            if (nextLine.startsWith('[')) break; // New section
                            
                            if (nextLine.includes('image=') || 
                                nextLine.includes('logo=') || 
                                nextLine.includes('icon=') ||
                                nextLine.includes('logo_uri=') ||
                                nextLine.includes('image_uri=') ||
                                nextLine.includes('icon_uri=')) {
                                
                                const imgParts = nextLine.split('=');
                                let imgValue = imgParts.slice(1).join('=').trim();
                                
                                if (imgValue.startsWith('"') && imgValue.endsWith('"')) {
                                    imgValue = imgValue.substring(1, imgValue.length - 1);
                                }
                                
                                logoFound = imgValue;
                                console.log(`Found logo in currencies section: ${logoFound}`);
                                break;
                            }
                            i++;
                        }
                    }
                }
            }
            
            // Also check if there's a general logo in the [ISSUER] section
            if (!logoFound) {
                let inIssuerSection = false;
                
                for (const line of lines) {
                    const trimmedLine = line.trim().toLowerCase();
                    if (trimmedLine === '' || trimmedLine.startsWith('#')) continue;
                    
                    if (trimmedLine === '[issuer]') {
                        inIssuerSection = true;
                        console.log(`Found ISSUER section`);
                        continue;
                    }
                    
                    if (inIssuerSection && trimmedLine.startsWith('[')) {
                        // End of issuer section
                        inIssuerSection = false;
                        continue;
                    }
                    
                    if (inIssuerSection && 
                       (trimmedLine.includes('logo=') || 
                        trimmedLine.includes('icon=') ||
                        trimmedLine.includes('image=') ||
                        trimmedLine.includes('logo_uri=') ||
                        trimmedLine.includes('image_uri=') ||
                        trimmedLine.includes('icon_uri='))) {
                        
                        const imgParts = trimmedLine.split('=');
                        let imgValue = imgParts.slice(1).join('=').trim();
                        
                        if (imgValue.startsWith('"') && imgValue.endsWith('"')) {
                            imgValue = imgValue.substring(1, imgValue.length - 1);
                        }
                        
                        logoFound = imgValue;
                        console.log(`Found logo in issuer section: ${logoFound}`);
                        break;
                    }
                }
            }
            
            // Final fallback - search for any URL that might be an image
            if (!logoFound) {
                const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
                
                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (trimmedLine === '' || trimmedLine.startsWith('#')) continue;
                    
                    // Look for anything that seems like an image URL
                    if (trimmedLine.includes('=')) {
                        const parts = trimmedLine.split('=').map(p => p.trim());
                        let value = parts.slice(1).join('=').trim();
                        
                        // Remove quotes if present
                        if (value.startsWith('"') && value.endsWith('"')) {
                            value = value.substring(1, value.length - 1);
                        }
                        
                        // Check if it's a URL and has an image extension
                        if (value.startsWith('http') && 
                            imageExtensions.some(ext => value.toLowerCase().endsWith(ext))) {
                            logoFound = value;
                            console.log(`Found image URL by extension: ${logoFound}`);
                            break;
                        }
                    }
                }
            }
        }
        
        if (logoFound) {
            // Make sure the URL is absolute
            if (!logoFound.startsWith('http')) {
                logoFound = `https://${domain}/${logoFound.replace(/^\//, '')}`;
            }
            
            console.log(`Final token image URL: ${logoFound}`);
            return logoFound;
        }
        
        console.log(`No image found in TOML for ${currency}:${issuer}`);
        return null;
    } catch (error) {
        console.error(`Error fetching token image from TOML: ${error.message}`);
        return null;
    }
};

/**
 * Send an image with caption
 * @param {Object} bot - Telegram bot instance
 * @param {number} chatId - Chat ID to send the image to
 * @param {string} type - Type of image (WELCOME, OFFICIAL_CALL, etc.)
 * @param {string} caption - Caption for the image
 * @param {Object} options - Additional options for sending the image
 * @returns {Promise<Object|null>} Sent message or null if image not found
 */
const sendImage = async (bot, chatId, type, caption, options = {}) => {
    const imagePath = getImagePath(type);
    
    if (!imagePath) {
        console.warn(`Image of type ${type} not found.`);
        // Send just the text if image not found
        return bot.sendMessage(chatId, caption, options);
    }
    
    try {
        // Determine if it's a GIF or other image
        const isGif = imagePath.toLowerCase().endsWith('.gif');
        
        if (isGif) {
            return bot.sendAnimation(chatId, imagePath, {
                caption,
                parse_mode: 'Markdown',
                ...options
            });
        } else {
            return bot.sendPhoto(chatId, imagePath, {
                caption,
                parse_mode: 'Markdown',
                ...options
            });
        }
    } catch (error) {
        console.error(`Error sending image: ${error.message}`);
        // Fallback to just sending the text
        return bot.sendMessage(chatId, caption, options);
    }
};

module.exports = {
    IMAGES,
    imageExists,
    getImagePath,
    sendImage,
    getTokenImageFromToml
}; 