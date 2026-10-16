import { useEffect, useState } from 'react';
import type { BootstrapData } from '../types';
import SiteHeader from '../components/SiteHeader';

const sections = [
    ['sobre', 'Sobre esta política'],
    ['dados', 'Dados que utilizamos'],
    ['finalidades', 'Como usamos os dados'],
    ['ia', 'Inteligência artificial e terceiros'],
    ['anonimo', 'Conversas anônimas'],
    ['cookies', 'Cookies e preferências'],
    ['retencao', 'Armazenamento e segurança'],
    ['direitos', 'Seus direitos'],
    ['menores', 'Crianças e adolescentes'],
    ['alteracoes', 'Alterações nesta política'],
    ['contato', 'Fale com o responsável'],
] as const;
const email = 'willian.alves.nascimento2008@gmail.com';

export default function PrivacyPage({bootstrap}: {bootstrap: BootstrapData}) {
    const [active, setActive] = useState<string>('sobre');
    useEffect(() => {
        const observer = new IntersectionObserver(entries => {
            const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
            if (visible[0]) setActive(visible[0].target.id);
        }, {rootMargin: '-100px 0px -55% 0px'});
        document.querySelectorAll('.privacy-article > section').forEach(section => observer.observe(section));
        const frame = requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
        return () => { observer.disconnect(); cancelAnimationFrame(frame); };
    }, []);

    return <div className="privacy-page">
        <a className="privacy-skip" href="#privacy-content">Ir para a política</a>
        <SiteHeader signedIn={Boolean(bootstrap.user)} />
        <main className="privacy-layout" id="privacy-content">
            <header className="privacy-intro">
                <p className="privacy-eyebrow"><a href="/">Comet</a><span aria-hidden="true">/</span>Privacidade</p>
                <h1>Política de<br />Privacidade</h1>
                <p className="privacy-lead">Entenda quais informações utilizamos, por que precisamos delas e como você pode cuidar dos seus dados.</p>
                <p className="privacy-updated">Última atualização: <time dateTime="2026-10-16">16 de outubro de 2026</time></p>
            </header>
            <aside className="privacy-index" aria-label="Índice da política">
                <p>Nesta página</p>
                <nav aria-label="Seções da política de privacidade">
                    {sections.map(([id, title]) => <a key={id} href={'#' + id} aria-current={active === id ? 'location' : undefined} onClick={() => setActive(id)}>{title}</a>)}
                </nav>
            </aside>
            <article className="privacy-article" aria-label="Política de Privacidade do Comet">
                <section id="sobre" aria-labelledby="privacy-about">
                    <h2 id="privacy-about">1. Sobre esta política</h2>
                    <p>Esta política explica como os dados pessoais são tratados no site Comet, incluindo a conta, as conversas com inteligência artificial, a pesquisa e os recursos de organização financeira.</p>
                    <p>O responsável pelo Comet e pelo tratamento descrito aqui é <strong>Willian Alves do Nascimento</strong>. Para dúvidas ou solicitações sobre seus dados, escreva para <a href={'mailto:' + email}>{email}</a>.</p>
                    <p>As informações que você escolhe enviar podem conter dados pessoais seus ou de outras pessoas. Compartilhe apenas o necessário para utilizar o recurso desejado.</p>
                </section>
                <section id="dados" aria-labelledby="privacy-data">
                    <h2 id="privacy-data">2. Dados que utilizamos</h2>
                    <dl className="privacy-data">
                        <div><dt>Conta e acesso</dt><dd>Nome, e-mail, identificadores de conta e informações necessárias à autenticação. Ao entrar com Google ou GitHub, recebemos os dados de identificação autorizados por você nesse serviço. Códigos enviados por e-mail servem para verificar o acesso à conta.</dd></div>
                        <div><dt>Conversas e arquivos</dt><dd>Perguntas, respostas, títulos de chats, datas, arquivos e imagens enviados, além de informações sobre o modelo utilizado e as fontes de uma pesquisa.</dd></div>
                        <div><dt>Personalização e memória</dt><dd>Preferências de resposta, informações de perfil que você preenche e memórias utilizadas para personalizar as conversas quando esse recurso está habilitado. Alguns campos, como ocupação e informações sobre você, são opcionais.</dd></div>
                        <div><dt>Organização financeira</dt><dd>Receitas, despesas, valores, datas, categorias e descrições que você informa para organizar suas finanças e gerar consultas ou gráficos.</dd></div>
                        <div><dt>Microfone e localização</dt><dd>O ditado depende da permissão de microfone e do serviço de reconhecimento de fala do navegador, que pode processar áudio remotamente. O texto transcrito só integra uma conversa ao ser enviado. Se você autorizar a localização, coordenadas aproximadas podem ser usadas na personalização ou na previsão do tempo.</dd></div>
                        <div><dt>Uso e funcionamento</dt><dd>Cookies de sessão, escolhas de armazenamento, preferências do navegador e identificadores técnicos usados para autenticação, prevenção de abuso e funcionamento dos recursos. Ao entrar em contato, também recebemos o conteúdo da sua mensagem.</dd></div>
                    </dl>
                </section>
                <section id="finalidades" aria-labelledby="privacy-purposes">
                    <h2 id="privacy-purposes">3. Como usamos os dados</h2>
                    <p>Utilizamos as informações para permitir o acesso à conta, responder às suas solicitações, manter o histórico de conversas, processar arquivos, organizar os registros financeiros e aplicar as preferências escolhidas por você.</p>
                    <p>Também tratamos informações necessárias para verificar acessos, limitar requisições abusivas, investigar falhas e responder a pedidos relacionados à privacidade.</p>
                    <p>Conforme a finalidade, o tratamento se apoia na execução do serviço solicitado, no consentimento para recursos opcionais, no cumprimento de obrigações legais ou em interesses legítimos relacionados à segurança e ao funcionamento do serviço, respeitados os direitos do titular. O consentimento não é a base de todo tratamento.</p>
                </section>
                <section id="ia" aria-labelledby="privacy-ai">
                    <h2 id="privacy-ai">4. Inteligência artificial e terceiros</h2>
                    <p>Para gerar uma resposta, o Comet envia a solicitação e o contexto necessário ao provedor do modelo selecionado. Isso pode incluir mensagens anteriores, personalização e conteúdo de arquivos. Dependendo da escolha e do recurso, o processamento pode ocorrer pelo OpenRouter e seus provedores de modelos, pelo Google Gemini ou por um serviço de modelo configurado no servidor.</p>
                    <p>Quando a pesquisa web está habilitada, consultas são encaminhadas aos serviços de busca utilizados pelo Comet. Para obter informações meteorológicas, a localização aproximada pode ser enviada aos serviços de mapas e previsão do tempo.</p>
                    <p>Serviços de autenticação, envio de e-mails e infraestrutura também participam do funcionamento do site. Sites abertos a partir das fontes de uma resposta têm suas próprias práticas de privacidade.</p>
                    <p>Esses prestadores podem operar em outros países. Suas condições de processamento, retenção e uso de dados variam. Consulte, por exemplo, a <a href="https://openrouter.ai/privacy" target="_blank" rel="noopener noreferrer">política do OpenRouter</a> e a <a href="https://policies.google.com/privacy?hl=pt-BR" target="_blank" rel="noopener noreferrer">política do Google</a>. Você pode solicitar informações sobre o compartilhamento pelo contato ao final desta página.</p>
                </section>
                <section id="anonimo" aria-labelledby="privacy-anonymous">
                    <h2 id="privacy-anonymous">5. Conversas anônimas</h2>
                    <p>No modo anônimo, as conversas ficam temporariamente na interface e não são adicionadas ao histórico de conversas da conta. A personalização e a memória da conta não são incluídas no contexto dessas conversas.</p>
                    <p>Esse modo não torna a conexão anônima perante os serviços que processam a solicitação. O conteúdo ainda precisa ser enviado ao provedor escolhido para gerar uma resposta, e os controles de autenticação e segurança continuam funcionando.</p>
                </section>
                <section id="cookies" aria-labelledby="privacy-cookies">
                    <h2 id="privacy-cookies">6. Cookies e preferências</h2>
                    <p>Usamos cookies essenciais para manter sua sessão e proteger ações realizadas na conta. Bloqueá-los no navegador pode impedir o acesso ou o funcionamento de alguns recursos.</p>
                    <p>O aviso de cookies permite aceitar ou recusar o armazenamento opcional de preferências, como aparência e interesses. O navegador também pode manter informações de interface, como modelo selecionado, organização dos chats e estado da sessão.</p>
                    <p>Você pode rever sua escolha abaixo ou remover os dados do site nas configurações do navegador. Limpar esses dados pode encerrar o acesso e redefinir preferências; isso não exclui automaticamente as informações salvas na sua conta.</p>
                    <button className="privacy-cookie-button" type="button" onClick={() => window.dispatchEvent(new Event('cookies:manage'))}>Gerenciar preferências de cookies</button>
                </section>
                <section id="retencao" aria-labelledby="privacy-retention">
                    <h2 id="privacy-retention">7. Armazenamento e segurança</h2>
                    <p>Conversas salvas, configurações e registros financeiros ficam associados à sua conta para que você possa utilizá-los novamente. Arquivos enviados também podem ser armazenados para permitir seu processamento e uso na conversa.</p>
                    <p>O tempo de conservação depende da finalidade e das obrigações aplicáveis. Você pode excluir conversas pelos controles do site e solicitar a exclusão de outros dados pelo contato indicado nesta política. A exclusão de uma conversa não deve ser interpretada como garantia de remoção imediata de todos os arquivos associados ou de registros mantidos pelos provedores externos.</p>
                    <p>O Comet utiliza sessões autenticadas, verificação de acesso aos dados da conta e controles contra requisições indevidas. Nenhum sistema oferece segurança absoluta. Se identificar um possível acesso indevido ou exposição de informações, entre em contato com o responsável.</p>
                </section>
                <section id="direitos" aria-labelledby="privacy-rights">
                    <h2 id="privacy-rights">8. Seus direitos</h2>
                    <p>Nos termos da Lei Geral de Proteção de Dados Pessoais (LGPD), você pode solicitar, conforme o caso:</p>
                    <ul>
                        <li>Confirmação do tratamento e acesso aos seus dados.</li>
                        <li>Correção de informações incompletas, inexatas ou desatualizadas.</li>
                        <li>Anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade com a lei.</li>
                        <li>Portabilidade, observadas as regras aplicáveis, e informações sobre o compartilhamento de dados.</li>
                        <li>Revogação do consentimento e informações sobre as consequências de não fornecê-lo.</li>
                        <li>Eliminação de dados tratados com consentimento, respeitadas as hipóteses legais de conservação.</li>
                        <li>Oposição a tratamento irregular e revisão de decisões exclusivamente automatizadas que afetem seus interesses, quando aplicável.</li>
                    </ul>
                    <p>Envie sua solicitação ao <a href="#contato">responsável pelo Comet</a>. Poderemos pedir informações proporcionais para confirmar sua identidade e proteger sua conta. Se houver uma restrição legal ao atendimento, ela será informada na resposta.</p>
                    <p>Você também pode consultar as orientações e os canais de atendimento da <a href="https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados/direito-dos-titulares" target="_blank" rel="noopener noreferrer">Autoridade Nacional de Proteção de Dados (ANPD)</a>.</p>
                </section>
                <section id="menores" aria-labelledby="privacy-minors">
                    <h2 id="privacy-minors">9. Crianças e adolescentes</h2>
                    <p>O tratamento de dados de crianças e adolescentes deve observar seu melhor interesse e as exigências da legislação. Se você é responsável por uma criança ou adolescente e tem dúvidas sobre informações fornecidas ao Comet, entre em contato para solicitar a análise do caso e as medidas cabíveis.</p>
                </section>
                <section id="alteracoes" aria-labelledby="privacy-changes">
                    <h2 id="privacy-changes">10. Alterações nesta política</h2>
                    <p>Esta política pode ser atualizada para refletir mudanças nos recursos ou no tratamento de dados. A versão atual estará disponível nesta página, com a data da última atualização. Alterações que exijam nova informação ou consentimento serão tratadas conforme a legislação aplicável.</p>
                </section>
                <section id="contato" aria-labelledby="privacy-contact">
                    <h2 id="privacy-contact">11. Fale com o responsável</h2>
                    <p>Para dúvidas, correções ou solicitações relacionadas aos seus dados pessoais:</p>
                    <address className="privacy-contact">
                        <strong>Willian Alves do Nascimento</strong>
                        <span>Responsável pelo Comet</span>
                        <a href={'mailto:' + email}>{email}</a>
                    </address>
                    <p>Ao escrever, explique o que deseja solicitar e informe o e-mail associado à conta, se houver. Não envie senhas, códigos de acesso ou documentos que não tenham sido solicitados.</p>
                </section>
            </article>
            <footer className="privacy-footer"><span>Comet · Privacidade</span><a href="#privacy-content">Voltar ao início</a></footer>
        </main>
    </div>;
}