// Portfolio Dashboard JavaScript
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 Minuten
const TRADING_HOURS = { start: 8, end: 22 }; // 8-22 Uhr

let currentFilter = 'all';

// Stock Name Mapping (Ticker → Full Name)
const STOCK_NAMES = {
    // US Stocks
    'AAPL': 'Apple Inc.',
    'MSFT': 'Microsoft Corporation',
    'NVDA': 'NVIDIA Corporation',
    'GOOGL': 'Alphabet Inc.',
    'AMZN': 'Amazon.com Inc.',
    'META': 'Meta Platforms Inc.',
    'TSLA': 'Tesla Inc.',
    'NOC': 'Northrop Grumman',
    'GD': 'General Dynamics',
    'LMT': 'Lockheed Martin',
    'LLY': 'Eli Lilly',
    'AMD': 'Advanced Micro Devices',

    // German Stocks
    'ALV.DE': 'Allianz SE',
    'RWE.DE': 'RWE AG',
    'RHM.DE': 'Rheinmetall AG',
    'SIE.DE': 'Siemens AG',
    'SAP': 'SAP SE',
    'DBK.DE': 'Deutsche Bank AG',
    'BMW.DE': 'BMW AG',
    'VOW3.DE': 'Volkswagen AG',
    'NDX1.DE': 'Nordex SE',
    '2GB.DE': '2G Energy AG',
    'SFC.DE': 'SFC Energy AG',

    // EU Stocks
    'ASML': 'ASML Holding',
    'ERIC-B.ST': 'Ericsson',
    'MC.PA': 'LVMH',
    'OR.PA': "L'Oréal",

    // ETFs
    'EWU': 'iShares MSCI United Kingdom ETF',
    'EWG': 'iShares MSCI Germany ETF',
    'EWI': 'iShares MSCI Italy ETF',
    'SPY': 'SPDR S&P 500 ETF',
    'QQQ': 'Invesco QQQ Trust'
};

// Get stock name or return ticker if not found
function getStockName(ticker) {
    return STOCK_NAMES[ticker] || ticker;
}

// Load Portfolio Data
async function loadPortfolio() {
    try {
        const response = await fetch('data/portfolio.json');
        if (!response.ok) throw new Error('Fehler beim Laden der Daten');

        const data = await response.json();
        renderDashboard(data);
        updateLastUpdate(data.last_updated);

        // Load additional analytics
        loadBenchmarks();
        loadPerformanceMetrics();
    } catch (error) {
        console.error('Fehler:', error);
        showError('Fehler beim Laden der Portfolio-Daten');
    }
}

// Load Benchmarks
async function loadBenchmarks() {
    try {
        const response = await fetch('data/benchmarks.json');
        if (!response.ok) throw new Error('Benchmarks nicht verfügbar');

        const data = await response.json();
        renderBenchmarks(data.benchmarks || {});
    } catch (error) {
        console.error('Fehler beim Laden der Benchmarks:', error);
    }
}

// Load Performance Metrics
async function loadPerformanceMetrics() {
    try {
        const response = await fetch('data/performance_metrics.json');
        if (!response.ok) throw new Error('Performance Metrics nicht verfügbar');

        const data = await response.json();
        renderRiskMetrics(data);
        renderTradeStatistics(data.win_loss || {});
    } catch (error) {
        console.error('Fehler beim Laden der Performance Metrics:', error);
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
                <div>
                    <span class="ticker">${getStockName(pos.ticker)}</span>
                    <span class="ticker-symbol">${pos.ticker}</span>
                </div>
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
                    <strong style="margin-left: 10px;">${getStockName(trade.ticker)}</strong>
                    <span class="ticker-symbol" style="margin-left: 5px;">(${trade.ticker})</span>
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

// Render Benchmarks
function renderBenchmarks(benchmarks) {
    const dax = benchmarks.DAX || {};
    const sp500 = benchmarks.SP500 || {};
    const msci = benchmarks.MSCI_WORLD || {};

    // DAX
    document.getElementById('daxPrice').textContent = dax.price
        ? `${dax.price.toLocaleString('de-DE')} ${dax.currency}`
        : '—';
    const daxChangeEl = document.getElementById('daxChange');
    if (dax.change_pct !== undefined) {
        daxChangeEl.textContent = `${dax.change_pct > 0 ? '+' : ''}${dax.change_pct}%`;
        daxChangeEl.className = `benchmark-change ${dax.change_pct >= 0 ? 'positive' : 'negative'}`;
    }

    // S&P 500
    document.getElementById('sp500Price').textContent = sp500.price
        ? `${sp500.price.toLocaleString('de-DE')} ${sp500.currency}`
        : '—';
    const sp500ChangeEl = document.getElementById('sp500Change');
    if (sp500.change_pct !== undefined) {
        sp500ChangeEl.textContent = `${sp500.change_pct > 0 ? '+' : ''}${sp500.change_pct}%`;
        sp500ChangeEl.className = `benchmark-change ${sp500.change_pct >= 0 ? 'positive' : 'negative'}`;
    }

    // MSCI World
    document.getElementById('msciPrice').textContent = msci.price
        ? `${msci.price.toLocaleString('de-DE')} ${msci.currency}`
        : '—';
    const msciChangeEl = document.getElementById('msciChange');
    if (msci.change_pct !== undefined) {
        msciChangeEl.textContent = `${msci.change_pct > 0 ? '+' : ''}${msci.change_pct}%`;
        msciChangeEl.className = `benchmark-change ${msci.change_pct >= 0 ? 'positive' : 'negative'}`;
    }
}

// Render Risk Metrics
function renderRiskMetrics(metrics) {
    // Sharpe Ratio
    const sharpe = metrics.sharpe_ratio || 0;
    const sharpeEl = document.getElementById('sharpeRatio');
    sharpeEl.textContent = sharpe.toFixed(2);
    sharpeEl.className = `metric-value ${sharpe >= 1 ? 'positive' : sharpe >= 0.5 ? 'neutral' : 'negative'}`;

    // Sortino Ratio
    const sortino = metrics.sortino_ratio || 0;
    const sortinoEl = document.getElementById('sortinoRatio');
    if (sortino === Infinity || sortino > 999) {
        sortinoEl.textContent = '∞';
        sortinoEl.className = 'metric-value positive';
    } else {
        sortinoEl.textContent = sortino.toFixed(2);
        sortinoEl.className = `metric-value ${sortino >= 1 ? 'positive' : sortino >= 0.5 ? 'neutral' : 'negative'}`;
    }

    // Volatility
    const volatility = metrics.volatility || 0;
    document.getElementById('volatility').textContent = `${volatility.toFixed(2)}%`;

    // Max Drawdown
    const maxDD = metrics.max_drawdown || {};
    const maxDDEl = document.getElementById('maxDrawdown');
    maxDDEl.textContent = maxDD.max_drawdown_pct !== undefined
        ? `${maxDD.max_drawdown_pct.toFixed(2)}%`
        : '0%';
    maxDDEl.className = `metric-value ${maxDD.max_drawdown_pct === 0 ? 'positive' : 'negative'}`;
}

// Render Trade Statistics
function renderTradeStatistics(winLoss) {
    // Win/Loss Ratio
    const ratio = winLoss.win_loss_ratio || 0;
    const ratioEl = document.getElementById('winLossRatio');
    if (ratio === Infinity || ratio > 999) {
        ratioEl.textContent = '∞';
        ratioEl.className = 'stat-item-value positive';
    } else if (winLoss.total_trades === 0) {
        ratioEl.textContent = '—';
    } else {
        ratioEl.textContent = ratio.toFixed(2);
        ratioEl.className = `stat-item-value ${ratio >= 1 ? 'positive' : 'negative'}`;
    }

    // Win Rate
    const winRate = winLoss.win_rate || 0;
    const winRateEl = document.getElementById('winRate');
    winRateEl.textContent = winLoss.total_trades > 0 ? `${winRate.toFixed(1)}%` : '—';
    winRateEl.className = `stat-item-value ${winRate >= 50 ? 'positive' : 'negative'}`;

    // Avg Win
    document.getElementById('avgWin').textContent = winLoss.avg_win
        ? formatCurrency(winLoss.avg_win)
        : '—';

    // Avg Loss
    document.getElementById('avgLoss').textContent = winLoss.avg_loss
        ? formatCurrency(winLoss.avg_loss)
        : '—';

    // Best Trade
    const bestTrade = winLoss.best_trade;
    const bestEl = document.getElementById('bestTrade');
    if (bestTrade) {
        bestEl.innerHTML = `${bestTrade.ticker}<br><span class="positive">${formatCurrency(bestTrade.pnl)}</span>`;
    } else {
        bestEl.textContent = '—';
    }

    // Worst Trade
    const worstTrade = winLoss.worst_trade;
    const worstEl = document.getElementById('worstTrade');
    if (worstTrade) {
        worstEl.innerHTML = `${worstTrade.ticker}<br><span class="negative">${formatCurrency(worstTrade.pnl)}</span>`;
    } else {
        worstEl.textContent = '—';
    }
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
