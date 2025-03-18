const config = require('./config');

/**
 * Main menu keyboard
 * @returns {Object} Telegram keyboard markup
 */
const mainMenu = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: "🔍 Browse Projects", callback_data: "browse_projects" },
                { text: "📊 Leaderboards", callback_data: "leaderboards" }
            ],
            [
                { text: "🗳️ Vetting Board", callback_data: "browse_vetting" },
                { text: "👛 My Wallet", callback_data: "my_wallet" }
            ],
            [
                { text: "📝 Submit Project", callback_data: "submit_project" },
                { text: "ℹ️ About", callback_data: "about" }
            ]
        ]
    }
};

/**
 * Back to main menu keyboard
 * @returns {Object} Telegram keyboard markup
 */
const backToMainMenu = {
    reply_markup: {
        keyboard: [
            ['🔙 Back to Main Menu']
        ],
        resize_keyboard: true
    }
};

/**
 * Browse projects menu
 * @returns {Object} Telegram keyboard markup
 */
const browseProjectsMenu = {
    reply_markup: {
        keyboard: [
            ['🔄 Vetting Board', '✅ Approved Projects'],
            ['🔙 Back to Main Menu']
        ],
        resize_keyboard: true
    }
};

/**
 * Leaderboards menu
 * @returns {Object} Telegram keyboard markup
 */
const leaderboardsMenu = {
    reply_markup: {
        keyboard: [
            ['🚀 Top ROI', '💰 Top Market Cap'],
            ['💧 Top Liquidity', '🗳️ Most Voted'],
            ['🔙 Back to Main Menu']
        ],
        resize_keyboard: true
    }
};

/**
 * Admin panel menu
 * @returns {Object} Telegram keyboard markup
 */
const adminPanelMenu = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: "📊 Statistics", callback_data: "admin_stats" },
                { text: "📢 Broadcast", callback_data: "admin_broadcast" }
            ],
            [
                { text: "⚙️ Settings", callback_data: "admin_settings" },
                { text: "📋 Pending Projects", callback_data: "admin_pending" }
            ]
        ]
    }
};

/**
 * Project management menu
 * @returns {Object} Telegram keyboard markup
 */
const projectManagementMenu = {
    reply_markup: {
        keyboard: [
            ['✅ Approve Project', '❌ Reject Project'],
            ['🔄 Update Project Data', '🗑️ Delete Project'],
            ['🔙 Back to Admin Panel']
        ],
        resize_keyboard: true
    }
};

/**
 * User management menu
 * @returns {Object} Telegram keyboard markup
 */
const userManagementMenu = {
    reply_markup: {
        keyboard: [
            ['👑 Add Admin', '👤 Remove Admin'],
            ['🔙 Back to Admin Panel']
        ],
        resize_keyboard: true
    }
};

/**
 * Vote buttons for a project
 * @param {string} projectId - The project ID
 * @returns {Object} Telegram inline keyboard markup
 */
const projectVoteButtons = (projectId) => ({
    reply_markup: {
        inline_keyboard: [
            [
                { text: "🐂 Bull", callback_data: `vote_${projectId}_bull` },
                { text: "🐻 Bear", callback_data: `vote_${projectId}_bear` }
            ],
            [
                { text: "💰 Buy Now", callback_data: `buy_${projectId}` },
                { text: "📈 View Chart", callback_data: `chart_${projectId}` }
            ]
        ]
    }
});

/**
 * Project details buttons
 * @param {string} projectId - The project ID
 * @returns {Object} Telegram inline keyboard markup
 */
const projectDetailsButtons = (projectId) => {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '📈 View Chart', callback_data: `chart_${projectId}` },
                    { text: '💰 Buy Now', callback_data: `buy_${projectId}` }
                ],
                [
                    { text: '🔙 Back to Projects', callback_data: 'back_to_projects' }
                ]
            ]
        }
    };
};

/**
 * Admin project action buttons
 * @param {string} projectId - The project ID
 * @returns {Object} Telegram inline keyboard markup
 */
const adminProjectActionButtons = (projectId) => ({
    reply_markup: {
        inline_keyboard: [
            [
                { text: "✅ Approve", callback_data: `admin_approve_${projectId}` },
                { text: "❌ Reject", callback_data: `admin_reject_${projectId}` }
            ],
            [
                { text: "🔍 View Details", callback_data: `admin_details_${projectId}` }
            ]
        ]
    }
});

/**
 * Confirmation buttons
 * @param {string} action - The action to confirm
 * @param {string} id - The ID related to the action
 * @returns {Object} Telegram inline keyboard markup
 */
const confirmationButtons = (action, id) => {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '✅ Confirm', callback_data: `confirm_${action}_${id}` },
                    { text: '❌ Cancel', callback_data: `cancel_${action}_${id}` }
                ]
            ]
        }
    };
};

module.exports = {
    mainMenu,
    backToMainMenu,
    browseProjectsMenu,
    leaderboardsMenu,
    adminPanelMenu,
    projectManagementMenu,
    userManagementMenu,
    projectVoteButtons,
    projectDetailsButtons,
    adminProjectActionButtons,
    confirmationButtons
}; 