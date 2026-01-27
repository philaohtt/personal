/**
 * FIRESTORE SCHEMA CONTRACT
 * Collections: accounts, transactions
 */

export const ALLOWED_OWNERS = ['personal', 'business', 'shared'];
export const ALLOWED_TYPES = ['income', 'expense', 'transfer'];
export const ALLOWED_DIRECTIONS = ['in', 'out'];

export const isValidOwnerId = (id) => ALLOWED_OWNERS.includes(id);
export const isValidTxType = (type) => ALLOWED_TYPES.includes(type);
export const isValidDirection = (dir) => ALLOWED_DIRECTIONS.includes(dir);
export const isValidISODate = (str) => /^\d{4}-\d{2}-\d{2}$/.test(str);
export const isValidMonth = (str) => /^\d{4}-\d{2}$/.test(str);

export const normalizeTxForValidation = (tx) => {
    if (tx.date && (!tx.month || tx.month !== tx.date.substring(0, 7))) {
        tx.month = tx.date.substring(0, 7);
    }
    if (tx.type === 'income' && !tx.direction) tx.direction = 'in';
    if (tx.type === 'expense' && !tx.direction) tx.direction = 'out';
    tx.amount = Number(tx.amount) || 0;
    tx.currency = tx.currency || 'VND';
    tx.note = tx.note || '';
    return tx;
};

export const validateTransaction = (tx, { allowIncomplete = false } = {}) => {
    normalizeTxForValidation(tx);
    if (!isValidTxType(tx.type)) throw `Invalid type: ${tx.type}`;
    if (!isValidDirection(tx.direction)) throw `Invalid direction: ${tx.direction}`;
    if (!isValidOwnerId(tx.ownerId)) throw `Invalid owner: ${tx.ownerId}`;
    if (!isValidISODate(tx.date)) throw `Invalid date: ${tx.date}`;
    if (tx.month !== tx.date.substring(0, 7)) throw "Month mismatch.";
    if (!Number.isFinite(tx.amount) || tx.amount < 0) throw "Amount must be >= 0.";
    if (!tx.accountId) throw "Account is required.";

    if (tx.type === 'transfer') {
        if (!tx.groupId || !tx.fromAccountId || !tx.toAccountId) throw "Transfer fields missing (groupId, from, to).";
        
        // Final Correctness Fix: Transfers must not have category or splits
        if (tx.category || tx.categoryId) throw "Transfers cannot have categories.";
        if (tx.splits && tx.splits.length > 0) throw "Transfers cannot have splits.";
        
    } else {
        if (tx.splits && tx.splits.length > 0) {
            let sum = tx.splits.reduce((s, row) => s + Number(row.amount), 0);
            if (Math.abs(sum - tx.amount) > 0.01) throw "Split sum mismatch.";
        }
    }
    return true;
};

export const validateAccount = (acc) => {
    if (!acc.name || acc.name.trim().length < 2) throw "Name too short.";
    if (!isValidOwnerId(acc.ownerId)) throw "Invalid ownerId.";
    if (!Number.isFinite(Number(acc.openingBalance))) throw "Opening balance must be numeric.";
    return true;
};

export const validateImportSchema = (data) => {
    if (!data.accounts || !Array.isArray(data.accounts)) throw "Missing accounts.";
    if (!data.transactions || !Array.isArray(data.transactions)) throw "Missing transactions.";
};

export const checkConsistency = (transactions) => {
    const errors = [];
    const groups = {};
    transactions.forEach(t => {
        if (t.groupId && t.type === 'transfer') groups[t.groupId] = (groups[t.groupId] || 0) + 1;
    });
    Object.entries(groups).forEach(([id, count]) => {
        if (count !== 2) errors.push(`Transfer group ${id} has ${count} records.`);
    });
    return errors;
};