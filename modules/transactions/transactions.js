import { TxStore, AccountsStore } from '../../lib/store.js';
import { qs, formatMoney, openModal, closeModal, showToast } from '../../lib/dom.js';
import { getToday, getMonthNow, isValidISODate } from '../../lib/date.js';
import { validateTransaction } from '../../lib/validation.js';

export const renderTransactions = async () => {
    const [accs, txs] = await Promise.all([AccountsStore.list(), TxStore.listByMonth(getMonthNow())]);
    const root = qs('#app-root');

    root.innerHTML = `
        <div class="grid">
            <div class="card">
                <h3 style="margin:0; font-size:1rem">New Transaction</h3>
                <form id="tx-form" style="margin-top:10px">
                    <div class="field"><label>Date (YYYY-MM-DD)</label>
                        <div style="display:flex; gap:5px"><input type="text" id="t-date" value="${getToday()}"><button type="button" class="btn quick-btn" id="t-today">Today</button></div>
                    </div>
                    <div class="field"><label>Amount</label><input type="number" id="t-amt" step="any"></div>
                    <div class="field"><label>Type</label><select id="t-type"><option value="expense">Expense</option><option value="income">Income</option><option value="transfer">Transfer</option></select></div>
                    <div id="standard-fields">
                        <div class="field"><label>Account</label><select id="t-acc">${accs.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}</select></div>
                        <div class="field"><label>Category</label><input id="t-cat"></div>
                        <div class="field"><label>Owner</label><select id="t-owner"><option value="personal">Personal</option><option value="business">Business</option><option value="shared">Shared</option></select></div>
                    </div>
                    <div id="transfer-fields" class="hidden">
                        <div class="field"><label>From</label><select id="t-from">${accs.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}</select></div>
                        <div class="field"><label>To</label><select id="t-to">${accs.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}</select></div>
                    </div>
                    <div class="field"><label>Note</label><input id="t-note"></div>
                    <button class="btn btn-primary" style="width:100%">Save</button>
                </form>
            </div>
            <div class="card"><h3 style="margin:0; font-size:1rem">History</h3><table><tbody id="tx-list-body"></tbody></table></div>
        </div>
    `;

    qs('#t-today').onclick = () => { qs('#t-date').value = getToday(); };
    qs('#t-type').onchange = (e) => { 
        const isTf = e.target.value === 'transfer'; 
        qs('#transfer-fields').classList.toggle('hidden', !isTf); 
        qs('#standard-fields').classList.toggle('hidden', isTf); 
    };

    const body = qs('#tx-list-body');
    txs.forEach(t => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td style="font-size:0.8rem"><div>${t.date.slice(5)}</div><div style="font-weight:600">${t.category || 'Transfer'}</div></td>
            <td class="${t.direction} text-right">${formatMoney(t.amount)}<div style="font-size:0.7rem; color:var(--text-muted)">${accs.find(a=>a.id===t.accountId)?.name || 'Acc'}</div></td>
            <td style="width:30px"><button class="btn btn-sm edit-t">✎</button></td>`;
        tr.querySelector('.edit-t').onclick = () => showEdit(t, accs);
        body.appendChild(tr);
    });

    qs('#tx-form').onsubmit = async (e) => {
        e.preventDefault();
        const date = qs('#t-date').value;
        if (!isValidISODate(date)) return alert("Use YYYY-MM-DD");
        const type = qs('#t-type').value;
        try {
            if (type === 'transfer') {
                await TxStore.createTransfer({ 
                    date, amount: Number(qs('#t-amt').value), fromId: qs('#t-from').value, toId: qs('#t-to').value, note: qs('#t-note').value 
                });
            } else {
                const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '');
                const customId = `tx_${date.replace(/-/g,'')}_${time}_${type}`;
                await TxStore.create(customId, { 
                    date, amount: Number(qs('#t-amt').value), accountId: qs('#t-acc').value, type, 
                    direction: type === 'income' ? 'in' : 'out', category: qs('#t-cat').value, 
                    ownerId: qs('#t-owner').value, note: qs('#t-note').value 
                });
            }
            renderTransactions();
        } catch(err) { alert(err); }
    };
};

function showEdit(tx, accs) {
    openModal('Edit Transaction', b => {
        b.innerHTML = `<form id="e-t-f"><div class="field"><label>Date</label><input id="et-d" value="${tx.date}"></div>
            <div class="field"><label>Amount</label><input id="et-a" type="number" step="any" value="${tx.amount}"></div>
            <div class="field"><label>Note</label><input id="et-n" value="${tx.note || ''}"></div>
            <div style="display:flex; justify-content: space-between; margin-top:10px">
                <button type="button" class="btn btn-danger" id="et-del">Delete</button>
                <button class="btn btn-primary">Update</button>
            </div></form>`;
        qs('#e-t-f').onsubmit = async e => { 
            e.preventDefault(); 
            await TxStore.update(tx.id, { 
                date: qs('#et-d').value, amount: Number(qs('#et-a').value), note: qs('#et-n').value 
            }, tx); 
            closeModal(); renderTransactions(); 
        };
        qs('#et-del').onclick = async () => { 
            if(confirm("Delete?")) { await TxStore.delete(tx.id, tx.groupId); closeModal(); renderTransactions(); }
        };
    });
}