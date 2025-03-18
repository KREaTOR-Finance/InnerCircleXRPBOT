const Vote = require('../db/models/Vote');
const Project = require('../db/models/Project');
const config = require('../config');

/**
 * Cast a vote for a project
 * @param {string} userId - The user ID casting the vote
 * @param {string} projectId - The project ID being voted on
 * @param {string} voteType - The type of vote (bull/bear)
 * @returns {Object} The result of the vote
 */
const castVote = async (userId, projectId, voteType) => {
    try {
        // Check if project exists
        const project = await Project.findById(projectId);
        
        if (!project) {
            return {
                success: false,
                message: "❌ Project not found."
            };
        }
        
        // Check if project is in a votable status
        if (project.status !== config.projectStatuses.vetting && project.status !== config.projectStatuses.approved) {
            return {
                success: false,
                message: "❌ This project is not available for voting at this time."
            };
        }
        
        // Check if user has already voted
        const existingVote = await Vote.findOne({ userId, projectId });
        
        if (existingVote) {
            // If vote type is the same, return error
            if (existingVote.voteType === voteType) {
                return {
                    success: false,
                    message: `❌ You have already voted ${voteType} for this project.`
                };
            }
            
            // Update existing vote
            existingVote.voteType = voteType;
            await existingVote.save();
            
            // Update project vote counts
            if (voteType === 'bull') {
                project.bulls += 1;
                project.bears -= 1;
            } else {
                project.bulls -= 1;
                project.bears += 1;
            }
            
            await project.save();
            
            return {
                success: true,
                message: `✅ Your vote has been updated to ${voteType}.`,
                project
            };
        }
        
        // Create new vote
        const newVote = new Vote({
            userId,
            projectId,
            voteType
        });
        
        await newVote.save();
        
        // Update project vote counts
        if (voteType === 'bull') {
            project.bulls += 1;
        } else {
            project.bears += 1;
        }
        
        project.votes += 1;
        
        // Check if project should be auto-approved (only for projects in vetting status)
        let shouldAutoApprove = false;
        if (project.status === config.projectStatuses.vetting) {
            shouldAutoApprove = checkForAutoApproval(project);
            
            if (shouldAutoApprove) {
                project.status = config.projectStatuses.approved;
                project.approvedAt = new Date();
            }
        }
        
        await project.save();
        
        return {
            success: true,
            message: `✅ Your ${voteType} vote has been recorded.`,
            autoApproved: shouldAutoApprove,
            project
        };
    } catch (error) {
        console.error("Error casting vote:", error.message);
        return {
            success: false,
            message: `❌ Error casting vote: ${error.message}`
        };
    }
};

/**
 * Check if a project should be auto-approved based on votes
 * @param {Object} project - The project to check
 * @returns {boolean} Whether the project should be auto-approved
 */
const checkForAutoApproval = (project) => {
    // Only consider projects in vetting status
    if (project.status !== config.projectStatuses.vetting) {
        return false;
    }
    
    // Check if project has enough votes
    if (project.votes < config.voteThreshold) {
        return false;
    }
    
    // Calculate bull percentage
    const bullPercentage = (project.bulls / project.votes) * 100;
    
    // Check if bull percentage is above fast track threshold
    return bullPercentage >= config.fastTrackPercent;
};

/**
 * Get votes for a project
 * @param {string} projectId - The project ID
 * @returns {Object} The votes for the project
 */
const getVotesForProject = async (projectId) => {
    try {
        const votes = await Vote.find({ projectId });
        
        return {
            success: true,
            votes
        };
    } catch (error) {
        console.error(`Error getting votes for project ${projectId}:`, error.message);
        return {
            success: false,
            message: `❌ Error getting votes: ${error.message}`,
            votes: []
        };
    }
};

/**
 * Get user's vote for a project
 * @param {string} userId - The user ID
 * @param {string} projectId - The project ID
 * @returns {Object} The user's vote
 */
const getUserVote = async (userId, projectId) => {
    try {
        const vote = await Vote.findOne({ userId, projectId });
        
        return {
            success: true,
            vote
        };
    } catch (error) {
        console.error(`Error getting user vote for project ${projectId}:`, error.message);
        return {
            success: false,
            message: `❌ Error getting user vote: ${error.message}`
        };
    }
};

module.exports = {
    castVote,
    getVotesForProject,
    getUserVote,
    checkForAutoApproval
}; 