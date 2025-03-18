require('dotenv').config();

module.exports = {
    botToken: process.env.BOT_TOKEN,
    adminChatId: process.env.ADMIN_CHAT_ID,
    mongoUri: process.env.MONGO_URI,
    voteThreshold: parseInt(process.env.VOTE_THRESHOLD) || 10,
    fastTrackPercent: parseInt(process.env.FAST_TRACK_PERCENT) || 30,
    dexscreenerApi: {
        allPairs: process.env.DEXSCREENER_ALL_PAIRS || 'https://api.dexscreener.com/latest/dex/pairs?chain=xrpl',
        pairDetails: process.env.DEXSCREENER_PAIR_DETAILS || 'https://api.dexscreener.com/latest/dex/pairs',
        chain: process.env.DEXSCREENER_CHAIN || 'xrpl'
    },
    xpmarketApi: {
        url: process.env.XPMARKET_API_URL || 'https://api.xpmarket.com/api/meme/pools'
    },
    xrplExplorer: {
        apiKey: process.env.XRPL_EXPLORER_API_KEY || 'abcd-abcd-0000-abcd-0123abcdabcd',
        bithompApiKey: process.env.BITHOMP_API_KEY || 'ed6e3fa6-9cde-483d-937f-da7d9d0b60b6'
    },
    xrpscanApi: {
        baseUrl: process.env.XRPSCAN_API_URL || 'https://api.xrpscan.com/api/v1',
        account: process.env.XRPSCAN_ACCOUNT_API || 'https://api.xrpscan.com/api/v1/account',
        assets: process.env.XRPSCAN_ASSETS_API || 'https://api.xrpscan.com/api/v1/account/{address}/assets',
        username: process.env.XRPSCAN_USERNAME_API || 'https://api.xrpscan.com/api/v1/account/{address}/username'
    },
    xrplMetaApi: {
        baseUrl: process.env.XRPLMETA_API_BASE || 'https://s1.xrplmeta.org',
        wsUrl: process.env.XRPLMETA_WS_URL || 'wss://s1.xrplmeta.org'
    },
    admins: [process.env.ADMIN_CHAT_ID], // Add more admin IDs as needed
    votingOptions: {
        bull: '🐂 Bull',
        bear: '🐻 Bear'
    },
    projectStatuses: {
        pending: 'pending',     // Initial state when submitted, waiting for admin approval
        vetting: 'vetting',     // Approved by admin, now in community voting phase
        approved: 'approved',   // Received enough votes to become an official call
        rejected: 'rejected'    // Rejected by admins or didn't receive enough votes
    }
}; 