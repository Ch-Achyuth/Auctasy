// ===== HOMEPAGE LOGIC =====
function showForm(type) {
    document.getElementById('home-options').classList.add('hidden');
    document.getElementById('create-form-container').classList.add('hidden');
    document.getElementById('join-form-container').classList.add('hidden');

    if(type === 'create') document.getElementById('create-form-container').classList.remove('hidden');
    if(type === 'join') document.getElementById('join-form-container').classList.remove('hidden');
}

function goBack() {
    document.getElementById('home-options').classList.remove('hidden');
    document.getElementById('create-form-container').classList.add('hidden');
    document.getElementById('join-form-container').classList.add('hidden');
}

async function createGroup() {
    const errorEl = document.getElementById('create-error');
    errorEl.innerText = "";
    
    const username = document.getElementById('create-username').value;
    const groupName = document.getElementById('create-groupname').value;
    const maxPlayers = document.getElementById('create-maxplayers').value;

    if (!username || !groupName || !maxPlayers) return errorEl.innerText = "Please fill all fields.";
    if (maxPlayers < 4) return errorEl.innerText = "Minimum players required is 4.";
    if (maxPlayers % 2 !== 0) return errorEl.innerText = "Group size must be an even number.";

    const res = await fetch('/api/create-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, groupName, maxPlayers })
    });
    const data = await res.json();
    
    if (!data.success) {
        errorEl.innerText = data.message;
    } else {
        sessionStorage.setItem('username', username);
        sessionStorage.setItem('groupName', groupName);
        window.location.href = 'auction.html';
    }
}

async function joinGroup() {
    const errorEl = document.getElementById('join-error');
    errorEl.innerText = "";

    const username = document.getElementById('join-username').value;
    const groupName = document.getElementById('join-groupname').value;

    if (!username || !groupName) return errorEl.innerText = "Please fill all fields.";

    const res = await fetch('/api/join-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, groupName })
    });
    const data = await res.json();
    
    if (!data.success) {
        errorEl.innerText = data.message;
    } else {
        sessionStorage.setItem('username', username);
        sessionStorage.setItem('groupName', groupName);
        window.location.href = 'auction.html';
    }
}

// ===== AUCTION & LOBBY LOGIC =====

let isFinished = false;

async function pollAuctionState() {
    if (isFinished) return;

    const username = sessionStorage.getItem('username');
    const groupName = sessionStorage.getItem('groupName');
    if (!username || !groupName) return;

    try {
        const res = await fetch(`/api/auction-state?groupName=${groupName}&username=${username}`);
        const data = await res.json();

        // Handle Errors implicitly
        if (data.status === "INVALID") {
            alert(data.message);
            window.location.href = "/";
            return;
        }

        // Handle UI Togglings
        const lobbyView = document.getElementById('lobby-view');
        const auctionView = document.getElementById('auction-view');
        const finishedView = document.getElementById('finished-view');

        lobbyView.classList.add('hidden');
        auctionView.classList.add('hidden');
        finishedView.classList.add('hidden');

        if (data.status === "WAITING") {
            lobbyView.classList.remove('hidden');
            renderLobby(data);
        } else if (data.status === "ACTIVE") {
            auctionView.classList.remove('hidden');
            renderAuction(data, username);
        } else if (data.status === "FINISHED") {
            isFinished = true;
            finishedView.classList.remove('hidden');
        }

    } catch (e) {
        console.error("Polling error", e);
    }
}

function renderLobby(data) {
    document.getElementById('lobby-count').innerText = `${data.currentPlayers} / ${data.maxPlayers} Joined`;
    const ul = document.getElementById('lobby-players');
    ul.innerHTML = "";
    data.playersList.forEach(p => {
        ul.innerHTML += `<li>✅ ${p}</li>`;
    });
}

function renderAuction(data, username) {
    // Only update parts that change to avoid jumping
    if (data.userBudget !== undefined) {
        document.getElementById('display-budget').innerText = `Budget: $${data.userBudget} (${username})`;
    }

    const { player, currentBid, highestBidder, aiRecommendation, auctionTip } = data;

    document.getElementById('auction-block').innerHTML = `
        <div class="player-card">
            <img src="${player.imageUrl}" alt="${player.name}">
            <h2>${player.name}</h2>
            <p>${player.role} | Base: $${player.basePrice} | True Value: $${player.trueValue}</p>
            <div class="stats-grid">
                ${player.stats.matches ? `<span>Matches: ${player.stats.matches}</span>` : ''}
                ${player.stats.runs ? `<span>Runs: ${player.stats.runs}</span>` : ''}
                ${player.stats.average ? `<span>Average: ${player.stats.average}</span>` : ''}
                ${player.stats.wickets ? `<span>Wick: ${player.stats.wickets}</span>` : ''}
                ${player.stats.economy ? `<span>Econ: ${player.stats.economy}</span>` : ''}
            </div>
            <h3 style="color:var(--warning)">Current Bid: $${currentBid} ${highestBidder ? `(${highestBidder})` : ''}</h3>
        </div>
    `;

    document.getElementById('agent-rec').innerText = aiRecommendation || "N/A";
    document.getElementById('rule-tip').innerText = auctionTip || "N/A";
    
    // Manage input placeholder
    const bidInput = document.getElementById('bid-input');
    const minBid = currentBid === player.basePrice && !highestBidder ? player.basePrice : currentBid + 10;
    
    // Unfocus and reset value ONLY if the current highest bidder changes, to allow us to type easily
    if(bidInput.getAttribute('data-last-bid') !== String(currentBid)) {
        bidInput.min = minBid;
        bidInput.placeholder = `Min bid: $${minBid}`;
        bidInput.setAttribute('data-last-bid', currentBid);
    }
}

async function placeBid() {
    const username = sessionStorage.getItem('username');
    const groupName = sessionStorage.getItem('groupName');
    const bidInput = document.getElementById('bid-input');
    const bidAmount = parseInt(bidInput.value);

    // Minor client side catch
    if(!bidAmount) return;

    const res = await fetch('/api/bid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupName, username, bidAmount })
    });
    
    const data = await res.json();
    if(data.message.includes("Bid placed")) {
        // Success
    } else {
         alert(data.message);
    }
    bidInput.value = '';
    pollAuctionState();
}

async function sellPlayer() {
    const groupName = sessionStorage.getItem('groupName');
    const res = await fetch('/api/sell', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupName }) 
    });
    const data = await res.json();
    if(!data.success) {
        alert(data.message);
    }
    document.getElementById('bid-input').value = '';
    pollAuctionState();
}

function goToResults() {
    window.location.href = 'results.html';
}

// ===== RESULTS PAGE =====
async function fetchResults() {
    const groupName = sessionStorage.getItem('groupName');
    const res = await fetch(`/api/results?groupName=${groupName}`);
    const data = await res.json();

    const display = document.getElementById('results-display');
    
    if (!data.success) {
        display.innerHTML = `<p>${data.message}</p>`;
        return;
    }

    const { simulation, users } = data;
    
    let html = `
        <h2 style="color:var(--warning)">🏆 Winner: ${simulation.winner}</h2>
        <h3>${simulation.userA}: ${simulation.scoreA} pts vs ${simulation.userB}: ${simulation.scoreB} pts</h3>
        <p><i>Randomly matched 2 teams out of the group.</i></p>
        <div class="stats-grid" style="grid-template-columns: 1fr 1fr; gap: 2rem; margin-top:2rem;">
    `;

    [simulation.userA, simulation.userB].forEach(u => {
        html += `<div><h4>${u}'s Team (Budget left: $${users[u].budget})</h4><ul style="text-align:left;">`;
        if (users[u].team.length === 0) {
            html += `<li>No players bought</li>`;
        } else {
             users[u].team.forEach(p => {
                 html += `<li>${p.name} (${p.role}) - $${p.boughtFor}</li>`;
             });
        }
        html += `</ul></div>`;
    });

    html += `</div>`;
    display.innerHTML = html;
}
