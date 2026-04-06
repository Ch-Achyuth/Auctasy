// ===== UI CORE (Toasts & Loading) =====
function showToast(msg, isError = false) {
    let t = document.getElementById('toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'toast';
        document.body.appendChild(t);
    }
    t.innerText = msg;
    t.className = `toast show ${isError ? 'error' : ''}`;
    setTimeout(() => t.classList.remove('show'), 3000);
}

function setLoading(btnId, isLoading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    if (isLoading) {
        btn.dataset.original = btn.innerText;
        btn.innerText = "Processing...";
        btn.disabled = true;
    } else {
        btn.innerText = btn.dataset.original || btn.innerText;
        btn.disabled = false;
    }
}

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

async function handleApi(url, body, btnId) {
    setLoading(btnId, true);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        setLoading(btnId, false);
        return data;
    } catch (e) {
        setLoading(btnId, false);
        showToast("Network error. Please try again.", true);
        return { success: false, message: "Network error" };
    }
}

async function createGroup() {
    const username = document.getElementById('create-username').value.trim();
    const groupName = document.getElementById('create-groupname').value.trim();
    const maxPlayers = parseInt(document.getElementById('create-maxplayers').value);

    if (!username || !groupName || !maxPlayers) return showToast("Please fill all fields.", true);
    if (maxPlayers < 4) return showToast("Minimum players required is 4.", true);
    if (maxPlayers % 2 !== 0) return showToast("Group size must be an even number.", true);

    const data = await handleApi('/api/create-group', { username, groupName, maxPlayers }, 'btn-create');
    
    if (!data.success) {
        showToast(data.message, true);
    } else {
        sessionStorage.setItem('username', username);
        sessionStorage.setItem('groupName', groupName);
        window.location.href = 'auction.html';
    }
}

async function joinGroup() {
    const username = document.getElementById('join-username').value.trim();
    const groupName = document.getElementById('join-groupname').value.trim();

    if (!username || !groupName) return showToast("Please fill all fields.", true);

    const data = await handleApi('/api/join-group', { username, groupName }, 'btn-join');
    
    if (!data.success) {
        showToast(data.message, true);
    } else {
        sessionStorage.setItem('username', username);
        sessionStorage.setItem('groupName', groupName);
        window.location.href = 'auction.html';
    }
}

// BIND ENTER KEYS 
document.addEventListener("DOMContentLoaded", () => {
    ['create-username', 'create-groupname', 'create-maxplayers'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.addEventListener("keypress", (e) => { if(e.key === "Enter") createGroup(); });
    });
    ['join-username', 'join-groupname'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.addEventListener("keypress", (e) => { if(e.key === "Enter") joinGroup(); });
    });
    const bidEl = document.getElementById('bid-input');
    if(bidEl) bidEl.addEventListener("keypress", (e) => { if (e.key === "Enter") placeBid(); });
});

// ===== AUCTION & LOBBY LOGIC =====

let isFinished = false;
let pollingTimer = null;

async function pollAuctionState() {
    if (isFinished) return;

    const username = sessionStorage.getItem('username');
    const groupName = sessionStorage.getItem('groupName');
    if (!username || !groupName) return;

    try {
        const res = await fetch(`/api/auction-state?groupName=${groupName}&username=${username}`);
        const data = await res.json();

        // Handle Errors explicitly
        if (data.status === "INVALID") {
            showToast(data.message, true);
            setTimeout(()=> { window.location.href = "/"; }, 1500);
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
    } finally {
        if(!isFinished) {
            // Safer than setInterval, fires only when previous returns
            pollingTimer = setTimeout(pollAuctionState, 1000);
        }
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
    if (data.userBudget !== undefined) {
        document.getElementById('display-budget').innerText = `Budget: $${data.userBudget} (${username})`;
    }

    const { player, currentBid, highestBidder, aiRecommendation, auctionTip, timeLeft } = data;

    let secondsLeft = Math.ceil(timeLeft / 1000);
    const container = document.getElementById('auction-block');
    
    // Setup static outer HTML only on first load of a new player to avoid jitter
    if (container.dataset.playerId !== String(player.id)) {
        container.dataset.playerId = player.id;
        container.innerHTML = `
            <div class="player-card" style="animation: fadeIn 0.3s ease;">
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
                <h3 id="live-bid-display" style="color:var(--warning)"></h3>
                <div class="timer-bar"><div id="timer-fill" class="timer-fill"></div></div>
                <p id="timer-text" style="font-weight: bold; margin-top:5px;"></p>
            </div>
        `;
    }

    // Dynamic Updates
    document.getElementById('live-bid-display').innerText = `Current Bid: $${currentBid} ${highestBidder ? `(${highestBidder})` : ''}`;
    document.getElementById('agent-rec').innerText = aiRecommendation || "N/A";
    document.getElementById('rule-tip').innerText = auctionTip || "N/A";
    
    // Timer updates
    const fill = document.getElementById('timer-fill');
    if (fill) {
        fill.style.width = `${(secondsLeft/5)*100}%`;
        fill.style.background = secondsLeft <= 2 ? 'var(--danger)' : 'var(--primary)';
        document.getElementById('timer-text').innerText = `⏳ ${secondsLeft}s remaining`;
    }

    const bidInput = document.getElementById('bid-input');
    const minBid = currentBid === player.basePrice && !highestBidder ? player.basePrice : currentBid + 10;
    
    // Only alter placeholder if changed to avoid breaking user typing
    if(bidInput.getAttribute('data-last-bid') !== String(currentBid)) {
        bidInput.min = minBid;
        bidInput.placeholder = `Min bid: $${minBid}`;
        bidInput.setAttribute('data-last-bid', currentBid);
    }
}

async function placeBid() {
    clearTimeout(pollingTimer); // stop polling instantly
    const username = sessionStorage.getItem('username');
    const groupName = sessionStorage.getItem('groupName');
    const bidInput = document.getElementById('bid-input');
    const bidAmount = parseInt(bidInput.value);

    if(isNaN(bidAmount) || bidAmount <= 0) {
        showToast("Please enter a valid bid amount.", true);
        pollAuctionState();
        return;
    }

    const data = await handleApi('/api/bid', { groupName, username, bidAmount }, 'btn-bid');
    
    if(data.success) {
        showToast("Bid Placed! Timer resetting...");
        bidInput.value = ''; // Only wipe if success
    } else {
        showToast(data.message, true);
    }
    
    pollAuctionState(); // force immediate UI refresh
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
