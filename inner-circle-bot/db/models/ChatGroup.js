const mongoose = require("mongoose");

const ChatGroupSchema = new mongoose.Schema({
    chatId: {
        type: String,
        required: true,
        unique: true
    },
    title: {
        type: String
    },
    type: {
        type: String,
        enum: ['group', 'supergroup', 'channel'],
        required: true
    },
    admins: [{
        telegramId: String,
        username: String,
        firstName: String,
        lastName: String,
        addedAt: {
            type: Date,
            default: Date.now
        },
        addedBy: String // Telegram ID of the admin who added this admin
    }],
    creatorId: {
        type: String // Telegram ID of the user who added the bot to the group
    },
    settings: {
        notifyNewProjects: {
            type: Boolean,
            default: true
        },
        notifyApprovals: {
            type: Boolean,
            default: true
        },
        notifyRejections: {
            type: Boolean,
            default: true
        },
        notifyGrades: {
            type: Boolean,
            default: true
        }
    },
    joinedAt: {
        type: Date,
        default: Date.now
    },
    active: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model("ChatGroup", ChatGroupSchema); 