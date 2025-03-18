const mongoose = require("mongoose");
const config = require("../../config");

const ProjectSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: true 
    },
    symbol: { 
        type: String 
    },
    contractAddress: { 
        type: String, 
        required: true, 
        unique: true 
    },
    status: { 
        type: String, 
        default: config.projectStatuses.vetting 
    },
    bulls: { 
        type: Number, 
        default: 0 
    },
    bears: { 
        type: Number, 
        default: 0 
    },
    votes: { 
        type: Number, 
        default: 0 
    },
    marketCap: { 
        type: Number 
    },
    liquidity: { 
        type: Number 
    },
    initialPrice: { 
        type: Number 
    },
    currentPrice: { 
        type: Number 
    },
    roi: { 
        type: Number 
    },
    chartUrl: { 
        type: String 
    },
    logo: {
        type: String,
        default: null
    },
    submittedBy: { 
        type: String 
    },
    submittedInChat: {
        type: String
    },
    submittedAt: { 
        type: Date, 
        default: Date.now 
    },
    approvedAt: { 
        type: Date 
    },
    approvedBy: {
        type: String
    },
    // Grading system fields
    memeBranding: {
        type: [{
            userId: String,
            rating: { type: Number, min: 1, max: 4 },
            timestamp: { type: Date, default: Date.now }
        }],
        default: []
    },
    roadmapVision: {
        type: [{
            userId: String,
            rating: { type: Number, min: 1, max: 4 },
            timestamp: { type: Date, default: Date.now }
        }],
        default: []
    },
    teamActivity: {
        type: [{
            userId: String,
            rating: { type: Number, min: 1, max: 4 },
            timestamp: { type: Date, default: Date.now }
        }],
        default: []
    }
}, { timestamps: true });

// Method to calculate average rating for a category
ProjectSchema.methods.getAverageRating = function(category) {
    if (!this[category] || this[category].length === 0) {
        return 0;
    }
    
    const sum = this[category].reduce((total, rating) => total + rating.rating, 0);
    return (sum / this[category].length).toFixed(1);
};

// Method to get all average ratings
ProjectSchema.methods.getAllAverageRatings = function() {
    return {
        memeBranding: this.getAverageRating('memeBranding'),
        roadmapVision: this.getAverageRating('roadmapVision'),
        teamActivity: this.getAverageRating('teamActivity')
    };
};

// Method to add a rating
ProjectSchema.methods.addRating = function(category, userId, rating) {
    // Check if user has already rated this category
    const existingRatingIndex = this[category].findIndex(r => r.userId === userId);
    
    if (existingRatingIndex !== -1) {
        // Update existing rating
        this[category][existingRatingIndex].rating = rating;
        this[category][existingRatingIndex].timestamp = new Date();
    } else {
        // Add new rating
        this[category].push({
            userId,
            rating,
            timestamp: new Date()
        });
    }
};

module.exports = mongoose.model("Project", ProjectSchema); 