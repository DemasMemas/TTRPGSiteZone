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

export function showNotification(message, type = 'error', position = 'top-right') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;

    let bgColor;
    switch (type) {
        case 'success': bgColor = '#4caf50'; break;
        case 'system': bgColor = '#ffaa00'; break;
        case 'error':
        default: bgColor = '#f44336';
    }

    let positionStyles = '';
    if (position === 'top-right') {
        positionStyles = 'top: 20px; right: 20px;';
    } else if (position === 'bottom-left') {
        positionStyles = 'bottom: 20px; left: 20px;';
    } else if (position === 'top-left') {
        positionStyles = 'top: 20px; left: 20px;';
    } else if (position === 'bottom-right') {
        positionStyles = 'bottom: 20px; right: 20px;';
    }

    notification.style.cssText = `
        position: fixed;
        ${positionStyles}
        background: ${bgColor};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        z-index: 10000;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        animation: slideIn 0.3s ease;
        max-width: 300px;
        word-wrap: break-word;
    `;

    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 5000);
}