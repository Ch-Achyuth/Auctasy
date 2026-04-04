// Simulate match performance based on team total true value and some randomness
function simulateMatch(teamA, teamB) {
    // teamA and teamB are arrays of players
    const scoreA = teamA.reduce((sum, p) => sum + (p.trueValue || p.basePrice), 0);
    const scoreB = teamB.reduce((sum, p) => sum + (p.trueValue || p.basePrice), 0);

    // Add +/- 20% randomness
    const varianceA = scoreA * 0.2 * (Math.random() - 0.5);
    const varianceB = scoreB * 0.2 * (Math.random() - 0.5);

    const matchScoreA = Math.round(scoreA + varianceA);
    const matchScoreB = Math.round(scoreB + varianceB);

    let winner = "Tie";
    if (matchScoreA > matchScoreB) winner = "Team A";
    if (matchScoreB > matchScoreA) winner = "Team B";

    return {
        teamA: matchScoreA,
        teamB: matchScoreB,
        winner: winner
    };
}

module.exports = { simulateMatch };
