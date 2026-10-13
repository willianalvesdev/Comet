// Arithmetic only: never evaluate JavaScript or allow names/property access.
export function calculate(expression: string): number {
    if (!expression.trim() || expression.length > 300 || /[^\d\s.eE+*/%()^-]/.test(expression)) throw new Error('Expressão inválida.');
    const tokens = expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[+*/%()^-]/g) ?? [];
    if (tokens.join('') !== expression.replace(/\s/g, '')) throw new Error('Expressão inválida.');
    let index = 0;
    function primary(depth: number): number {
        if (depth > 30) throw new Error('Expressão muito longa.');
        const token = tokens[index++];
        if (token === '+') return primary(depth + 1);
        if (token === '-') return -primary(depth + 1);
        if (token === '(') { const value = sum(depth + 1); if (tokens[index++] !== ')') throw new Error('Parênteses inválidos.'); return value; }
        const value = Number(token);
        if (token === undefined || !Number.isFinite(value)) throw new Error('Número inválido.');
        return value;
    }
    function product(depth: number): number {
        let value = primary(depth);
        while (['*','/','%'].includes(tokens[index])) {
            const op = tokens[index++], right = primary(depth);
            value = op === '*' ? value * right : op === '/' ? value / right : value % right;
        }
        return value;
    }
    function sum(depth: number): number {
        let value = product(depth);
        while (['+','-'].includes(tokens[index])) { const op = tokens[index++], right = product(depth); value = op === '+' ? value + right : value - right; }
        return value;
    }
    const result = sum(0);
    if (index !== tokens.length || !Number.isFinite(result)) throw new Error('Cálculo inválido.');
    return result;
}
