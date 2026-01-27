import { AccountsStore, TxStore } from '../../lib/store.js';
import { qs, slugify, openModal, closeModal, showToast } from '../../lib/dom.js';
import { validateAccount } from '../../lib/validation.js';

export const renderAccounts = async () => {
    const list = await AccountsStore.list();
    const root = qs('#app-root');
    
    root.innerHTML = `
        <div class="card">
            <h3 style="margin:0; font-size:1rem">New Account</h3>
            <form id="a-f" class="grid" style="margin-top:10px">
                <div class="field"><label>Name</label><input id="a-n" required></div>
                <div class="field"><label>Owner</label>
                    <select id="a-o">
                        <option value="personal">Personal</option>
                        <option value="business">Business</option>
                        <option value="shared">Shared</option>
                    </select>
                </div>
                <div class="field"><label>Opening Balance</label><input type="number" id="a-b" value="0"></div>
                <div class="field" style="justify-content:flex-end"><button class="btn btn-primary">Create</button></div>
            </form>
        </div>
        <div class="card">
            <h3 style="margin:0; font-size:1rem">Active Accounts</h3>
            <table><tbody id="a-l"></tbody></table>
        </div>
    `;

    const body = qs('#a-l');
    list.forEach(a => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td><div style="font-weight:600">${a.name}</div><div class="badge">${a.ownerId}</div></td>
            <td class="text-right">
                <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:4px">Init: ${new Intl.NumberFormat().format(a.openingBalance)}</div>
                <button class="btn btn-sm edit-a">Edit</button>
                <button class="btn btn-sm btn-danger archive-a">Archive</button>
            </td>`;
        tr.querySelector('.edit-a').onclick = () => showEdit(a);
        tr.querySelector('.archive-a').onclick = () => handleArchive(a, list.length);
        body.appendChild(tr);
    });

    qs('#a-f').onsubmit = async e => { 
        e.preventDefault(); 
        const name = qs('#a-n').value;
        const ownerId = qs('#a-o').value;
        const customId = `acc_${ownerId}_${slugify(name)}`;
        try { 
            await AccountsStore.create(customId, { 
                name, ownerId, openingBalance: Number(qs('#a-b').value) 
            }); 
            renderAccounts(); 
        } catch(err) { alert(err); }
    };
};

async function handleArchive(acc, total) {
    if (total <= 1) return alert("Last account cannot be archived.");
    if (confirm(`Archive "${acc.name}"?`)) {
        await AccountsStore.archive(acc.id);
        renderAccounts();
    }
}

function showEdit(acc) {
    openModal('Edit Account', b => {
        b.innerHTML = `<div class="field"><label>Name</label><input id="e-n" value="${acc.name}"></div>
            <div class="field"><label>Opening Balance</label><input id="e-b" type="number" value="${acc.openingBalance}"></div>
            <button id="e-s" class="btn btn-primary" style="width:100%; margin-top:10px">Save Changes</button>`;
        qs('#e-s').onclick = async () => { 
            await AccountsStore.update(acc.id, { 
                name: qs('#e-n').value, openingBalance: Number(qs('#e-b').value) 
            }); 
            closeModal(); renderAccounts(); 
        };
    });
}