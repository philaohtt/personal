import { DataLogic } from './data-logic.js';
import { GlobalStore } from '../../lib/store.js';
import { qs, openModal, downloadFile, readFileAsText } from '../../lib/dom.js';

export const showPortabilityUI = () => {
    openModal('Data Tools', b => {
        b.innerHTML = `<div class="warning-box">Backup data regularly. CSV export is available in Reports.</div>
            <div style="display:flex; gap:0.5rem; margin-bottom:1rem">
                <button id="e-j" class="btn btn-primary">JSON Export</button>
            </div>
            <div class="field"><label>Restore JSON Backup</label><input type="file" id="i-f" accept=".json"></div>
            <button id="i-b" class="btn btn-danger" style="width:100%">Import & Replace All</button>`;
        qs('#e-j').onclick = async () => downloadFile(await DataLogic.exportJson(), 'backup.json', 'application/json');
        qs('#i-b').onclick = async () => {
            const f = qs('#i-f').files[0]; if(!f) return;
            const d = DataLogic.parseImport(await readFileAsText(f));
            if(confirm("DANGER: This wipes current data!")) { await GlobalStore.runImport(d, 'REPLACE'); location.reload(); }
        };
    });
};