(() => {
    const page = document.querySelector('.computer-page');
    const input = page.querySelector('textarea');
    page.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        page.querySelector('.computer-note').textContent = input.value.trim() ? 'O Computer ainda está em preparação. O processamento de tarefas estará disponível em breve.' : 'Descreva o que você quer fazer para começar.';
    });
})();
