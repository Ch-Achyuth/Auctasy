const express = require('express');
const { shouldBuyPlayer } = require('../ai/agent');

module.exports = function(db) {
    const router = express.Router();

    function validateGroupSize(size) {
        const num = parseInt(size);
        if (isNaN(num)) return false;
        return num >= 4 && num % 2 === 0;
    }

    function generateRoundRobin(players) {
        const n = players.length;
        let schedule = [];
        let rotated = [...players];
        const fixed = rotated.shift();

        for (let day = 0; day < n - 1; day++) {
            let matchups = [];
            matchups.push([fixed, rotated[0]]);
            for (let i = 1; i < n / 2; i++) {
                matchups.push([rotated[i], rotated[n - 1 - i]]);
            }
            schedule.push(matchups);
            rotated.push(rotated.shift()); 
        }
        return schedule;
    }

    async function isGroupFull(groupName) {
        const group = await db.get(`SELECT maxPlayers FROM groups WHERE name = ?`, [groupName]);
        if (!group) return false;
        const currentNumPlayers = await db.get(`SELECT COUNT(*) as count FROM users WHERE groupName = ?`, [groupName]);
        return currentNumPlayers.count >= group.maxPlayers;
    }

    router.post('/create-group', async (req, res) => {
        const { groupName, username, maxPlayers } = req.body;
        if (!groupName || !username || !maxPlayers) return res.json({ success: false, message: "Missing fields" });

        const exactGroup = await db.get(`SELECT * FROM groups WHERE name = ?`, [groupName]);
        if (exactGroup) return res.json({ success: false, message: "Group already exists" });

        if (!validateGroupSize(maxPlayers)) return res.json({ success: false, message: "Group size must be an even number and at least 4." });

        await db.run(`INSERT INTO groups (name, maxPlayers, status, currentMatchday) VALUES (?, ?, 'WAITING', 0)`, [groupName, parseInt(maxPlayers)]);
        await db.run(`INSERT INTO users (username, groupName) VALUES (?, ?)`, [username, groupName]);
        res.json({ success: true, message: "Group created successfully" });
    });

    router.post('/join-group', async (req, res) => {
        const { groupName, username } = req.body;

        const group = await db.get(`SELECT * FROM groups WHERE name = ?`, [groupName]);
        if (!group) return res.json({ success: false, message: "Group does not exist" });

        const existingUser = await db.get(`SELECT * FROM users WHERE username = ? AND groupName = ?`, [username, groupName]);
        if (existingUser) return res.json({ success: false, message: "Username already taken in this group" });

        const full = await isGroupFull(groupName);
        if (full) return res.json({ success: false, message: "Group is full" });

        await db.run(`INSERT INTO users (username, groupName) VALUES (?, ?)`, [username, groupName]);

        const fullNow = await isGroupFull(groupName);
        if (fullNow) {
            const users = await db.all(`SELECT username FROM users WHERE groupName = ?`, [groupName]);
            const usernames = users.map(u => u.username);
            const schedule = generateRoundRobin(usernames);
            
            await db.run(`UPDATE groups SET status = 'ACTIVE', currentMatchday = 1, maxMatchdays = ? WHERE name = ?`, [schedule.length, groupName]);

            for (let u of usernames) {
                await db.run(`INSERT INTO tournament_standings (username, groupName) VALUES (?, ?)`, [u, groupName]);
            }

            for (let day = 0; day < schedule.length; day++) {
                const matchday = day + 1;
                // Pre-generate 30 random players for this matchday
                const playersList = await db.all(`SELECT id FROM global_players ORDER BY RANDOM() LIMIT 30`);
                for (let i = 0; i < playersList.length; i++) {
                     await db.run(`INSERT INTO matchday_players (groupName, matchday, player_id, sequenceOrder) VALUES (?, ?, ?, ?)`, [groupName, matchday, playersList[i].id, i]);
                }

                // Generate Matches
                for (let match of schedule[day]) {
                     await db.run(`INSERT INTO matches (groupName, matchday, userA, userB, status, lastBidTime, currentPlayerPoolIndex) VALUES (?, ?, ?, ?, 'AUCTION', ?, 0)`, [groupName, matchday, match[0], match[1], Date.now()]);
                     const matchRow = await db.get(`SELECT last_insert_rowid() as id`);
                     await db.run(`INSERT INTO match_budgets (match_id, username) VALUES (?, ?)`, [matchRow.id, match[0]]);
                     await db.run(`INSERT INTO match_budgets (match_id, username) VALUES (?, ?)`, [matchRow.id, match[1]]);
                }
            }
        }

        res.json({ success: true, message: "Joined successfully" });
    });

    function evaluateTeamQuality(teamRows) {
        let sum = 0;
        for (let t of teamRows) { sum += (t.trueValue) || 10000; }
        let base10 = (sum / 150000) * 10;
        if (base10 > 9.9) base10 = 9.9;
        if (base10 < 1.0) base10 = 1.0;
        return base10;
    }

    async function simulateMatchAndScore(match) {
        const teamA_rows = await db.all(`SELECT gp.* FROM match_teams mt JOIN global_players gp ON mt.player_id = gp.id WHERE mt.match_id = ? AND mt.username = ?`, [match.id, match.userA]);
        const teamB_rows = await db.all(`SELECT gp.* FROM match_teams mt JOIN global_players gp ON mt.player_id = gp.id WHERE mt.match_id = ? AND mt.username = ?`, [match.id, match.userB]);

        const scoreA_base = evaluateTeamQuality(teamA_rows);
        const scoreB_base = evaluateTeamQuality(teamB_rows);

        // NRR AI calculation constraint: divide by 10 again, varies by decimal points
        const finalA_NRR = ((scoreA_base / 10) / 10) + (Math.random() * 0.009);
        const finalB_NRR = ((scoreB_base / 10) / 10) + (Math.random() * 0.009);

        let winner = finalA_NRR >= finalB_NRR ? match.userA : match.userB;

        await db.run(`UPDATE matches SET status = 'SIMULATED', winner = ?, scoreA = ?, scoreB = ? WHERE id = ?`, [winner, finalA_NRR, finalB_NRR, match.id]);

        await db.run(`UPDATE tournament_standings SET points = points + 2 WHERE groupName = ? AND username = ?`, [match.groupName, winner]);
        await db.run(`UPDATE tournament_standings SET nrr = nrr + ? WHERE groupName = ? AND username = ?`, [match.groupName, match.userA, finalA_NRR]);
        await db.run(`UPDATE tournament_standings SET nrr = nrr + ? WHERE groupName = ? AND username = ?`, [match.groupName, match.userB, finalB_NRR]);
    }

    async function checkMatchdayProgression(groupName, matchday) {
        const incomplete = await db.get(`SELECT COUNT(*) as c FROM matches WHERE groupName = ? AND matchday = ? AND status != 'SIMULATED'`, [groupName, matchday]);
        if (incomplete.c === 0) {
            const group = await db.get(`SELECT maxMatchdays FROM groups WHERE name = ?`, [groupName]);
            if (matchday >= group.maxMatchdays) {
                 await db.run(`UPDATE groups SET status = 'FINISHED' WHERE name = ?`, [groupName]);
            } else {
                 await db.run(`UPDATE groups SET currentMatchday = currentMatchday + 1 WHERE name = ?`, [groupName]);
                 await db.run(`UPDATE matches SET lastBidTime = ? WHERE groupName = ? AND matchday = ?`, [Date.now(), groupName, matchday + 1]);
            }
        }
    }

    async function internalSellPlayer(matchId) {
        const match = await db.get(`SELECT * FROM matches WHERE id = ?`, [matchId]);
        if (!match || match.status !== 'AUCTION') return;
        
        const poolSize = await db.get('SELECT COUNT(*) as count FROM matchday_players WHERE groupName = ? AND matchday = ?', [match.groupName, match.matchday]);
        
        if (match.currentHighestBidder && match.currentBid > 0) {
             const userA_count = await db.get('SELECT COUNT(*) as c FROM match_teams WHERE match_id = ? AND username = ?', [matchId, match.userA]);
             const userB_count = await db.get('SELECT COUNT(*) as c FROM match_teams WHERE match_id = ? AND username = ?', [matchId, match.userB]);
             
             let canBuy = false;
             if (match.currentHighestBidder === match.userA && userA_count.c < 13) canBuy = true;
             if (match.currentHighestBidder === match.userB && userB_count.c < 13) canBuy = true;

             if (canBuy) {
                 const currentPoolPlayer = await db.get(`SELECT gp.id FROM matchday_players mp JOIN global_players gp ON mp.player_id = gp.id WHERE mp.groupName = ? AND mp.matchday = ? AND mp.sequenceOrder = ?`, [match.groupName, match.matchday, match.currentPlayerPoolIndex]);
                 await db.run(`UPDATE match_budgets SET budget = budget - ? WHERE match_id = ? AND username = ?`, [match.currentBid, matchId, match.currentHighestBidder]);
                 await db.run(`INSERT INTO match_teams (match_id, username, player_id, boughtFor) VALUES (?, ?, ?, ?)`, [matchId, match.currentHighestBidder, currentPoolPlayer.id, match.currentBid]);
             }
        }
        
        const nextIndex = match.currentPlayerPoolIndex + 1;
        // Check if both players hit 13 limit or pool exhausted
        const userA_fCount = await db.get('SELECT COUNT(*) as c FROM match_teams WHERE match_id = ? AND username = ?', [matchId, match.userA]);
        const userB_fCount = await db.get('SELECT COUNT(*) as c FROM match_teams WHERE match_id = ? AND username = ?', [matchId, match.userB]);
        
        if (nextIndex >= poolSize.count || (userA_fCount.c >= 13 && userB_fCount.c >= 13)) {
             await simulateMatchAndScore(match);
             await checkMatchdayProgression(match.groupName, match.matchday);
        } else {
             await db.run(`UPDATE matches SET currentPlayerPoolIndex = ?, currentBid = 0, currentHighestBidder = NULL, lastBidTime = ? WHERE id = ?`, [nextIndex, Date.now(), matchId]);
        }
    }

    router.get('/auction-state', async (req, res) => {
        const { groupName, username } = req.query;
        let group = await db.get(`SELECT * FROM groups WHERE name = ?`, [groupName]);

        if (!group) return res.json({ status: "INVALID", message: "Group not found" });

        if (group.status === 'WAITING') {
            const playersList = await db.all(`SELECT username FROM users WHERE groupName = ?`, [groupName]);
            return res.json({
                status: "WAITING",
                currentPlayers: playersList.length,
                maxPlayers: group.maxPlayers,
                playersList: playersList.map(p => p.username)
            });
        }

        if (group.status === 'FINISHED') return res.json({ status: "FINISHED" });

        const currentDay = group.currentMatchday;
        const match = await db.get(`SELECT * FROM matches WHERE groupName = ? AND matchday = ? AND (userA = ? OR userB = ?)`, [groupName, currentDay, username, username]);
        
        if (!match) return res.json({ status: "INVALID", message: "Match not found" });

        if (match.status === 'SIMULATED') {
             return res.json({ status: "WAITING_FOR_MATCHDAY", matchday: currentDay });
        }

        const elapsedOffset = Date.now() - match.lastBidTime;
        if (elapsedOffset >= 15000) {
            // CRITICAL FIX: Atomic Lock! Only one polling request can win the right to sell the player
            const result = await db.run(`UPDATE matches SET lastBidTime = ? WHERE id = ? AND lastBidTime = ?`, [Date.now() + 10000, match.id, match.lastBidTime]);
            if (result.changes > 0) {
                await internalSellPlayer(match.id);
            }
            
            const freshMatch = await db.get(`SELECT * FROM matches WHERE id = ?`, [match.id]);
            if (freshMatch.status === 'SIMULATED') {
                return res.json({ status: "WAITING_FOR_MATCHDAY", matchday: currentDay });
            }
        }

        const activeMatch = await db.get(`SELECT * FROM matches WHERE id = ?`, [match.id]);
        const poolPlayer = await db.get(`SELECT gp.* FROM matchday_players mp JOIN global_players gp ON mp.player_id = gp.id WHERE mp.groupName = ? AND mp.matchday = ? AND mp.sequenceOrder = ?`, [groupName, currentDay, activeMatch.currentPlayerPoolIndex]);
        if(poolPlayer) poolPlayer.stats = JSON.parse(poolPlayer.stats_json);

        const bRow = await db.get(`SELECT budget FROM match_budgets WHERE match_id = ? AND username = ?`, [match.id, username]);
        const userBudget = bRow ? bRow.budget : 0;
        
        const opponent = activeMatch.userA === username ? activeMatch.userB : activeMatch.userA;
        const teamRows = await db.all(`SELECT p.*, mt.boughtFor FROM match_teams mt JOIN global_players p ON mt.player_id = p.id WHERE mt.match_id = ? AND mt.username = ?`, [match.id, username]);
        
        res.json({
            status: "ACTIVE",
            matchday: currentDay,
            opponent: opponent,
            player: poolPlayer,
            currentBid: activeMatch.currentBid || poolPlayer.basePrice,
            highestBidder: activeMatch.currentHighestBidder,
            userBudget: userBudget,
            teamSize: teamRows.length,
            aiRecommendation: "Bid wisely!",
            auctionTip: "13 Limit Constraint",
            timeLeft: Math.max(0, 15000 - (Date.now() - activeMatch.lastBidTime))
        });
    });

    router.post('/bid', async (req, res) => {
        const { groupName, username, bidAmount } = req.body;
        const group = await db.get(`SELECT * FROM groups WHERE name = ?`, [groupName]);

        if (!group || group.status !== 'ACTIVE') return res.json({ success: false, message: "Tournament not active" });
        
        const match = await db.get(`SELECT * FROM matches WHERE groupName = ? AND matchday = ? AND (userA = ? OR userB = ?)`, [groupName, group.currentMatchday, username, username]);
        if (!match || match.status !== 'AUCTION') return res.json({ success: false, message: "Match not active" });

        const tc = await db.get('SELECT COUNT(*) as c FROM match_teams WHERE match_id = ? AND username = ?', [match.id, username]);
        if (tc.c >= 13) return res.json({ success: false, message: "Team full! Limit 13." });

        const ub = await db.get(`SELECT budget FROM match_budgets WHERE match_id = ? AND username = ?`, [match.id, username]);
        if (ub.budget < bidAmount) return res.json({ success: false, message: "Insufficient budget" });

        const poolPlayer = await db.get(`SELECT gp.* FROM matchday_players mp JOIN global_players gp ON mp.player_id = gp.id WHERE mp.groupName = ? AND mp.matchday = ? AND mp.sequenceOrder = ?`, [groupName, match.matchday, match.currentPlayerPoolIndex]);
        const requiredBid = match.currentBid === 0 ? poolPlayer.basePrice : match.currentBid + 10;
        
        if (bidAmount < requiredBid) return res.json({ success: false, message: `Min bid is $${requiredBid}` });

        await db.run(`UPDATE matches SET currentBid = ?, currentHighestBidder = ?, lastBidTime = ? WHERE id = ?`, [bidAmount, username, Date.now(), match.id]);
        res.json({ success: true, message: "Bid placed!" });
    });

    router.get('/standings', async (req, res) => {
        const { groupName } = req.query;
        const standings = await db.all(`SELECT * FROM tournament_standings WHERE groupName = ? ORDER BY points DESC, nrr DESC`, [groupName]);
        res.json({ success: true, standings });
    });

    return router;
};
