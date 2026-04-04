// Simplistic intelligent agent logic
function shouldBuyPlayer(team, player, budget) {
    const roleCount = team.reduce((acc, p) => {
        acc[p.role] = (acc[p.role] || 0) + 1;
        return acc;
    }, {});

    const needsBatsman = (roleCount['Batsman'] || 0) < 3;
    const needsBowler = (roleCount['Bowler'] || 0) < 3;
    const needsAllRounder = (roleCount['All-Rounder'] || 0) < 1;

    let recommendation = "Ignore.";

    if (budget < player.basePrice) {
        recommendation = "Cannot afford base price.";
        return recommendation;
    }

    if (player.role === 'Batsman' && needsBatsman) {
        recommendation = "Strong buy (need Batsman).";
    } else if (player.role === 'Bowler' && needsBowler) {
        recommendation = "Strong buy (need Bowler).";
    } else if (player.role === 'All-Rounder' && needsAllRounder) {
        recommendation = "Must buy (need All-Rounder).";
    } else if (budget > player.basePrice * 3) {
        recommendation = "Good bench option, you have budget.";
    }

    return recommendation;
}

module.exports = { shouldBuyPlayer };
