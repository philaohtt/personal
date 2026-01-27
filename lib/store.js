import { db } from '../firebase.js';
import { 
    collection, setDoc, getDocs, query, where, orderBy, 
    updateDoc, deleteDoc, doc, writeBatch, serverTimestamp, limit 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { validateTransaction, normalizeTxForValidation, validateAccount } from './validation.js';

export const AccountsStore = {
    async list() {
        const q = query(collection(db, 'accounts'), orderBy('name'));
        const s = await getDocs(q);
        return s.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(a => a.isDeleted !== true);
    },
    async create(customId, data) {
        const acc = {
            ...data,
            openingBalance: Number(data.openingBalance) || 0,
            isActive: true,
            isDeleted: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };
        validateAccount(acc);
        return setDoc(doc(db, 'accounts', customId), acc);
    },
    async update(id, patch) {
        const data = { ...patch, updatedAt: serverTimestamp() };
        if (patch.openingBalance !== undefined) data.openingBalance = Number(patch.openingBalance);
        return updateDoc(doc(db, 'accounts', id), data);
    },
    async archive(id) {
        return updateDoc(doc(db, 'accounts', id), { isDeleted: true, isActive: false, updatedAt: serverTimestamp() });
    }
};

export const TxStore = {
    async listByMonth(monthStr) {
        const q = query(collection(db, 'transactions'), where('month', '==', monthStr), orderBy('date', 'desc'));
        const s = await getDocs(q);
        return s.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    async fetchAll() {
        const s = await getDocs(collection(db, 'transactions'));
        return s.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    async create(customId, data) {
        const tx = normalizeTxForValidation({ ...data });
        validateTransaction(tx);
        return setDoc(doc(db, 'transactions', customId), {
            ...tx,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
    },
    async update(id, patch, original) {
        const txPatch = normalizeTxForValidation({ ...patch });
        const b = writeBatch(db);
        if (original.groupId && original.type === 'transfer') {
            const q = query(collection(db, 'transactions'), where('groupId', '==', original.groupId));
            const s = await getDocs(q);
            s.docs.forEach(d => {
                const merged = { ...d.data(), ...txPatch };
                validateTransaction(merged);
                b.update(d.ref, { 
                    amount: txPatch.amount, date: txPatch.date, month: txPatch.month,
                    note: txPatch.note, updatedAt: serverTimestamp() 
                });
            });
        } else {
            const merged = { ...original, ...txPatch };
            validateTransaction(merged);
            b.update(doc(db, 'transactions', id), { ...txPatch, updatedAt: serverTimestamp() });
        }
        return b.commit();
    },
    async delete(id, groupId = null) {
        if (groupId) {
            const q = query(collection(db, 'transactions'), where('groupId', '==', groupId));
            const s = await getDocs(q);
            const b = writeBatch(db);
            s.docs.forEach(d => b.delete(d.ref));
            return b.commit();
        }
        return deleteDoc(doc(db, 'transactions', id));
    },
    async createTransfer(t, extra = {}) {
        const gid = crypto.randomUUID();
        const b = writeBatch(db);
        const base = normalizeTxForValidation({
            date: t.date, amount: t.amount, type: 'transfer',
            note: t.note || "", ownerId: 'shared', groupId: gid,
            fromAccountId: t.fromId, toAccountId: t.toId, ...extra
        });
        const dateCompact = t.date.replace(/-/g, '');
        const idBase = `${dateCompact}_${gid.substring(0, 8)}`;
        b.set(doc(db, 'transactions', `tx_${idBase}_out`), { ...base, accountId: t.fromId, direction: 'out', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        b.set(doc(db, 'transactions', `tx_${idBase}_in`), { ...base, accountId: t.toId, direction: 'in', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        return b.commit();
    },
    async countByAccount(accountId) {
        const q = query(collection(db, 'transactions'), where('accountId', '==', accountId), limit(1));
        const s = await getDocs(q);
        return s.size;
    }
};

export const GlobalStore = {
    async fetchEverything() {
        const [a, t] = await Promise.all([
            getDocs(collection(db, 'accounts')), 
            getDocs(collection(db, 'transactions'))
        ]);
        return { 
            accounts: a.docs.map(d => ({ id: d.id, ...d.data() })), 
            transactions: t.docs.map(d => ({ id: d.id, ...d.data() })) 
        };
    },
    async runImport(data, mode, onProgress) {
        const current = await this.fetchEverything();
        const ops = [];
        
        if (mode === 'REPLACE') {
            current.accounts.forEach(a => ops.push({ type: 'delete', ref: doc(db, 'accounts', a.id) }));
            current.transactions.forEach(t => ops.push({ type: 'delete', ref: doc(db, 'transactions', t.id) }));
        }

        data.accounts.forEach(({ id, ...rest }) => ops.push({ type: 'set', ref: doc(db, 'accounts', id), data: rest }));
        data.transactions.forEach(({ id, ...rest }) => ops.push({ type: 'set', ref: doc(db, 'transactions', id), data: rest }));

        const batchSize = 400;
        for (let i = 0; i < ops.length; i += batchSize) {
            const b = writeBatch(db);
            const chunk = ops.slice(i, i + batchSize);
            chunk.forEach(o => {
                if (o.type === 'delete') b.delete(o.ref);
                else b.set(o.ref, o.data, { merge: true });
            });
            await b.commit();
            if (onProgress) onProgress(Math.round(((i + chunk.length) / ops.length) * 100));
        }
    }
};