export const getToday = () => new Date().toISOString().split('T')[0];

export const getMonthNow = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const getMonthsAgo = (n) => {
    const d = new Date();
    d.setMonth(d.getMonth() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const getYTDStart = () => {
    return `${new Date().getFullYear()}-01`;
};

export const isValidMonth = (str) => {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(str);
};

export const isValidISODate = (str) => {
    return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(str);
};

export const getRange = (monthStr) => {
    if (!monthStr || !monthStr.includes('-')) return { start: '1970-01-01', end: '9999-12-31' };
    const [y, m] = monthStr.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const last = new Date(y, m, 0).getDate();
    const end = `${y}-${String(m).padStart(2, '0')}-${last}`;
    return { start, end };
};