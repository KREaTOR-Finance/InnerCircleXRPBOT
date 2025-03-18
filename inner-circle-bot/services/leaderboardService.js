const Project = require('../db/models/Project');
const User = require('../db/models/User');
const config = require('../config');

/**
 * Get top projects by votes
 * @param {number} limit - Number of projects to return
 * @returns {Object} Result with top projects
 */
const getTopProjectsByVotes = async (limit = 10) => {
    try {
        const projects = await Project.find({
            votes: { $gt: 0 }
        })
        .sort({ votes: -1, bulls: -1 })
        .limit(limit);
        
        return {
            success: true,
            projects
        };
    } catch (error) {
        console.error("Error getting top projects by votes:", error.message);
        return {
            success: false,
            message: `Error getting top projects: ${error.message}`,
            projects: []
        };
    }
};

/**
 * Get top projects by rating
 * @param {number} limit - Number of projects to return
 * @returns {Object} Result with top projects
 */
const getTopProjectsByRating = async (limit = 10) => {
    try {
        // First get all projects
        const allProjects = await Project.find({});
        
        // Calculate average rating for each project
        const projectsWithRatings = allProjects.map(project => {
            const ratings = project.getAllAverageRatings();
            
            // Calculate overall rating (average of the three categories)
            const memeBranding = parseFloat(ratings.memeBranding) || 0;
            const roadmapVision = parseFloat(ratings.roadmapVision) || 0;
            const teamActivity = parseFloat(ratings.teamActivity) || 0;
            
            // Only include ratings if there are actual ratings (non-zero)
            const nonZeroRatings = [memeBranding, roadmapVision, teamActivity].filter(r => r > 0);
            const overallRating = nonZeroRatings.length > 0 
                ? nonZeroRatings.reduce((sum, val) => sum + val, 0) / nonZeroRatings.length
                : 0;
            
            return {
                ...project.toObject(),
                overallRating
            };
        });
        
        // Filter projects with ratings and sort by overall rating
        const sortedProjects = projectsWithRatings
            .filter(p => p.overallRating > 0)
            .sort((a, b) => b.overallRating - a.overallRating)
            .slice(0, limit);
        
        return {
            success: true,
            projects: sortedProjects
        };
    } catch (error) {
        console.error("Error getting top projects by rating:", error.message);
        return {
            success: false,
            message: `Error getting top projects: ${error.message}`,
            projects: []
        };
    }
};

/**
 * Get top projects by bulls (most bullish sentiment)
 * @param {number} limit - Number of projects to return
 * @returns {Object} Result with top projects
 */
const getTopProjectsByBulls = async (limit = 10) => {
    try {
        const projects = await Project.find({
            bulls: { $gt: 0 }
        })
        .sort({ bulls: -1 })
        .limit(limit);
        
        return {
            success: true,
            projects
        };
    } catch (error) {
        console.error("Error getting top projects by bulls:", error.message);
        return {
            success: false,
            message: `Error getting top projects: ${error.message}`,
            projects: []
        };
    }
};

/**
 * Generate leaderboard message for projects
 * @param {Array} projects - Array of projects
 * @param {string} title - Title of the leaderboard
 * @returns {string} Formatted message
 */
const generateLeaderboardMessage = (projects, title) => {
    if (!projects || projects.length === 0) {
        return `*${title}*\n\nNo projects found.`;
    }
    
    let message = `*${title}*\n\n`;
    
    projects.forEach((project, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        
        message += `${medal} *${project.name}* (${project.symbol})\n`;
        
        // Add relevant statistics based on the type of leaderboard
        if (title.includes("Voted") || title.includes("Projects")) {
            message += `   Bulls: ${project.bulls} | Bears: ${project.bears} | Total: ${project.votes}\n`;
        }
        
        if (title.includes("Rated")) {
            const ratings = project.getAllAverageRatings 
                ? project.getAllAverageRatings() 
                : { memeBranding: '0', roadmapVision: '0', teamActivity: '0' };
                
            message += `   Meme & Branding: ${ratings.memeBranding}/4 | `;
            message += `Roadmap & Vision: ${ratings.roadmapVision}/4 | `;
            message += `Team & Activity: ${ratings.teamActivity}/4\n`;
            
            if (project.overallRating) {
                message += `   Overall Rating: ${project.overallRating.toFixed(1)}/4\n`;
            }
        }
        
        // Add a blank line between projects
        if (index < projects.length - 1) {
            message += '\n';
        }
    });
    
    return message;
};

/**
 * Get top voters by number of votes
 * @param {number} limit - Number of users to return
 * @returns {Object} Result with top voters
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
            message: `Error getting top voters: ${error.message}`,
            users: []
        };
    }
};

/**
 * Get top project submitters
 * @param {number} limit - Number of users to return
 * @returns {Object} Result with top submitters
 */
const getTopSubmitters = async (limit = 10) => {
    try {
        const users = await User.find({
            projectsSubmitted: { $gt: 0 }
        })
        .sort({ projectsSubmitted: -1 })
        .limit(limit);
        
        return {
            success: true,
            users
        };
    } catch (error) {
        console.error("Error getting top submitters:", error.message);
        return {
            success: false,
            message: `Error getting top submitters: ${error.message}`,
            users: []
        };
    }
};

/**
 * Format user leaderboard message
 * @param {Array} users - Array of users
 * @param {string} title - Title of the leaderboard
 * @param {string} metric - Metric to display (e.g., 'projectsVoted', 'projectsSubmitted')
 * @returns {string} Formatted message
 */
const formatUserLeaderboardMessage = (users, title, metric) => {
    if (!users || users.length === 0) {
        return `*${title}*\n\nNo users found.`;
    }
    
    let message = `*${title}*\n\n`;
    
    users.forEach((user, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        const name = user.username ? `@${user.username}` : (user.firstName || 'Anonymous');
        
        message += `${medal} *${name}*\n`;
        
        if (metric === 'projectsVoted') {
            message += `   Votes: ${user.projectsVoted} | Projects Submitted: ${user.projectsSubmitted || 0}\n`;
        } else if (metric === 'projectsSubmitted') {
            message += `   Projects Submitted: ${user.projectsSubmitted} | Votes: ${user.projectsVoted || 0}\n`;
        }
        
        // Add a blank line between users
        if (index < users.length - 1) {
            message += '\n';
        }
    });
    
    return message;
};

module.exports = {
    getTopProjectsByVotes,
    getTopProjectsByRating,
    getTopProjectsByBulls,
    generateLeaderboardMessage,
    getTopVoters,
    getTopSubmitters,
    formatUserLeaderboardMessage
}; 