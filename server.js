const express = require('express');
const cors = require('cors');
const path = require('path');
const { setupDatabase } = require('./db.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Initialize DB then start server
setupDatabase().then(db => {
    console.log("Database connected and synced.");
    
    // Pass db instance to api routes
    const apiRoutes = require('./routes/api')(db);
    app.use('/api', apiRoutes);

    // Catch-all route to serve the main HTML page
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    app.listen(PORT, () => {
        console.log(`Auctasy Server running locally at http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error("Failed to start server due to Database error:", err);
});
