const express = require('express');
const { shouldBuyPlayer } = require('../ai/agent');
const { getAuctionTip } = require('../ai/rules');
const { simulateMatch } = require('../ai/probability');

module.exports = function(db) {
    const router = express.Router();

    function validateGroupSize(size) {
        const num = parseInt(size);
        if (isNaN(num)) return false;
        return num >= 4 && num % 2 === 0;
    }

    async function isGroupFull(groupName) {
        const group = await db.get(`SELECT maxPlayers FROM auction_groups WHERE name = ?`, [groupName]);
        if (!group) return false;
        const currentNumPlayers = await db.get(`SELECT COUNT(*) as count FROM users WHERE groupName = ?`, [groupName]);
        return currentNumPlayers.count >= group.maxPlayers;
    }

    // 1. Create a new group
    router.post('/create-group', async (req, res) => {
        const { groupName, username, maxPlayers } = req.body;

        if (!groupName || !username || !maxPlayers) {
            return res.json({ success: false, message: "Missing fields" });
        }

        const exactGroup = await db.get(`SELECT * FROM auction_groups WHERE name = ?`, [groupName]);
        if (exactGroup) {
            return res.json({ success: false, message: "Group already exists" });
        }

        if (!validateGroupSize(maxPlayers)) {
            return res.json({ success: false, message: "Group size must be an even number and at least 4." });
        }

        try {
            await db.run(`INSERT INTO auction_groups (name, maxPlayers, auctionStarted, currentPlayerIndex, currentBid, currentHighestBidder) VALUES (?, ?, 0, 0, 0, NULL)`, [groupName, parseInt(maxPlayers)]);
            await db.run(`INSERT INTO users (username, groupName, budget) VALUES (?, ?, 1000)`, [username, groupName]);
            res.json({ success: true, message: "Group created successfully" });
        } catch(e) {
            console.error(e);
            res.json({ success: false, message: "Database err" });
        }
    });

    // 2. Join an existing group
    router.post('/join-group', async (req, res) => {
        const { groupName, username } = req.body;

        const group = await db.get(`SELECT * FROM auction_groups WHERE name = ?`, [groupName]);
        if (!group) {
            return res.json({ success: false, message: "Group does not exist" });
        }

        const existingUser = await db.get(`SELECT * FROM users WHERE username = ? AND groupName = ?`, [username, groupName]);
        if (existingUser) {
            return res.json({ success: false, message: "Username already taken in this group" });
        }

        const full = await isGroupFull(groupName);
        if (full) {
            return res.json({ success: false, message: "Group is full" });
        }

        await db.run(`INSERT INTO users (username, groupName, budget) VALUES (?, ?, 1000)`, [username, groupName]);

        const fullNow = await isGroupFull(groupName);
        if (fullNow) {
            await db.run(`UPDATE auction_groups SET auctionStarted = 1 WHERE name = ?`, [groupName]);
        }

        res.json({ success: true, message: "Joined successfully" });
    });

    // 3. Get current state (Lobby or Active Auction)
    router.get('/auction-state', async (req, res) => {
        const { groupName, username } = req.query;
        const group = await db.get(`SELECT * FROM auction_groups WHERE name = ?`, [groupName]);

        if (!group) {
            return res.json({ status: "INVALID", message: "Group not found" });
        }

        // Lobby State
        if (!group.auctionStarted) {
            const playersList = await db.all(`SELECT username FROM users WHERE groupName = ?`, [groupName]);
            return res.json({
                status: "WAITING",
                currentPlayers: playersList.length,
                maxPlayers: group.maxPlayers,
                playersList: playersList.map(p => p.username)
            });
        }

        // Total players check
        const totalPlayers = await db.get('SELECT COUNT(*) as count FROM players');

        if (group.currentPlayerIndex >= totalPlayers.count) {
            return res.json({ status: "FINISHED" });
        }

        const player = await db.get(`SELECT * FROM players ORDER BY id ASC LIMIT 1 OFFSET ?`, [group.currentPlayerIndex]);
        if(player) {
            player.stats = JSON.parse(player.stats_json);
        }

        let aiRecommendation = "";
        let auctionTip = "";
        let userBudget = 1000;
        
        const user = await db.get(`SELECT budget FROM users WHERE username = ? AND groupName = ?`, [username, groupName]);

        if (user && player) {
            userBudget = user.budget;
            const teamRows = await db.all(`SELECT p.*, ut.boughtFor FROM user_teams ut JOIN players p ON ut.player_id = p.id WHERE ut.username = ? AND ut.groupName = ?`, [username, groupName]);
            const team = teamRows.map(r => ({...r, stats: JSON.parse(r.stats_json)}));

            aiRecommendation = shouldBuyPlayer(team, player, userBudget);
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
    router.post('/bid', async (req, res) => {
        const { groupName, username, bidAmount } = req.body;
        const group = await db.get(`SELECT * FROM auction_groups WHERE name = ?`, [groupName]);

        if (!group || !group.auctionStarted) return res.json({ success: false, message: "Auction not active" });
        
        const user = await db.get(`SELECT * FROM users WHERE username = ? AND groupName = ?`, [username, groupName]);
        if (!user) return res.json({ success: false, message: "User not found" });
        if (user.budget < bidAmount) return res.json({ success: false, message: "Insufficient budget" });

        const player = await db.get(`SELECT * FROM players ORDER BY id ASC LIMIT 1 OFFSET ?`, [group.currentPlayerIndex]);
        const requiredBid = group.currentBid === 0 ? player.basePrice : group.currentBid + 10;
        
        if (bidAmount < requiredBid) {
             return res.json({ success: false, message: `Bid must be at least $${requiredBid}` });
        }

        await db.run(`UPDATE auction_groups SET currentBid = ?, currentHighestBidder = ? WHERE name = ?`, [bidAmount, username, groupName]);
        res.json({ success: true, message: "Bid placed!" });
    });

    // 5. Sell player 
    router.post('/sell', async (req, res) => {
        const { groupName } = req.body;
        const group = await db.get(`SELECT * FROM auction_groups WHERE name = ?`, [groupName]);

        if (!group) return res.json({ success: false, message: "Group not found" });
        const totalPlayers = await db.get('SELECT COUNT(*) as count FROM players');

        if (group.currentPlayerIndex >= totalPlayers.count) return res.json({ success: false, message: "No players left" });
        
        const player = await db.get(`SELECT * FROM players ORDER BY id ASC LIMIT 1 OFFSET ?`, [group.currentPlayerIndex]);

        if (group.currentHighestBidder) {
            await db.run(`UPDATE users SET budget = budget - ? WHERE username = ? AND groupName = ?`, [group.currentBid, group.currentHighestBidder, groupName]);
            await db.run(`INSERT INTO user_teams (username, groupName, player_id, boughtFor) VALUES (?, ?, ?, ?)`, [group.currentHighestBidder, groupName, player.id, group.currentBid]);
        }

        await db.run(`UPDATE auction_groups SET currentPlayerIndex = currentPlayerIndex + 1, currentBid = 0, currentHighestBidder = NULL WHERE name = ?`, [groupName]);

        res.json({ success: true, message: "Player sold" });
    });

    // 6. Get Match Simulation
    router.get('/results', async (req, res) => {
        const { groupName } = req.query;
        const group = await db.get(`SELECT * FROM auction_groups WHERE name = ?`, [groupName]);

        if (!group) return res.json({ success: false, message: "Group not found" });

        const usernamesRaw = await db.all(`SELECT username, budget FROM users WHERE groupName = ?`, [groupName]);
        if (usernamesRaw.length < 2) {
             return res.json({ success: false, message: "Need at least 2 users" });
        }

        // Shuffle
        let shuffled = [...usernamesRaw];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        
        const userA = shuffled[0];
        const userB = shuffled[1];

        const getTeam = async (u) => {
            const teamRows = await db.all(`SELECT p.*, ut.boughtFor FROM user_teams ut JOIN players p ON ut.player_id = p.id WHERE ut.username = ? AND ut.groupName = ?`, [u.username, groupName]);
            return teamRows.map(r => ({...r, stats: JSON.parse(r.stats_json)}));
        };

        const teamA = await getTeam(userA);
        const teamB = await getTeam(userB);

        const result = simulateMatch(teamA, teamB);

        let fullUsersData = {};
        for (let u of usernamesRaw) {
             fullUsersData[u.username] = {
                 budget: u.budget,
                 team: await getTeam(u)
             };
        }

        res.json({
            success: true,
            users: fullUsersData,
            simulation: {
                userA: userA.username,
                userB: userB.username,
                scoreA: result.teamA,
                scoreB: result.teamB,
                winner: result.winner === "Team A" ? userA.username : (result.winner === "Team B" ? userB.username : "Tie")
            }
        });
    });

    return router;
};
