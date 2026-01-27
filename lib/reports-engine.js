/**
 * Analytics Engine
 * Optimized for Deterministic IDs, Owner IDs, and Opening Balances
 */
export const ReportEngine = {
    /**
     * Normalizes transactions into two data streams
     */
    normalize(transactions) {
        const analyticsPoints = [];
        const ledgerEntries = [];
        
        transactions.forEach(tx => {
            const amount = Number(tx.amount) || 0;
            const isTransfer = tx.type === 'transfer' || tx.category === 'Transfer';
            
            // 1. Ledger Stream (Affects Balances)
            ledgerEntries.push({ 
                accountId: tx.accountId, 
                delta: tx.direction === 'in' ? amount : -amount, 
                date: tx.date 
            });

            // 2. Analytics Stream (Income/Expense)
            // Transfers are excluded from income/expense totals
            if (isTransfer) return;

            const items = (tx.splits && tx.splits.length > 0) ? tx.splits : [tx];
            items.forEach(item => {
                // If ownerId is 'shared', we split the amount 50/50 between personal/business for analytics
                const owners = item.ownerId === 'shared' ? ['personal', 'business'] : [item.ownerId || 'personal'];
                const perOwnerAmount = Number(item.amount || amount) / owners.length;
                
                owners.forEach(o => {
                    analyticsPoints.push({
                        date: tx.date,
                        month: tx.month || tx.date.substring(0, 7),
                        amount: perOwnerAmount,
                        direction: tx.direction,
                        category: item.category || tx.category || 'Uncategorized',
                        ownerId: o
                    });
                });
            });
        });
        return { analyticsPoints, ledgerEntries };
    },
    
    /**
     * Filters the analytics points based on UI selection
     */
    filterPoints(points, filters) {
        return points.filter(p => {
            if (filters.start && p.date < filters.start) return false;
            if (filters.end && p.date > filters.end) return false;
            if (filters.ownerId && filters.ownerId !== 'all' && p.ownerId !== filters.ownerId) return false;
            return true;
        });
    },

    computeCashflow(points) {
        const months = {};
        points.forEach(p => {
            if (!months[p.month]) months[p.month] = { month: p.month, income: 0, expense: 0 };
            if (p.direction === 'in') months[p.month].income += p.amount;
            else months[p.month].expense += p.amount;
        });
        return Object.values(months)
            .sort((a,b) => a.month.localeCompare(b.month))
            .map(m => ({ ...m, net: m.income - m.expense }));
    },

    computeCategoryBreakdown(points) {
        const cats = {}; 
        let total = 0;
        points.forEach(p => {
            if (p.direction !== 'out') return;
            cats[p.category] = (cats[p.category] || 0) + p.amount;
            total += p.amount;
        });
        return Object.entries(cats)
            .map(([category, amount]) => ({ 
                category, 
                amount, 
                percentage: total > 0 ? (amount / total) * 100 : 0 
            }))
            .sort((a,b) => b.amount - a.amount);
    },

    /**
     * Computes totals per owner (Personal/Business/Shared)
     */
    computeOwnerTotals(points) {
        const owners = { 
            personal: { in: 0, out: 0 }, 
            business: { in: 0, out: 0 },
            shared: { in: 0, out: 0 }
        };
        points.forEach(p => {
            const o = p.ownerId;
            if (owners[o]) {
                if (p.direction === 'in') owners[o].in += p.amount;
                else owners[o].out += p.amount;
            }
        });
        return owners;
    },

    /**
     * Snapshot logic that includes account opening balances
     */
    computeSnapshotBalances(ledgerEntries, accounts, upToDate = '9999-12-31') {
        const balances = {};
        // Start from opening balance
        accounts.forEach(a => { 
            balances[a.id] = Number(a.openingBalance) || 0; 
        });

        ledgerEntries.forEach(e => {
            if (e.date <= upToDate && balances[e.accountId] !== undefined) {
                balances[e.accountId] += e.delta;
            }
        });

        const total = Object.values(balances).reduce((sum, curr) => sum + curr, 0);
        return { byAccount: balances, total };
    },

    /**
     * Trend line computing cumulative totals over time
     */
    computeBalanceTrend(ledgerEntries, accounts, startMonth, endMonth) {
        const trend = {};
        const sorted = [...ledgerEntries].sort((a,b) => a.date.localeCompare(b.date));
        
        // Initial cumulative sum from all opening balances
        let runningTotal = accounts.reduce((sum, a) => sum + (Number(a.openingBalance) || 0), 0);
        
        sorted.forEach(e => {
            runningTotal += e.delta;
            const m = e.date.substring(0, 7);
            trend[m] = runningTotal;
        });

        const monthKeys = Object.keys(trend).sort();
        if (monthKeys.length === 0) return [];

        const results = [];
        let curr = monthKeys[0];
        const last = endMonth || monthKeys[monthKeys.length - 1];
        let lastKnownBal = trend[curr];

        while (curr <= last) {
            if (trend[curr] !== undefined) lastKnownBal = trend[curr];
            if (!startMonth || curr >= startMonth) {
                results.push({ month: curr, balance: lastKnownBal });
            }
            // Add 1 month to string
            let [y, m] = curr.split('-').map(Number);
            m++; if (m > 12) { m = 1; y++; }
            curr = `${y}-${String(m).padStart(2, '0')}`;
        }
        return results;
    }
};