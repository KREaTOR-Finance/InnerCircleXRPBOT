const ROI = require('../db/models/ROI');
const Project = require('../db/models/Project'); // Update path to use db/models

/**
 * Calculate ROI between initial and current price
 * @param {number} initialPrice - Initial price of token/project
 * @param {number} currentPrice - Current price of token/project
 * @returns {number} - ROI percentage (e.g., 250 for 250% ROI)
 */
const calculateROI = (initialPrice, currentPrice) => {
    if (initialPrice <= 0) return 0;
    
    const roi = ((currentPrice - initialPrice) / initialPrice) * 100;
    return parseFloat(roi.toFixed(2));
};

/**
 * Record ROI data for a project
 * @param {string} projectId - ID of the project
 * @param {number} initialPrice - Initial price
 * @param {number} currentPrice - Current price
 * @returns {Promise<object>} Result of the operation
 */
const recordROI = async (projectId, initialPrice, currentPrice) => {
    try {
        const roi = calculateROI(initialPrice, currentPrice);
        
        const roiRecord = new ROI({
            projectId,
            initialPrice,
            currentPrice,
            roi
        });
        
        await roiRecord.save();
        
        return {
            success: true,
            roi: roiRecord
        };
    } catch (error) {
        console.error('Error recording ROI:', error);
        return {
            success: false,
            message: error.message || 'Failed to record ROI'
        };
    }
};

/**
 * Get latest ROI data for a project
 * @param {string} projectId - ID of the project
 * @returns {Promise<object>} Result of the operation
 */
const getProjectROI = async (projectId) => {
    try {
        const roiData = await ROI.findOne({ projectId })
            .sort({ timestamp: -1 });
        
        return {
            success: true,
            roi: roiData
        };
    } catch (error) {
        console.error('Error getting project ROI:', error);
        return {
            success: false,
            message: error.message || 'Failed to get ROI data'
        };
    }
};

/**
 * Get projects with highest ROI
 * @param {number} limit - Maximum number of projects to return
 * @returns {Promise<object>} Result of the operation
 */
const getTopROIProjects = async (limit = 10) => {
    try {
        // Get the latest ROI for each project
        const topProjects = await ROI.aggregate([
            {
                $sort: { timestamp: -1 }
            },
            {
                $group: {
                    _id: "$projectId",
                    roi: { $first: "$roi" },
                    initialPrice: { $first: "$initialPrice" },
                    currentPrice: { $first: "$currentPrice" },
                    timestamp: { $first: "$timestamp" }
                }
            },
            {
                $sort: { roi: -1 }
            },
            {
                $limit: limit
            }
        ]);
        
        // Populate project details
        const projectIds = topProjects.map(p => p._id);
        const projects = await Project.find({ _id: { $in: projectIds } });
        
        // Combine project details with ROI data
        const result = topProjects.map(roi => {
            const project = projects.find(p => p._id.toString() === roi._id.toString());
            return {
                project: project || { name: 'Unknown Project' },
                roi: roi.roi,
                initialPrice: roi.initialPrice,
                currentPrice: roi.currentPrice,
                timestamp: roi.timestamp
            };
        });
        
        return {
            success: true,
            projects: result
        };
    } catch (error) {
        console.error('Error getting top ROI projects:', error);
        return {
            success: false,
            message: error.message || 'Failed to get top ROI projects'
        };
    }
};

/**
 * Update ROI for a project
 * @param {string} projectId - ID of the project
 * @param {number} currentPrice - Current price of the project
 * @returns {Promise<object>} Result of the operation
 */
const updateProjectROI = async (projectId, currentPrice) => {
    try {
        // Get the initial price from the first ROI record
        const initialRecord = await ROI.findOne({ projectId })
            .sort({ timestamp: 1 });
        
        if (!initialRecord) {
            return {
                success: false,
                message: 'No initial price record found for this project'
            };
        }
        
        return await recordROI(projectId, initialRecord.initialPrice, currentPrice);
    } catch (error) {
        console.error('Error updating project ROI:', error);
        return {
            success: false,
            message: error.message || 'Failed to update ROI data'
        };
    }
};

module.exports = {
    calculateROI,
    recordROI,
    getProjectROI,
    getTopROIProjects,
    updateProjectROI
}; 