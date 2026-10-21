export function showLoading(element: HTMLElement, label = 'Carregando') {
    const indicator = document.createElement('span');
    indicator.className = 'loading-indicator';
    indicator.setAttribute('role', 'status');
    const icon = document.createElement('span');
    icon.className = 'loading-indicator__icon';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = 'loading-indicator__label';
    text.textContent = label;
    indicator.append(icon, text);
    element.replaceChildren(indicator);
}
