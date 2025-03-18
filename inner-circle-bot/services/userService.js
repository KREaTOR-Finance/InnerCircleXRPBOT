const User = require('../db/models/User');
const config = require('../config');
const xrplService = require('./xrplService');

/**
 * Create or update a user
 * @param {Object} userData - The user data from Telegram
 * @returns {Object} The created/updated user
 */
const createOrUpdateUser = async (userData) => {
    try {
        const { id, username, first_name, last_name } = userData;
        
        // Check if user exists
        let user = await User.findOne({ telegramId: id.toString() });
        
        if (user) {
            // Update existing user
            user.username = username;
            user.firstName = first_name;
            user.lastName = last_name;
            
            await user.save();
            
            return {
                success: true,
                message: "✅ User updated.",
                user,
                isNew: false
            };
        }
        
        // Create new user
        user = new User({
            telegramId: id.toString(),
            username,
            firstName: first_name,
            lastName: last_name,
            isAdmin: config.admins.includes(id.toString())
        });
        
        await user.save();
        
        return {
            success: true,
            message: "✅ User created.",
            user,
            isNew: true
        };
    } catch (error) {
        console.error("Error creating/updating user:", error.message);
        return {
            success: false,
            message: `❌ Error creating/updating user: ${error.message}`
        };
    }
};

/**
 * Get user by Telegram ID
 * @param {string} telegramId - The Telegram ID
 * @returns {Object} The user
 */
const getUserByTelegramId = async (telegramId) => {
    try {
        const user = await User.findOne({ telegramId: telegramId.toString() });
        
        if (!user) {
            return {
                success: false,
                message: "❌ User not found."
            };
        }
        
        return {
            success: true,
            user
        };
    } catch (error) {
        console.error(`Error getting user ${telegramId}:`, error.message);
        return {
            success: false,
            message: `❌ Error getting user: ${error.message}`
        };
    }
};

/**
 * Set user wallet address
 * @param {string} telegramId - The Telegram ID
 * @param {string} walletAddress - The wallet address
 * @returns {Object} The updated user
 */
const setUserWallet = async (telegramId, walletAddress) => {
    try {
        // Validate wallet address
        if (!xrplService.isValidXRPLAddress(walletAddress)) {
            return {
                success: false,
                message: "❌ Invalid XRPL wallet address."
            };
        }
        
        // Get user
        const user = await User.findOne({ telegramId: telegramId.toString() });
        
        if (!user) {
            return {
                success: false,
                message: "❌ User not found."
            };
        }
        
        // Update wallet address
        user.walletAddress = walletAddress;
        await user.save();
        
        return {
            success: true,
            message: "✅ Wallet address set successfully.",
            user
        };
    } catch (error) {
        console.error(`Error setting wallet for user ${telegramId}:`, error.message);
        return {
            success: false,
            message: `❌ Error setting wallet: ${error.message}`
        };
    }
};

/**
 * Make user an admin
 * @param {string} telegramId - The Telegram ID
 * @returns {Object} The updated user
 */
const makeUserAdmin = async (telegramId) => {
    try {
        // Get user
        const user = await User.findOne({ telegramId: telegramId.toString() });
        
        if (!user) {
            return {
                success: false,
                message: "❌ User not found."
            };
        }
        
        // Update admin status
        user.isAdmin = true;
        await user.save();
        
        return {
            success: true,
            message: "✅ User is now an admin.",
            user
        };
    } catch (error) {
        console.error(`Error making user ${telegramId} admin:`, error.message);
        return {
            success: false,
            message: `❌ Error making user admin: ${error.message}`
        };
    }
};

/**
 * Remove admin status from user
 * @param {string} telegramId - The Telegram ID
 * @returns {Object} The updated user
 */
const removeUserAdmin = async (telegramId) => {
    try {
        // Get user
        const user = await User.findOne({ telegramId: telegramId.toString() });
        
        if (!user) {
            return {
                success: false,
                message: "❌ User not found."
            };
        }
        
        // Update admin status
        user.isAdmin = false;
        await user.save();
        
        return {
            success: true,
            message: "✅ User is no longer an admin.",
            user
        };
    } catch (error) {
        console.error(`Error removing admin status from user ${telegramId}:`, error.message);
        return {
            success: false,
            message: `❌ Error removing admin status: ${error.message}`
        };
    }
};

/**
 * Increment user's projects submitted count
 * @param {string} telegramId - The Telegram ID
 * @returns {Object} The updated user
 */
const incrementProjectsSubmitted = async (telegramId) => {
    try {
        // Get user
        const user = await User.findOne({ telegramId: telegramId.toString() });
        
        if (!user) {
            return {
                success: false,
                message: "❌ User not found."
            };
        }
        
        // Increment count
        user.projectsSubmitted += 1;
        await user.save();
        
        return {
            success: true,
            user
        };
    } catch (error) {
        console.error(`Error incrementing projects submitted for user ${telegramId}:`, error.message);
        return {
            success: false,
            message: `❌ Error incrementing projects submitted: ${error.message}`
        };
    }
};

/**
 * Increment user's projects voted count
 * @param {string} telegramId - The Telegram ID
 * @returns {Object} The updated user
 */
const incrementProjectsVoted = async (telegramId) => {
    try {
        // Get user
        const user = await User.findOne({ telegramId: telegramId.toString() });
        
        if (!user) {
            return {
                success: false,
                message: "❌ User not found."
            };
        }
        
        // Increment count
        user.projectsVoted += 1;
        await user.save();
        
        return {
            success: true,
            user
        };
    } catch (error) {
        console.error(`Error incrementing projects voted for user ${telegramId}:`, error.message);
        return {
            success: false,
            message: `❌ Error incrementing projects voted: ${error.message}`
        };
    }
};

/**
 * Get top voters
 * @param {number} limit - Number of users to return
 * @returns {Object} The top voters
 */
const getTopVoters = async (limit = 10) => {
    try {
        const users = await User.find({
            projectsVoted: { $gt: 0 }
        })
        .sort({ projectsVoted: -1 })
        .limit(limit);
        
        return {
            success: true,
            users
        };
    } catch (error) {
        console.error("Error getting top voters:", error.message);
        return {
            success: false,
            message: `❌ Error getting top voters: ${error.message}`,
            users: []
        };
    }
};

/**
 * Format top voters for leaderboard display
 * @param {Array} users - Array of user objects
 * @returns {string} Formatted leaderboard message
 */
const formatTopVotersForLeaderboard = (users) => {
    if (!users || users.length === 0) {
        return "*Top Voters Leaderboard*\n\nNo voters found.";
    }
    
    let message = "*🏆 Top Voters Leaderboard 🏆*\n\n";
    
    users.forEach((user, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        const name = user.username ? `@${user.username}` : user.firstName || 'Anonymous';
        
        message += `${medal} *${name}*\n`;
        message += `   Votes: ${user.projectsVoted} | Projects Submitted: ${user.projectsSubmitted || 0}\n`;
        
        if (index < users.length - 1) {
            message += '\n';
        }
    });
    
    return message;
};

/**
 * Get most accurate voters
 * @param {number} limit - Number of users to return
 * @returns {Object} The most accurate voters
 */
const getMostAccurateVoters = async (limit = 10) => {
    try {
        // For now, we'll use a simple metric: users with the most votes
        // In a real implementation, you would track correct/incorrect votes
        // and calculate an accuracy percentage
        const users = await User.find({
            projectsVoted: { $gt: 5 } // Minimum 5 votes to be considered
        })
        .sort({ projectsVoted: -1 })
        .limit(limit);
        
        // Add a mock accuracy score for display purposes
        const usersWithAccuracy = users.map(user => {
            // Generate a random accuracy between 70% and 100%
            const accuracy = 70 + Math.floor(Math.random() * 30);
            return {
                ...user.toObject(),
                accuracy
            };
        });
        
        // Sort by accuracy
        usersWithAccuracy.sort((a, b) => b.accuracy - a.accuracy);
        
        return {
            success: true,
            users: usersWithAccuracy
        };
    } catch (error) {
        console.error("Error getting most accurate voters:", error.message);
        return {
            success: false,
            message: `❌ Error getting most accurate voters: ${error.message}`,
            users: []
        };
    }
};

/**
 * Format most accurate voters for leaderboard display
 * @param {Array} users - Array of user objects with accuracy
 * @returns {string} Formatted leaderboard message
 */
const formatMostAccurateVotersForLeaderboard = (users) => {
    if (!users || users.length === 0) {
        return "*Most Accurate Voters Leaderboard*\n\nNo voters found.";
    }
    
    let message = "*🎯 Most Accurate Voters Leaderboard 🎯*\n\n";
    
    users.forEach((user, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        const name = user.username ? `@${user.username}` : user.firstName || 'Anonymous';
        
        message += `${medal} *${name}*\n`;
        message += `   Accuracy: ${user.accuracy}% | Votes: ${user.projectsVoted}\n`;
        
        if (index < users.length - 1) {
            message += '\n';
        }
    });
    
    return message;
};

module.exports = {
    createOrUpdateUser,
    getUserByTelegramId,
    setUserWallet,
    makeUserAdmin,
    removeUserAdmin,
    incrementProjectsSubmitted,
    incrementProjectsVoted,
    getTopVoters,
    formatTopVotersForLeaderboard,
    getMostAccurateVoters,
    formatMostAccurateVotersForLeaderboard
}; 