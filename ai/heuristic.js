// Heuristic calculation: Score based on performance stats
function calculateTrueValue(player) {
    let score = player.basePrice; // Start with base price
    const { stats, role } = player;

    if (!stats) return score;

    if (role === 'Batsman' || role === 'All-Rounder') {
        const runs = stats.runs || 0;
        const avg = stats.average || 0;
        score += (runs * 0.05) + (avg * 2);
    }
    
    if (role === 'Bowler' || role === 'All-Rounder') {
        const wickets = stats.wickets || 0;
        const econ = stats.economy || 8;
        // Reward wickets, penalize high economy
        score += (wickets * 1.5) + ((10 - econ) * 5);
    }

    return Math.round(score);
}

module.exports = { calculateTrueValue };
