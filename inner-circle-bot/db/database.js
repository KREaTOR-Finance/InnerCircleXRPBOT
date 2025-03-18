const mongoose = require("mongoose");
const config = require("../config");

const connectDB = async () => {
    try {
        await mongoose.connect(config.mongoUri, { 
            useNewUrlParser: true, 
            useUnifiedTopology: true 
        });
        console.log("✅ MongoDB Connected!");
    } catch (error) {
        console.error("❌ MongoDB Connection Failed:", error);
        process.exit(1);
    }
};

module.exports = connectDB; 