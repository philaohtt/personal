/**
 * Summary Engine
 * Accounts for opening balances and strict owner buckets
 */
export const getSummary = (txs, accounts, incTransfers = false) => {
    const res = { 
        totalIn: 0, totalOut: 0, 
        byOwner: { personal: { in: 0, out: 0 }, business: { in: 0, out: 0 }, shared: { in: 0, out: 0 } }, 
        byCat: {}, 
        balances: {} 
    };

    // 1. Initialize balances with opening balances
    accounts.forEach(a => {
        res.balances[a.id] = Number(a.openingBalance) || 0;
    });

    txs.forEach(t => {
        const amt = Number(t.amount) || 0;
        const dir = t.direction;
        const ownerId = t.ownerId || 'personal';

        // 2. Continuous Balance calculation
        if (res.balances[t.accountId] !== undefined) {
            if (dir === 'in') res.balances[t.accountId] += amt; 
            else if (dir === 'out') res.balances[t.accountId] -= amt;
        }

        // 3. Totals and Breakdowns (Optionally excluding transfers)
        if (t.type !== 'transfer' || incTransfers) {
            const items = (t.splits && t.splits.length > 0) ? t.splits : [{
                amount: amt,
                ownerId: ownerId,
                category: t.category || 'Uncategorized'
            }];

            items.forEach(item => {
                const iAmt = Number(item.amount) || 0;
                const iOwner = item.ownerId || ownerId;

                if (res.byOwner[iOwner]) {
                    if (dir === 'in') {
                        res.totalIn += iAmt;
                        res.byOwner[iOwner].in += iAmt;
                    } else {
                        res.totalOut += iAmt;
                        res.byOwner[iOwner].out += iAmt;
                        const label = item.category || 'Uncategorized';
                        res.byCat[label] = (res.byCat[label] || 0) + iAmt;
                    }
                }
            });
        }
    });
    return res;
};