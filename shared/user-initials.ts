export function userInitials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const letters = parts.length > 1 ? Array.from(parts[0])[0] + Array.from(parts[parts.length - 1])[0] : Array.from(parts[0] || '?').slice(0, 2).join('');
    return letters.toLocaleUpperCase('pt-BR');
}
