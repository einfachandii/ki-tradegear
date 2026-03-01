// Portfolio Dashboard JavaScript
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 Minuten
const TRADING_HOURS = { start: 8, end: 22 }; // 8-22 Uhr

let currentFilter = 'all';

// Load Portfolio Data
async function loadPortfolio() {
    try {
        const response = await fetch('data/portfolio.json');
        if (!response.ok) throw new Error('Fehler beim Laden der Daten');

        const data = await response.json();
        renderDashboard(data);
        updateLastUpdate(data.last_updated);
    } catch (error) {
        console.error('Fehler:', error);
        showError('Fehler beim Laden der Portfolio-Daten');
    }
}

// Render Dashboard
function renderDashboard(data) {
    renderPerformance(data);
    renderPositions(data.positions || []);
    renderTrades(data.trades || []);
    renderInsights(data.insights || []);
}

// Render Performance Overview
function renderPerformance(data) {
    const cash = data.cash || 0;
    const startCapital = data.initial_capital || 3000;

    // Calculate positions value
    const positionsValue = (data.positions || []).reduce((sum, pos) => {
        return sum + (pos.current_price * pos.quantity);
    }, 0);

    const totalValue = cash + positionsValue;
    const performance = ((totalValue - startCapital) / startCapital * 100).toFixed(2);
    const profitLoss = totalValue - startCapital;

    document.getElementById('totalValue').textContent = formatCurrency(totalValue);

    const perfElement = document.getElementById('performance');
    perfElement.textContent = `${performance > 0 ? '+' : ''}${performance}%`;
    perfElement.className = `stat-value ${performance >= 0 ? 'positive' : 'negative'}`;

    const plElement = document.getElementById('profitLoss');
    plElement.textContent = formatCurrency(profitLoss);
    plElement.className = `stat-value ${profitLoss >= 0 ? 'positive' : 'negative'}`;

    document.getElementById('cashValue').textContent = formatCurrency(cash);
}

// Render Positions
function renderPositions(positions) {
    const grid = document.getElementById('positionsGrid');

    if (!positions || positions.length === 0) {
        grid.innerHTML = '<div class="loading">Keine offenen Positionen</div>';
        return;
    }

    grid.innerHTML = positions.map(pos => {
        const currentValue = pos.current_price * pos.quantity;
        const entryValue = pos.entry_price * pos.quantity;
        const pnl = currentValue - entryValue;
        const pnlPercent = ((currentValue - entryValue) / entryValue * 100);

        return `
        <div class="position-card">
            <div class="position-header">
                <span class="ticker">${pos.ticker}</span>
                <span class="position-change ${pnlPercent >= 0 ? 'positive' : 'negative'}">
                    ${pnlPercent > 0 ? '+' : ''}${pnlPercent.toFixed(2)}%
                </span>
            </div>
            <div class="position-details">
                <div><strong>Stück:</strong> ${pos.quantity}</div>
                <div><strong>Ø Kaufpreis:</strong> ${formatCurrency(pos.entry_price)}</div>
                <div><strong>Aktuell:</strong> ${formatCurrency(pos.current_price)}</div>
                <div><strong>Wert:</strong> ${formatCurrency(currentValue)}</div>
                <div><strong>G/V:</strong>
                    <span class="${pnl >= 0 ? 'positive' : 'negative'}">
                        ${formatCurrency(pnl)}
                    </span>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

// Render Trades
function renderTrades(trades) {
    const list = document.getElementById('tradesList');

    if (!trades || trades.length === 0) {
        list.innerHTML = '<div class="loading">Keine Trades vorhanden</div>';
        return;
    }

    const filteredTrades = currentFilter === 'all'
        ? trades
        : trades.filter(t => t.action.toLowerCase() === currentFilter);

    list.innerHTML = filteredTrades.map(trade => {
        const type = trade.action.toLowerCase();
        const total = trade.price * trade.quantity;

        return `
        <div class="trade-item ${type}">
            <div class="trade-header">
                <div>
                    <span class="trade-type ${type}">${type === 'buy' ? 'KAUF' : 'VERKAUF'}</span>
                    <strong style="margin-left: 10px;">${trade.ticker}</strong>
                </div>
                <span class="trade-date">${formatDate(trade.timestamp)}</span>
            </div>
            <div class="trade-info">
                ${trade.quantity} Stück @ ${formatCurrency(trade.price)} = ${formatCurrency(total)}
            </div>
            ${trade.reason ? `
                <div class="trade-reason">
                    💡 ${trade.reason}
                </div>
            ` : ''}
        </div>
        `;
    }).join('');
}

// Render AI Insights
function renderInsights(insights) {
    const grid = document.getElementById('insightsGrid');

    if (!insights || insights.length === 0) {
        grid.innerHTML = `
            <div class="insight-card">
                <div class="insight-title">💤 Aktuell keine AI-Analyse</div>
                <div class="insight-content">
                    Der Trading-Bot läuft während Börsenzeiten (Mo-Fr 8-22 Uhr). <br>
                    Sobald der Bot tradet, erscheinen hier die AI-Begründungen und Trading-Pläne.
                </div>
            </div>
        `;
        return;
    }

    // Sort insights by timestamp (newest first)
    const sortedInsights = [...insights].sort((a, b) => {
        return new Date(b.timestamp) - new Date(a.timestamp);
    });

    grid.innerHTML = sortedInsights.map(insight => {
        const icon = insight.type === 'trade' ? '🔔' :
                     insight.type === 'system' ? '⚙️' : '💡';
        const time = new Date(insight.timestamp).toLocaleTimeString('de-DE', {
            hour: '2-digit', minute: '2-digit'
        });

        return `
            <div class="insight-card insight-${insight.type}">
                <div class="insight-header">
                    <span class="insight-icon">${icon}</span>
                    <span class="insight-title">${insight.title}</span>
                    <span class="insight-time">${time}</span>
                </div>
                <div class="insight-content">${insight.content.replace(/\n/g, '<br>')}</div>
            </div>
        `;
    }).join('');
}

// Update Last Update Timestamp
function updateLastUpdate(timestamp) {
    const date = new Date(timestamp);
    const formatted = date.toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    document.getElementById('lastUpdate').textContent = `Letztes Update: ${formatted}`;
}

// Format Currency
function formatCurrency(amount) {
    return new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR'
    }).format(amount);
}

// Format Date
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Show Error
function showError(message) {
    document.getElementById('positionsGrid').innerHTML =
        `<div class="loading" style="color: var(--danger);">❌ ${message}</div>`;
}

// Check if within trading hours
function isTradingHours() {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0 = Sonntag, 6 = Samstag

    // Montag-Freitag, 8-22 Uhr
    return day >= 1 && day <= 5 && hour >= TRADING_HOURS.start && hour < TRADING_HOURS.end;
}

// Auto-Refresh
function startAutoRefresh() {
    setInterval(() => {
        if (isTradingHours()) {
            console.log('Auto-Refresh: Börsenzeiten aktiv');
            loadPortfolio();
        } else {
            console.log('Auto-Refresh: Außerhalb Börsenzeiten');
        }
    }, REFRESH_INTERVAL);
}

// Filter Buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;

        // Reload trades with new filter
        fetch('data/portfolio.json')
            .then(res => res.json())
            .then(data => renderTrades(data.trades))
            .catch(err => console.error('Fehler beim Filtern:', err));
    });
});

// Initial Load
loadPortfolio();
startAutoRefresh();
