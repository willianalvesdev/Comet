export type PageName = 'index' | 'privacidade' | 'computer' | 'recentes' | 'descobrir' | 'aprender' | 'graficos' | 'cripto';
export interface BootstrapData {
    page: PageName;
    activePage: string;
    user: { id: number; nome: string; email: string } | null;
    csrfToken: string;
    currentYear: number;
    conversationId?: string | number | null;
}
