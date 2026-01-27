import { TxStore, AccountsStore } from '../../lib/store.js';
import { getSummary } from '../../lib/calc.js';
import { qs, qsa, formatMoney } from '../../lib/dom.js';
import { getMonthNow, getMonthsAgo, getYTDStart, isValidMonth } from '../../lib/date.js';
import { showPortabilityUI } from '../data-portability/data-ui.js';

let currentMonth = getMonthNow();
let includeTransfers = false;

export const renderDashboard = async () => {
    // Query by Month field for efficiency
    const [accs, txs] = await Promise.all([AccountsStore.list(), TxStore.listByMonth(currentMonth)]);
    const sum = getSummary(txs, accs, includeTransfers);
    const root = qs('#app-root');

    root.innerHTML = `
        <div class="card">
            <div class="toolbar">
                <div class="toolbar-section">
                    <div style="display:flex; flex-direction:column">
                        <span class="filter-label">Month</span>
                        <div class="filter-group">
                            <input type="text" id="d-m" class="input-month" value="${currentMonth}" placeholder="YYYY-MM">
                        </div>
                    </div>
                    <button class="btn quick-btn" data-val="${getMonthNow()}">Current</button>
                    <button class="btn quick-btn" data-val="${getMonthsAgo(2)}">Last 3M</button>
                    <button class="btn quick-btn" data-val="${getYTDStart()}">YTD</button>
                </div>
                <div class="toolbar-section">
                    <label style="display:flex; align-items:center; cursor:pointer; gap:5px; font-size:0.85rem">
                        <input type="checkbox" id="d-i" ${includeTransfers ? 'checked' : ''} style="width:auto; height:auto"> Include Transfers
                    </label>
                </div>
                <button id="d-p" class="btn">Data Tools</button>
            </div>
        </div>

        <div class="grid">
            <div class="card">
                <label class="filter-label">Period In</label>
                <div class="in" style="font-size:1.4rem">${formatMoney(sum.totalIn)}</div>
            </div>
            <div class="card">
                <label class="filter-label">Period Out</label>
                <div class="out" style="font-size:1.4rem">${formatMoney(sum.totalOut)}</div>
            </div>
        </div>

        <div class="grid">
            <div class="card">
                <h3 style="margin-top:0; font-size:1rem">Balances</h3>
                <table id="d-b"></table>
            </div>
            <div class="card">
                <h3 style="margin-top:0; font-size:1rem">By Owner</h3>
                <table id="d-o"></table>
            </div>
        </div>
    `;

    const bTable = qs('#d-b');
    accs.forEach(a => {
        const bal = sum.balances[a.id] || 0;
        bTable.innerHTML += `<tr><td>${a.name}</td><td class="text-right ${bal >= 0 ? 'in' : 'out'}">${formatMoney(bal)}</td></tr>`;
    });

    const oTable = qs('#d-o');
    Object.entries(sum.byOwner).forEach(([o, v]) => {
        oTable.innerHTML += `<tr><td>${o}</td><td class="in">${formatMoney(v.in)}</td><td class="out">${formatMoney(v.out)}</td></tr>`;
    });
    
    const mInput = qs('#d-m');
    mInput.onchange = () => { if(isValidMonth(mInput.value)) { currentMonth = mInput.value; renderDashboard(); } else { mInput.value = currentMonth; }};
    qsa('.quick-btn').forEach(b => b.onclick = () => { currentMonth = b.dataset.val; renderDashboard(); });
    qs('#d-i').onchange = (e) => { includeTransfers = e.target.checked; renderDashboard(); };
    qs('#d-p').onclick = showPortabilityUI;
};