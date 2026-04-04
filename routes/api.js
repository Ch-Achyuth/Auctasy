const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Import AI Modules
const { calculateTrueValue } = require('../ai/heuristic');
const { shouldBuyPlayer } = require('../ai/agent');
const { getAuctionTip } = require('../ai/rules');
const { simulateMatch } = require('../ai/probability');

const playersPath = path.join(__dirname, '../data/players.json');
let allPlayers = JSON.parse(fs.readFileSync(playersPath, 'utf-8'));

// Pre-calculate true value for all players
allPlayers = allPlayers.map(p => ({
    ...p,
    trueValue: calculateTrueValue(p)
}));

// State Management: Groups dictionary instead of global users
let groups = {};

// Helper functions (as requested)
function validateGroupSize(size) {
    const num = parseInt(size);
    if (isNaN(num)) return false;
    return num >= 4 && num % 2 === 0;
}

function isGroupFull(groupName) {
    const group = groups[groupName];
    if (!group) return false;
    const currentNumPlayers = Object.keys(group.users).length;
    return currentNumPlayers >= group.maxPlayers;
}

function getGroupPlayerList(groupName) {
    const group = groups[groupName];
    if (!group) return [];
    return Object.keys(group.users);
}

// 1. Create a new group
router.post('/create-group', (req, res) => {
    const { groupName, username, maxPlayers } = req.body;

    if (!groupName || !username || !maxPlayers) {
        return res.json({ success: false, message: "Missing fields" });
    }

    if (groups[groupName]) {
        return res.json({ success: false, message: "Group already exists" });
    }

    if (!validateGroupSize(maxPlayers)) {
        return res.json({ success: false, message: "Group size must be an even number and at least 4." });
    }

    // Initialize group state
    groups[groupName] = {
        maxPlayers: parseInt(maxPlayers),
        users: {
            [username]: { budget: 1000, team: [] }
        },
        currentPlayerIndex: 0,
        currentBid: 0,
        currentHighestBidder: null,
        auctionStarted: false
    };

    res.json({ success: true, message: "Group created successfully" });
});

// 2. Join an existing group
router.post('/join-group', (req, res) => {
    const { groupName, username } = req.body;

    if (!groups[groupName]) {
        return res.json({ success: false, message: "Group does not exist" });
    }

    if (groups[groupName].users[username]) {
        return res.json({ success: false, message: "Username already taken in this group" });
    }

    if (isGroupFull(groupName)) {
        return res.json({ success: false, message: "Group is full" });
    }

    // Add user
    groups[groupName].users[username] = { budget: 1000, team: [] };

    // Check if group is now full to start auction
    if (isGroupFull(groupName)) {
        groups[groupName].auctionStarted = true;
    }

    res.json({ success: true, message: "Joined successfully" });
});

// 3. Get current state (Lobby or Active Auction)
router.get('/auction-state', (req, res) => {
    const { groupName, username } = req.query;
    const group = groups[groupName];

    if (!group) {
        return res.json({ status: "INVALID", message: "Group not found" });
    }

    // Lobby State (Waiting for players)
    if (!group.auctionStarted) {
        const playersJoined = getGroupPlayerList(groupName);
        return res.json({
            status: "WAITING",
            currentPlayers: playersJoined.length,
            maxPlayers: group.maxPlayers,
            playersList: playersJoined
        });
    }

    // Finished State
    if (group.currentPlayerIndex >= allPlayers.length) {
        return res.json({ status: "FINISHED" });
    }

    // Active Auction State
    const player = allPlayers[group.currentPlayerIndex];
    let aiRecommendation = "";
    let auctionTip = "";
    let userBudget = 1000;

    if (username && group.users[username]) {
        userBudget = group.users[username].budget;
        aiRecommendation = shouldBuyPlayer(group.users[username].team, player, userBudget);
        auctionTip = getAuctionTip(group.currentBid || player.basePrice, userBudget, player.trueValue);
    }

    res.json({
        status: "ACTIVE",
        player: player,
        currentBid: group.currentBid || player.basePrice,
        highestBidder: group.currentHighestBidder,
        userBudget: userBudget,
        aiRecommendation,
        auctionTip
    });
});

// 4. Place a bid
router.post('/bid', (req, res) => {
    const { groupName, username, bidAmount } = req.body;
    const group = groups[groupName];

    if (!group || !group.auctionStarted) return res.json({ success: false, message: "Auction not active" });
    
    const user = group.users[username];
    if (!user) return res.json({ success: false, message: "User not found" });
    if (user.budget < bidAmount) return res.json({ success: false, message: "Insufficient budget" });

    const player = allPlayers[group.currentPlayerIndex];
    const requiredBid = group.currentBid === 0 ? player.basePrice : group.currentBid + 10;
    
    if (bidAmount < requiredBid) {
         return res.json({ success: false, message: `Bid must be at least $${requiredBid}` });
    }

    group.currentBid = bidAmount;
    group.currentHighestBidder = username;
    res.json({ success: true, message: "Bid placed!" });
});

// 5. Sell player (Admin / Host simulated action)
router.post('/sell', (req, res) => {
    const { groupName } = req.body;
    const group = groups[groupName];

    if (!group) return res.json({ success: false, message: "Group not found" });
    if (group.currentPlayerIndex >= allPlayers.length) return res.json({ success: false, message: "No players left" });
    
    const player = allPlayers[group.currentPlayerIndex];

    if (group.currentHighestBidder && group.users[group.currentHighestBidder]) {
        const winner = group.users[group.currentHighestBidder];
        winner.budget -= group.currentBid;
        winner.team.push({
            ...player,
            boughtFor: group.currentBid
        });
    }

    group.currentPlayerIndex++;
    group.currentBid = 0;
    group.currentHighestBidder = null;

    res.json({ success: true, message: "Player sold" });
});

// 6. Get Match Simulation
router.get('/results', (req, res) => {
    const { groupName } = req.query;
    const group = groups[groupName];

    if (!group) return res.json({ success: false, message: "Group not found" });

    const usernames = Object.keys(group.users);
    
    // Pick 2 random users 
    // Fisher-Yates shuffle algorithm to grab exactly 2 unique players
    let shuffled = usernames.slice(0);
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    const userA = shuffled[0];
    const userB = shuffled[1];

    const teamA = group.users[userA].team;
    const teamB = group.users[userB].team;

    const result = simulateMatch(teamA, teamB);

    res.json({
        success: true,
        users: group.users,
        simulation: {
            userA: userA,
            userB: userB,
            scoreA: result.teamA,
            scoreB: result.teamB,
            winner: result.winner === "Team A" ? userA : (result.winner === "Team B" ? userB : "Tie")
        }
    });
});

module.exports = router;
