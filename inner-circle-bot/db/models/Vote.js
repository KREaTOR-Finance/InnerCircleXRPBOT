const mongoose = require("mongoose");

const VoteSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true
    },
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: true
    },
    voteType: {
        type: String,
        enum: ['bull', 'bear'],
        required: true
    },
    timestamp: { 
        type: Date, 
        default: Date.now 
    }
});

// Ensure a user can only vote once per project
VoteSchema.index({ userId: 1, projectId: 1 }, { unique: true });

module.exports = mongoose.model("Vote", VoteSchema); 