export default function LoadingIndicator({label = 'Carregando'}: {label?: string}) {
    return <span className="loading-indicator" role="status"><span className="loading-indicator__icon" aria-hidden="true"/><span className="loading-indicator__label">{label}</span></span>;
}
