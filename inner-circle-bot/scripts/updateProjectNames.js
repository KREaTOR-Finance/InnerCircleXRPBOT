/**
 * Script to update project names in the database
 * This script will fetch the correct token information for each project
 * and update the database records with the correct names
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Project = require('../db/models/Project');
const tokenService = require('../services/tokenService');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('Connected to MongoDB');
    updateProjectNames();
}).catch(err => {
    console.error('Error connecting to MongoDB:', err);
    process.exit(1);
});

/**
 * Update project names in the database
 */
async function updateProjectNames() {
    try {
        // Get all projects with "Unknown Token" as name
        const projects = await Project.find({ 
            $or: [
                { name: "Unknown Token" },
                { name: { $regex: /unknown/i } }
            ]
        });

        console.log(`Found ${projects.length} projects with unknown names`);

        let updatedCount = 0;
        let failedCount = 0;

        // Update each project
        for (const project of projects) {
            try {
                console.log(`Processing project: ${project._id} - ${project.contractAddress}`);
                
                // Fetch token data from token service
                const tokenData = await tokenService.getTokenByAddress(project.contractAddress);
                
                if (tokenData && tokenData.name && tokenData.name !== "Unknown Token") {
                    // Update project name and symbol
                    project.name = tokenData.name;
                    if (tokenData.symbol && tokenData.symbol !== "UNKNOWN") {
                        project.symbol = tokenData.symbol;
                    }
                    
                    // Save the updated project
                    await project.save();
                    
                    console.log(`✅ Updated project: ${project._id} - New name: ${project.name} (${project.symbol})`);
                    updatedCount++;
                } else {
                    console.log(`❌ Could not find token data for: ${project.contractAddress}`);
                    failedCount++;
                }
            } catch (error) {
                console.error(`Error updating project ${project._id}:`, error.message);
                failedCount++;
            }
        }

        console.log(`\nUpdate complete!`);
        console.log(`Updated: ${updatedCount} projects`);
        console.log(`Failed: ${failedCount} projects`);
        
        // Disconnect from MongoDB
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
        
    } catch (error) {
        console.error('Error updating project names:', error);
        process.exit(1);
    }
} 