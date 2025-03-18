const ChatGroup = require('../db/models/ChatGroup');
const User = require('../db/models/User');

/**
 * Create or update a chat group
 * @param {Object} chatData - The chat data from Telegram
 * @param {string} creatorId - The Telegram ID of the user who added the bot
 * @returns {Object} The created/updated chat group
 */
const createOrUpdateChatGroup = async (chatData, creatorId = null) => {
    try {
        const { id, title, type } = chatData;
        
        // Check if chat group exists
        let chatGroup = await ChatGroup.findOne({ chatId: id.toString() });
        
        if (chatGroup) {
            // Update existing chat group
            chatGroup.title = title || chatGroup.title;
            
            // Only update the type if it's provided
            if (type) {
                chatGroup.type = type;
            }
            
            await chatGroup.save();
            
            return {
                success: true,
                message: "✅ Chat group updated.",
                chatGroup,
                isNew: false
            };
        }
        
        // Create new chat group
        chatGroup = new ChatGroup({
            chatId: id.toString(),
            title,
            type: type || 'group',
            creatorId: creatorId ? creatorId.toString() : null,
            admins: []
        });
        
        // If creator is provided, add them as the first admin
        if (creatorId) {
            const user = await User.findOne({ telegramId: creatorId.toString() });
            
            if (user) {
                chatGroup.admins.push({
                    telegramId: user.telegramId,
                    username: user.username,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    addedBy: user.telegramId // Added by themselves
                });
            }
        }
        
        await chatGroup.save();
        
        return {
            success: true,
            message: "✅ Chat group created.",
            chatGroup,
            isNew: true
        };
    } catch (error) {
        console.error("Error creating/updating chat group:", error.message);
        return {
            success: false,
            message: `❌ Error creating/updating chat group: ${error.message}`
        };
    }
};

/**
 * Get chat group by chat ID
 * @param {string} chatId - The chat ID
 * @returns {Object} The chat group
 */
const getChatGroupById = async (chatId) => {
    try {
        const chatGroup = await ChatGroup.findOne({ chatId: chatId.toString() });
        
        if (!chatGroup) {
            return {
                success: false,
                message: "❌ Chat group not found."
            };
        }
        
        return {
            success: true,
            chatGroup
        };
    } catch (error) {
        console.error(`Error getting chat group ${chatId}:`, error.message);
        return {
            success: false,
            message: `❌ Error getting chat group: ${error.message}`
        };
    }
};

/**
 * Add an admin to a chat group
 * @param {string} chatId - The chat ID
 * @param {Object} adminData - The admin data
 * @param {string} addedBy - The Telegram ID of the admin who is adding the new admin
 * @returns {Object} The updated chat group
 */
const addChatGroupAdmin = async (chatId, adminData, addedBy) => {
    try {
        const chatGroup = await ChatGroup.findOne({ chatId: chatId.toString() });
        
        if (!chatGroup) {
            return {
                success: false,
                message: "❌ Chat group not found."
            };
        }
        
        // Check if the user adding the admin is an admin themselves
        const isAdmin = chatGroup.admins.some(admin => admin.telegramId === addedBy.toString()) || 
                        chatGroup.creatorId === addedBy.toString();
        
        if (!isAdmin) {
            return {
                success: false,
                message: "❌ Only admins can add other admins."
            };
        }
        
        // Check if the admin already exists
        const adminExists = chatGroup.admins.some(admin => admin.telegramId === adminData.id.toString());
        
        if (adminExists) {
            return {
                success: false,
                message: "❌ This user is already an admin."
            };
        }
        
        // Add the new admin
        chatGroup.admins.push({
            telegramId: adminData.id.toString(),
            username: adminData.username,
            firstName: adminData.first_name,
            lastName: adminData.last_name,
            addedBy: addedBy.toString()
        });
        
        await chatGroup.save();
        
        return {
            success: true,
            message: "✅ Admin added to chat group.",
            chatGroup
        };
    } catch (error) {
        console.error(`Error adding admin to chat group ${chatId}:`, error.message);
        return {
            success: false,
            message: `❌ Error adding admin: ${error.message}`
        };
    }
};

/**
 * Remove an admin from a chat group
 * @param {string} chatId - The chat ID
 * @param {string} adminId - The Telegram ID of the admin to remove
 * @param {string} removedBy - The Telegram ID of the admin who is removing the admin
 * @returns {Object} The updated chat group
 */
const removeChatGroupAdmin = async (chatId, adminId, removedBy) => {
    try {
        const chatGroup = await ChatGroup.findOne({ chatId: chatId.toString() });
        
        if (!chatGroup) {
            return {
                success: false,
                message: "❌ Chat group not found."
            };
        }
        
        // Check if the user removing the admin is an admin themselves
        const isAdmin = chatGroup.admins.some(admin => admin.telegramId === removedBy.toString()) || 
                        chatGroup.creatorId === removedBy.toString();
        
        if (!isAdmin) {
            return {
                success: false,
                message: "❌ Only admins can remove other admins."
            };
        }
        
        // Cannot remove the creator
        if (chatGroup.creatorId === adminId.toString()) {
            return {
                success: false,
                message: "❌ Cannot remove the creator of the group."
            };
        }
        
        // Check if the admin exists
        const adminIndex = chatGroup.admins.findIndex(admin => admin.telegramId === adminId.toString());
        
        if (adminIndex === -1) {
            return {
                success: false,
                message: "❌ This user is not an admin."
            };
        }
        
        // Remove the admin
        chatGroup.admins.splice(adminIndex, 1);
        
        await chatGroup.save();
        
        return {
            success: true,
            message: "✅ Admin removed from chat group.",
            chatGroup
        };
    } catch (error) {
        console.error(`Error removing admin from chat group ${chatId}:`, error.message);
        return {
            success: false,
            message: `❌ Error removing admin: ${error.message}`
        };
    }
};

/**
 * Check if a user is an admin of a chat group
 * @param {string} chatId - The chat ID
 * @param {string} userId - The Telegram ID of the user
 * @returns {Object} Whether the user is an admin
 */
const isUserChatGroupAdmin = async (chatId, userId) => {
    try {
        const chatGroup = await ChatGroup.findOne({ chatId: chatId.toString() });
        
        if (!chatGroup) {
            return {
                success: false,
                message: "❌ Chat group not found.",
                isAdmin: false
            };
        }
        
        const isAdmin = chatGroup.admins.some(admin => admin.telegramId === userId.toString()) || 
                        chatGroup.creatorId === userId.toString();
        
        return {
            success: true,
            isAdmin
        };
    } catch (error) {
        console.error(`Error checking if user ${userId} is admin of chat group ${chatId}:`, error.message);
        return {
            success: false,
            message: `❌ Error checking admin status: ${error.message}`,
            isAdmin: false
        };
    }
};

/**
 * Get all admins of a chat group
 * @param {string} chatId - The chat ID
 * @returns {Object} The admins of the chat group
 */
const getChatGroupAdmins = async (chatId) => {
    try {
        const chatGroup = await ChatGroup.findOne({ chatId: chatId.toString() });
        
        if (!chatGroup) {
            return {
                success: false,
                message: "❌ Chat group not found.",
                admins: []
            };
        }
        
        return {
            success: true,
            admins: chatGroup.admins,
            creatorId: chatGroup.creatorId
        };
    } catch (error) {
        console.error(`Error getting admins of chat group ${chatId}:`, error.message);
        return {
            success: false,
            message: `❌ Error getting admins: ${error.message}`,
            admins: []
        };
    }
};

/**
 * Update chat group settings
 * @param {string} chatId - The chat ID
 * @param {Object} settings - The settings to update
 * @param {string} updatedBy - The Telegram ID of the admin who is updating the settings
 * @returns {Object} The updated chat group
 */
const updateChatGroupSettings = async (chatId, settings, updatedBy) => {
    try {
        const chatGroup = await ChatGroup.findOne({ chatId: chatId.toString() });
        
        if (!chatGroup) {
            return {
                success: false,
                message: "❌ Chat group not found."
            };
        }
        
        // Check if the user updating the settings is an admin
        const isAdmin = chatGroup.admins.some(admin => admin.telegramId === updatedBy.toString()) || 
                        chatGroup.creatorId === updatedBy.toString();
        
        if (!isAdmin) {
            return {
                success: false,
                message: "❌ Only admins can update settings."
            };
        }
        
        // Update the settings
        chatGroup.settings = {
            ...chatGroup.settings,
            ...settings
        };
        
        await chatGroup.save();
        
        return {
            success: true,
            message: "✅ Chat group settings updated.",
            chatGroup
        };
    } catch (error) {
        console.error(`Error updating settings of chat group ${chatId}:`, error.message);
        return {
            success: false,
            message: `❌ Error updating settings: ${error.message}`
        };
    }
};

/**
 * Get all active chat groups
 * @returns {Array} List of active chat groups
 */
const getAllActiveChatGroups = async () => {
    try {
        const chatGroups = await ChatGroup.find({ active: true });
        
        return {
            success: true,
            chatGroups
        };
    } catch (error) {
        console.error("Error getting active chat groups:", error.message);
        return {
            success: false,
            message: `❌ Error getting active chat groups: ${error.message}`,
            chatGroups: []
        };
    }
};

module.exports = {
    createOrUpdateChatGroup,
    getChatGroupById,
    addChatGroupAdmin,
    removeChatGroupAdmin,
    isUserChatGroupAdmin,
    getChatGroupAdmins,
    updateChatGroupSettings,
    getAllActiveChatGroups,
    getAllActiveGroups: getAllActiveChatGroups
}; 