import re
from datetime import datetime


def current_context():
    now = datetime.now().astimezone()
    return (f"\nCONTEXTO ATUAL DO SERVIDOR: hoje é {now:%d/%m/%Y}; ano atual {now.year}; "
            f"horário {now:%H:%M %z}. Esta é a data real desta conversa, não uma hipótese. "
            "Não use a data do treinamento ou de mensagens antigas como data de hoje. "
            f"Não trate {now.year} como futuro. Para fatos posteriores ao treinamento, "
            "consulte a busca e reconheça lacunas sem negar o ano atual. "
            "As fontes são exibidas pelo próprio site: não escreva referências numéricas, "
            "links de citação nem listas de fontes ao final da resposta.\n")


def without_source_list(answer):

    parts = re.split(r'(```[\s\S]*?```)',answer)
    for i in range(0,len(parts),2):
        text=parts[i]

        text=re.split(r'(?im)^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:fontes|referências|sources|references)\s*:?(?:\*\*)?\s*:?\s*$',text,maxsplit=1)[0]
        text=re.sub(r'(?<!\w)\[\d{1,2}(?:[,;]\s*\d{1,2})*\](?:\(https?://[^\s)]+\))?', '',text)
        text=re.sub(r' +([.,;!?])', r'\1', text)
        parts[i]=text
    return ''.join(parts).rstrip()
