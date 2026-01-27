import { renderDashboard } from './modules/dashboard/dashboard.js';
import { renderAccounts } from './modules/accounts/accounts.js';
import { renderTransactions } from './modules/transactions/transactions.js';
import { renderReports } from './modules/reports/reports.js';
import { qs, qsa } from './lib/dom.js';

const routes = {
    dashboard: renderDashboard,
    accounts: renderAccounts,
    transactions: renderTransactions,
    reports: renderReports
};

function navigate(tab) {
    qsa('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    qs('#app-root').innerHTML = '<div class="loader">Loading...</div>';
    if (routes[tab]) routes[tab]();
}

qs('#main-nav').onclick = (e) => {
    const tab = e.target.closest('[data-tab]')?.dataset.tab;
    if (tab) navigate(tab);
};

document.addEventListener('DOMContentLoaded', () => navigate('dashboard'));