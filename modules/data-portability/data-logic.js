import { GlobalStore } from '../../lib/store.js';
import { validateImportSchema, checkConsistency } from '../../lib/validation.js';

export const DataLogic = {
    async exportJson() { 
        const d = await GlobalStore.fetchEverything(); 
        return JSON.stringify({
            meta: { exportedAt: new Date().toISOString(), version: "1.2" },
            ...d
        }, null, 2); 
    },
    parseImport(s) { 
        const d = JSON.parse(s); 
        validateImportSchema(d); 
        const errs = checkConsistency(d.transactions);
        return { data: d, errs, counts: { a: d.accounts.length, t: d.transactions.length } }; 
    }
};