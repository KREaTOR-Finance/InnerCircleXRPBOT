const Project = require('../db/models/Project');
const tokenService = require('./tokenService');
const config = require('../config');

/**
 * Submit a new project
 * @param {string} contractAddress - The contract address of the project
 * @param {string} submittedBy - The user ID who submitted the project
 * @param {string} chatId - The chat ID where the project was submitted
 * @returns {Object} The created project or error
 */
const submitProject = async (contractAddress, submittedBy, chatId = null) => {
    try {
        // Clean up the contract address
        const cleanAddress = contractAddress.trim();
        
        // Check if project already exists
        const existingProject = await Project.findOne({ contractAddress: cleanAddress });
        
        if (existingProject) {
            return {
                success: false,
                message: "❌ This project has already been submitted.",
                project: existingProject
            };
        }
        
        // Fetch token data from token service
        const tokenData = await tokenService.getTokenByAddress(cleanAddress);
        
        if (!tokenData) {
            // Check if it's a valid XRPL address
            const xrplService = require('./xrplService');
            if (xrplService.isValidXRPLAddress(cleanAddress)) {
                return {
                    success: false,
                    message: "❌ Valid XRPL address, but no token data found. This might be a new token not yet listed on DEXes. Please try again later when the token has more liquidity and trading activity."
                };
            } else {
                return {
                    success: false,
                    message: "❌ Invalid XRPL address format. Please check the contract address and try again."
                };
            }
        }
        
        // If token is unknown but address is valid, allow submission with minimal data
        if (tokenData.symbol === "UNKNOWN") {
            // Try to get more accurate token data from other sources
            let tokenName = "Unknown Token";
            let tokenSymbol = "UNKNOWN";
            let logoUrl = null;
            
            try {
                // Try to get token data from XRPL directly
                const xrplService = require('./xrplService');
                const xrplTokenData = await xrplService.getTokenInfo(cleanAddress);
                
                if (xrplTokenData && xrplTokenData.name) {
                    tokenName = xrplTokenData.name;
                    if (xrplTokenData.symbol) {
                        tokenSymbol = xrplTokenData.symbol;
                    }
                    if (xrplTokenData.logo) {
                        logoUrl = xrplTokenData.logo;
                    }
                    console.log(`Found token name from XRPL: ${tokenName} (${tokenSymbol})`);
                }
            } catch (error) {
                console.error(`Error getting token data from XRPL: ${error.message}`);
            }
            
            // If no logo found, generate a default logo URL based on the token symbol
            if (!logoUrl) {
                logoUrl = `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/xrpl/assets/${cleanAddress}/logo.png`;
                console.log(`Using default logo URL: ${logoUrl}`);
            }
            
            // Create new project with pending status and minimal data
            const newProject = new Project({
                name: tokenName,
                symbol: tokenSymbol,
                contractAddress: cleanAddress,
                marketCap: 0,
                liquidity: 0,
                initialPrice: 0,
                currentPrice: 0,
                chartUrl: `https://xrpscan.com/account/${cleanAddress}`,
                logo: logoUrl,
                submittedBy,
                submittedInChat: chatId,
                status: config.projectStatuses.pending // Set to pending initially
            });
            
            await newProject.save();
            
            console.log(`Project saved to database: ${newProject._id} - Name: ${newProject.name} (${newProject.symbol}), Address: ${newProject.contractAddress}`);
            
            return {
                success: true,
                message: `✅ Project submitted successfully!\n\n` +
                         `Note: This token doesn't have market data yet. It might be very new or not yet listed on DEXes. Admins will review your submission.\n\n` +
                         `Once approved, community members will be able to grade this project based on the following criteria:\n\n` +
                         `⭐ *Meme Character & Branding*: Quality of meme, branding, and community appeal\n` +
                         `⭐ *Roadmap & Vision*: Project's goals, roadmap clarity, and innovation\n` +
                         `⭐ *Team & Dev Activity*: Team's experience, transparency, and development activity\n\n` +
                         `Each category will be rated on a scale of 1-4 stars. The project's overall rating will be calculated based on these community votes.`,
                project: newProject
            };
        }
        
        // Extract liquidity value properly
        let liquidityValue = 0;
        if (tokenData.liquidity) {
            if (typeof tokenData.liquidity === 'object' && tokenData.liquidity.usd !== undefined) {
                liquidityValue = parseFloat(tokenData.liquidity.usd);
            } else if (typeof tokenData.liquidity === 'number') {
                liquidityValue = tokenData.liquidity;
            } else if (typeof tokenData.liquidity === 'string') {
                liquidityValue = parseFloat(tokenData.liquidity);
            }
        }
        
        // Ensure name is provided
        const tokenName = tokenData.name || "Unknown Token";
        const tokenSymbol = tokenData.symbol || "UNKNOWN";
        
        // Log token data before saving
        console.log(`Token data from service: Name: ${tokenData.name}, Symbol: ${tokenData.symbol}, Address: ${cleanAddress}`);
        
        // Extract logo URL
        let logoUrl = tokenData.logo || null;
        
        // If no logo found, generate a default logo URL based on the token symbol
        if (!logoUrl) {
            logoUrl = `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/xrpl/assets/${cleanAddress}/logo.png`;
            console.log(`Using default logo URL: ${logoUrl}`);
        }
        
        // Create new project with pending status
        const newProject = new Project({
            name: tokenName,
            symbol: tokenSymbol,
            contractAddress: cleanAddress,
            marketCap: tokenData.marketCap || 0,
            liquidity: liquidityValue,
            initialPrice: tokenData.price || 0,
            currentPrice: tokenData.price || 0,
            chartUrl: tokenData.chartUrl || `https://xrpscan.com/account/${cleanAddress}`,
            logo: logoUrl,
            submittedBy,
            submittedInChat: chatId,
            status: config.projectStatuses.pending // Set to pending initially
        });
        
        await newProject.save();
        
        console.log(`Project saved to database: ${newProject._id} - Name: ${newProject.name} (${newProject.symbol}), Address: ${newProject.contractAddress}`);
        
        return {
            success: true,
            message: `✅ Project *${tokenName} (${tokenSymbol})* submitted successfully!\n\n` +
                     `Your submission is now pending admin approval. Once approved, community members will be able to grade this project based on the following criteria:\n\n` +
                     `⭐ *Meme Character & Branding*: Quality of meme, branding, and community appeal\n` +
                     `⭐ *Roadmap & Vision*: Project's goals, roadmap clarity, and innovation\n` +
                     `⭐ *Team & Dev Activity*: Team's experience, transparency, and development activity\n\n` +
                     `Each category will be rated on a scale of 1-4 stars. The project's overall rating will be calculated based on these community votes.`,
            project: newProject
        };
    } catch (error) {
        console.error("Error submitting project:", error.message);
        return {
            success: false,
            message: `❌ Error submitting project: ${error.message}`
        };
    }
};

/**
 * Get all projects
 * @param {string} status - Filter by status (optional)
 * @returns {Array} List of projects
 */
const getAllProjects = async (status = null) => {
    try {
        const query = status ? { status } : {};
        const projects = await Project.find(query).sort({ createdAt: -1 });
        
        return {
            success: true,
            projects
        };
    } catch (error) {
        console.error("Error getting projects:", error.message);
        return {
            success: false,
            message: `❌ Error getting projects: ${error.message}`,
            projects: []
        };
    }
};

/**
 * Get project by ID
 * @param {string} projectId - The project ID
 * @returns {Object} The project or error
 */
const getProjectById = async (projectId) => {
    try {
        console.log(`Retrieving project with ID: ${projectId}`);
        
        const project = await Project.findById(projectId);
        
        if (!project) {
            console.log(`Project not found with ID: ${projectId}`);
            return {
                success: false,
                message: "❌ Project not found."
            };
        }
        
        console.log(`Retrieved project: ${project._id} - Name: ${project.name} (${project.symbol}), Address: ${project.contractAddress}`);
        
        return {
            success: true,
            project
        };
    } catch (error) {
        console.error(`Error getting project ${projectId}:`, error.message);
        return {
            success: false,
            message: `❌ Error getting project: ${error.message}`
        };
    }
};

/**
 * Update project status
 * @param {string} projectId - The project ID
 * @param {string} status - The new status
 * @param {string} approvedBy - The user ID who approved/rejected the project
 * @returns {Object} The updated project or error
 */
const updateProjectStatus = async (projectId, status, approvedBy = null) => {
    try {
        const project = await Project.findById(projectId);
        
        if (!project) {
            return {
                success: false,
                message: "❌ Project not found."
            };
        }
        
        project.status = status;
        
        if (status === config.projectStatuses.approved || status === config.projectStatuses.vetting) {
            project.approvedAt = new Date();
            if (approvedBy) {
                project.approvedBy = approvedBy;
            }
        }
        
        await project.save();
        
        return {
            success: true,
            message: `✅ Project status updated to ${status}`,
            project
        };
    } catch (error) {
        console.error(`Error updating project ${projectId}:`, error.message);
        return {
            success: false,
            message: `❌ Error updating project: ${error.message}`
        };
    }
};

/**
 * Update project prices and ROI
 * @param {string} projectId - The project ID
 * @returns {Object} The updated project or error
 */
const updateProjectPrices = async (projectId) => {
    try {
        const project = await Project.findById(projectId);
        
        if (!project) {
            return {
                success: false,
                message: "❌ Project not found."
            };
        }
        
        const tokenData = await tokenService.getTokenByAddress(project.contractAddress);
        
        if (!tokenData) {
            return {
                success: false,
                message: "❌ Could not fetch token data."
            };
        }
        
        // Extract liquidity value properly
        let liquidityValue = 0;
        if (tokenData.liquidity) {
            if (typeof tokenData.liquidity === 'object' && tokenData.liquidity.usd !== undefined) {
                liquidityValue = parseFloat(tokenData.liquidity.usd);
            } else if (typeof tokenData.liquidity === 'number') {
                liquidityValue = tokenData.liquidity;
            } else if (typeof tokenData.liquidity === 'string') {
                liquidityValue = parseFloat(tokenData.liquidity);
            }
        }
        
        // Update project with latest data
        project.currentPrice = tokenData.price || 0;
        project.marketCap = tokenData.marketCap || 0;
        project.liquidity = liquidityValue;
        
        // Calculate ROI if initial price exists
        if (project.initialPrice && project.initialPrice > 0) {
            const roi = ((project.currentPrice - project.initialPrice) / project.initialPrice) * 100;
            project.roi = roi;
        }
        
        await project.save();
        
        return {
            success: true,
            message: "✅ Project prices updated",
            project
        };
    } catch (error) {
        console.error(`Error updating project prices ${projectId}:`, error.message);
        return {
            success: false,
            message: `❌ Error updating project prices: ${error.message}`
        };
    }
};

/**
 * Get top performing projects by ROI
 * @param {number} limit - Number of projects to return
 * @returns {Array} List of top projects
 */
const getTopProjects = async (limit = 10) => {
    try {
        const projects = await Project.find({ 
            status: config.projectStatuses.approved,
            roi: { $exists: true, $ne: null }
        })
        .sort({ roi: -1 })
        .limit(limit);
        
        return {
            success: true,
            projects
        };
    } catch (error) {
        console.error("Error getting top projects:", error.message);
        return {
            success: false,
            message: `❌ Error getting top projects: ${error.message}`,
            projects: []
        };
    }
};

/**
 * Get project by symbol
 * @param {string} symbol - The project symbol
 * @returns {Object} The project or error
 */
const getProjectBySymbol = async (symbol) => {
    try {
        // Case insensitive search
        const project = await Project.findOne({ symbol: { $regex: new RegExp('^' + symbol + '$', 'i') } });
        
        if (!project) {
            return {
                success: false,
                message: "❌ Project not found with that symbol."
            };
        }
        
        return {
            success: true,
            project
        };
    } catch (error) {
        console.error("Error getting project by symbol:", error.message);
        return {
            success: false,
            message: `❌ Error getting project: ${error.message}`
        };
    }
};

/**
 * Get project by contract address
 * @param {string} contractAddress - The project contract address
 * @returns {Object} The project or error
 */
const getProjectByContractAddress = async (contractAddress) => {
    try {
        // Case insensitive search
        const project = await Project.findOne({ 
            contractAddress: { $regex: new RegExp('^' + contractAddress + '$', 'i') } 
        });
        
        if (!project) {
            return {
                success: false,
                message: "❌ Project not found with that contract address."
            };
        }
        
        return {
            success: true,
            project
        };
    } catch (error) {
        console.error("Error getting project by contract address:", error.message);
        return {
            success: false,
            message: `❌ Error getting project: ${error.message}`
        };
    }
};

/**
 * Get projects by status
 * @param {string} status - The status to filter by
 * @param {number} limit - Maximum number of projects to return
 * @returns {Object} List of projects with the specified status
 */
const getProjectsByStatus = async (status, limit = 10) => {
    try {
        const projects = await Project.find({ status })
            .sort({ submittedAt: -1 })
            .limit(limit);
        
        return {
            success: true,
            projects
        };
    } catch (error) {
        console.error(`Error getting projects with status ${status}:`, error.message);
        return {
            success: false,
            message: `❌ Error getting projects: ${error.message}`,
            projects: []
        };
    }
};

module.exports = {
    submitProject,
    getAllProjects,
    getProjectById,
    getProjectBySymbol,
    getProjectByContractAddress,
    updateProjectStatus,
    updateProjectPrices,
    getTopProjects,
    getProjectsByStatus
}; 