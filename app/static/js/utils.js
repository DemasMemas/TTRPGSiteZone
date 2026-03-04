// static/js/utils.js

export function getErrorMessage(data) {
    if (!data) return 'Неизвестная ошибка';
    if (typeof data === 'string') return data;
    if (data.error) {
        if (typeof data.error === 'string') return data.error;
        if (data.error.message) {
            if (data.error.details) {
                let detailsStr = '';
                for (let field in data.error.details) {
                    detailsStr += `${field}: ${data.error.details[field].join(', ')}; `;
                }
                return detailsStr ? `${data.error.message}: ${detailsStr}` : data.error.message;
            }
            return data.error.message;
        }
        if (data.error.details) {
            let detailsStr = '';
            for (let field in data.error.details) {
                detailsStr += `${field}: ${data.error.details[field].join(', ')}; `;
            }
            return detailsStr || 'Ошибка валидации';
        }
    }
    return 'Неизвестная ошибка';
}

export function showNotification(message, type = 'error') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'error' ? '#f44336' : '#4caf50'};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        z-index: 10000;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 5000);
}