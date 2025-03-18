const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
    telegramId: {
        type: String,
        required: true,
        unique: true
    },
    username: {
        type: String
    },
    firstName: {
        type: String
    },
    lastName: {
        type: String
    },
    walletAddress: {
        type: String
    },
    isAdmin: {
        type: Boolean,
        default: false
    },
    projectsSubmitted: {
        type: Number,
        default: 0
    },
    projectsVoted: {
        type: Number,
        default: 0
    },
    joinedAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

module.exports = mongoose.model("User", UserSchema); 