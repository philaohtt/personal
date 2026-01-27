export const qs = (s) => document.querySelector(s);
export const qsa = (s) => document.querySelectorAll(s);

export const formatMoney = (v, curr = 'VND') => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: curr }).format(v);
};

export const showToast = (msg) => {
    const t = qs('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 3000);
};

export const openModal = (title, renderFn) => {
    qs('#modal-title').textContent = title;
    const body = qs('#modal-body');
    body.innerHTML = '';
    renderFn(body);
    qs('#modal-overlay').classList.remove('hidden');
};

export const closeModal = () => qs('#modal-overlay').classList.add('hidden');

export const downloadFile = (content, filename, contentType) => {
    const a = document.createElement("a");
    const file = new Blob([content], { type: contentType });
    a.href = URL.createObjectURL(file);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
};

export const readFileAsText = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });
};

/**
 * Converts "Vietcombank Personal" to "vietcombank_personal"
 * Useful for generating clean Document IDs
 */
export const slugify = (text) => {
    return text.toString().toLowerCase().trim()
        .replace(/\s+/g, '_')           // Replace spaces with _
        .replace(/[^\w-]+/g, '')       // Remove all non-word chars
        .replace(/--+/g, '_');          // Replace multiple - with single _
};

document.addEventListener('DOMContentLoaded', () => {
    qs('#modal-close')?.addEventListener('click', closeModal);
});