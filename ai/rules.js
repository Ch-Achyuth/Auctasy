function getAuctionTip(currentBid, budget, trueValue) {
    if (currentBid > budget * 0.5) return "Warning: Bidding > 50% of your total budget!";
    if (currentBid > trueValue * 1.2) return "Caution: You are overpaying based on player stats.";
    if (currentBid < trueValue * 0.8) return "Great deal: Bidding below true player value.";
    return "Bid is reasonable.";
}

module.exports = { getAuctionTip };
