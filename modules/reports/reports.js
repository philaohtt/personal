import { TxStore, AccountsStore } from '../../lib/store.js';
import { ReportEngine } from '../../lib/reports-engine.js';
import { qs, qsa, formatMoney, downloadFile } from '../../lib/dom.js';
import { getMonthNow, getMonthsAgo, getYTDStart, getToday } from '../../lib/date.js';

let currentFilters = { 
    startMonth: getMonthsAgo(2), 
    endMonth: getMonthNow(), 
    ownerId: 'all', 
    accountIds: [] 
};

export const renderReports = async () => {
    const [accounts, allTransactions] = await Promise.all([
        AccountsStore.list(), 
        TxStore.fetchAll()
    ]);
    const root = qs('#app-root');

    root.innerHTML = `
        <div class="card">
            <div class="filter-toolbar">
                <div class="toolbar-row" style="display:flex; flex-wrap:wrap; gap:1rem; align-items:flex-end">
                    <div>
                        <span class="filter-label">Quick Ranges</span>
                        <div style="display:flex; gap:4px">
                            <button class="btn quick-btn" data-range="this">This Month</button>
                            <button class="btn quick-btn" data-range="3m">Last 3M</button>
                            <button class="btn quick-btn" data-range="6m">Last 6M</button>
                            <button class="btn quick-btn" data-range="ytd">YTD</button>
                            <button class="btn quick-btn" data-range="all">All</button>
                        </div>
                    </div>
                    <div>
                        <span class="filter-label">Custom Period</span>
                        <div class="filter-group">
                            <input type="text" id="f-start" class="input-month" value="${currentFilters.startMonth}" placeholder="YYYY-MM">
                            <span style="color:var(--text-muted)">→</span>
                            <input type="text" id="f-end" class="input-month" value="${currentFilters.endMonth}" placeholder="YYYY-MM">
                        </div>
                    </div>
                    <button id="run-report" class="btn btn-primary">Run Report</button>
                </div>

                <div class="collapsible-trigger" id="adv-toggle">
                    <span>▶ Advanced Filters (Accounts & Owners)</span>
                </div>
                
                <div id="adv-content" class="collapsible-content hidden">
                    <div style="display:grid; grid-template-columns: 180px 1fr; gap: 1.5rem">
                        <div class="field">
                            <label>Owner Scope</label>
                            <select id="f-owner">
                                <option value="all" ${currentFilters.ownerId === 'all' ? 'selected' : ''}>All</option>
                                <option value="personal" ${currentFilters.ownerId === 'personal' ? 'selected' : ''}>Personal</option>
                                <option value="business" ${currentFilters.ownerId === 'business' ? 'selected' : ''}>Business</option>
                                <option value="shared" ${currentFilters.ownerId === 'shared' ? 'selected' : ''}>Shared</option>
                            </select>
                        </div>
                        <div class="field">
                            <label>Include Accounts</label>
                            <div id="f-acc-list" style="display:flex; flex-wrap:wrap; gap: 8px 15px">
                                ${accounts.map(a => `
                                    <label style="font-weight:400; font-size:0.85rem; cursor:pointer">
                                        <input type="checkbox" value="${a.id}" ${currentFilters.accountIds.includes(a.id) || currentFilters.accountIds.length === 0 ? 'checked' : ''}> ${a.name}
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div id="report-results"></div>
    `;

    // Collapsible Logic
    qs('#adv-toggle').onclick = () => { 
        const c = qs('#adv-content'); 
        const t = qs('#adv-toggle span'); 
        c.classList.toggle('hidden');
        t.textContent = c.classList.contains('hidden') ? '▶ Advanced Filters (Accounts & Owners)' : '▼ Advanced Filters (Accounts & Owners)';
    };

    // Quick Buttons Logic
    qsa('.quick-btn').forEach(btn => btn.onclick = () => {
        const r = btn.dataset.range;
        const now = getMonthNow();
        if(r==='this') { currentFilters.startMonth = now; currentFilters.endMonth = now; }
        else if(r==='3m') { currentFilters.startMonth = getMonthsAgo(2); currentFilters.endMonth = now; }
        else if(r==='6m') { currentFilters.startMonth = getMonthsAgo(5); currentFilters.endMonth = now; }
        else if(r==='ytd') { currentFilters.startMonth = getYTDStart(); currentFilters.endMonth = now; }
        else if(r==='all') { currentFilters.startMonth = '2020-01'; currentFilters.endMonth = now; }
        
        qs('#f-start').value = currentFilters.startMonth; 
        qs('#f-end').value = currentFilters.endMonth;
        qs('#run-report').click();
    });

    // Run Logic
    qs('#run-report').onclick = () => {
        currentFilters.startMonth = qs('#f-start').value; 
        currentFilters.endMonth = qs('#f-end').value;
        currentFilters.start = currentFilters.startMonth + '-01'; 
        currentFilters.end = currentFilters.endMonth + '-31';
        currentFilters.ownerId = qs('#f-owner').value; 
        currentFilters.accountIds = Array.from(qsa('#f-acc-list input:checked')).map(i => i.value);
        
        updateDisplay(allTransactions, accounts);
    };

    // Initial run
    qs('#run-report').click();
};

function updateDisplay(allTx, accounts) {
    const { analyticsPoints, ledgerEntries } = ReportEngine.normalize(allTx);
    const filtered = ReportEngine.filterPoints(analyticsPoints, currentFilters);
    
    // Engine calls
    const cashflow = ReportEngine.computeCashflow(filtered);
    const cats = ReportEngine.computeCategoryBreakdown(filtered);
    const ownerTotals = ReportEngine.computeOwnerTotals(filtered);
    const snapshot = ReportEngine.computeSnapshotBalances(ledgerEntries, accounts, currentFilters.end);
    const trend = ReportEngine.computeBalanceTrend(ledgerEntries, accounts, currentFilters.startMonth, currentFilters.endMonth);

    qs('#report-results').innerHTML = `
        <div class="grid">
            <section class="card">
                <div style="display:flex; justify-content:space-between; align-items:center">
                    <h3 style="margin:0; font-size:0.95rem">Monthly Cashflow</h3>
                    <button class="btn btn-sm" id="csv-cf">CSV</button>
                </div>
                <table>
                    <thead><tr><th>Month</th><th>In</th><th>Out</th><th>Net</th></tr></thead>
                    <tbody>
                        ${cashflow.map(m => `
                            <tr>
                                <td>${m.month}</td>
                                <td class="in">${formatMoney(m.income)}</td>
                                <td class="out">${formatMoney(m.expense)}</td>
                                <td style="font-weight:700">${formatMoney(m.net)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </section>

            <section class="card">
                <div style="display:flex; justify-content:space-between; align-items:center">
                    <h3 style="margin:0; font-size:0.95rem">Expenses by Category</h3>
                    <button class="btn btn-sm" id="csv-cat">CSV</button>
                </div>
                <table>
                    <thead><tr><th>Category</th><th class="text-right">Amount</th></tr></thead>
                    <tbody>
                        ${cats.slice(0, 10).map(c => `
                            <tr><td>${c.category}</td><td class="text-right out">${formatMoney(c.amount)}</td></tr>
                        `).join('')}
                    </tbody>
                </table>
            </section>
        </div>

        <div class="grid">
            <section class="card">
                <h3 style="margin:0; font-size:0.95rem">Account Balances (Snapshot)</h3>
                <table>
                    ${Object.entries(snapshot.byAccount).map(([id, bal]) => `
                        <tr>
                            <td>${accounts.find(a => a.id === id)?.name || 'Account'}</td>
                            <td class="text-right ${bal >= 0 ? 'in' : 'out'}">${formatMoney(bal)}</td>
                        </tr>
                    `).join('')}
                    <tr style="font-weight:800; border-top:2px solid var(--border)">
                        <td>Total Equity</td>
                        <td class="text-right">${formatMoney(snapshot.total)}</td>
                    </tr>
                </table>
            </section>

            <section class="card">
                <h3 style="margin:0; font-size:0.95rem">Owner Breakdown</h3>
                <table>
                    <thead><tr><th>Owner</th><th>In</th><th>Out</th></tr></thead>
                    ${Object.entries(ownerTotals).map(([o, v]) => `
                        <tr>
                            <td style="text-transform: capitalize">${o}</td>
                            <td class="in">${formatMoney(v.in)}</td>
                            <td class="out">${formatMoney(v.out)}</td>
                        </tr>
                    `).join('')}
                </table>
            </section>
        </div>

        <section class="card">
            <h3 style="margin:0; font-size:0.95rem">Total Balance Trend</h3>
            <div class="chart-container" style="height:150px">
                ${renderChart(trend)}
            </div>
        </section>
    `;

    // Export Handlers
    qs('#csv-cf').onclick = () => downloadFile(
        "Month,Income,Expense,Net\n" + cashflow.map(m => `${m.month},${m.income},${m.expense},${m.net}`).join('\n'), 
        `cashflow_${getToday()}.csv`, 'text/csv'
    );
    qs('#csv-cat').onclick = () => downloadFile(
        "Category,Amount\n" + cats.map(c => `"${c.category}",${c.amount}`).join('\n'), 
        `categories_${getToday()}.csv`, 'text/csv'
    );
}

function renderChart(data) {
    if (data.length < 2) return `<div style="text-align:center; padding-top:60px; color:var(--text-muted)">Need 2+ months of data for trend.</div>`;
    const w = 800, h = 150, p = 30;
    const vals = data.map(d => d.balance);
    const max = Math.max(...vals), min = Math.min(...vals), rng = max - min || 1;
    const getX = i => p + (i * (w - p * 2) / (data.length - 1));
    const getY = v => h - p - ((v - min) / rng) * (h - p * 2);
    
    return `
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%; height:100%">
            <polyline fill="none" stroke="var(--primary)" stroke-width="3" points="${data.map((d,i) => `${getX(i)},${getY(d.balance)}`).join(' ')}" />
            ${data.map((d,i) => `
                <text x="${getX(i)}" y="${h-5}" text-anchor="middle" style="font-size:10px; fill:var(--text-muted)">${d.month.substring(5)}</text>
                <circle cx="${getX(i)}" cy="${getY(d.balance)}" r="3" fill="var(--primary)" />
            `).join('')}
        </svg>
    `;
}