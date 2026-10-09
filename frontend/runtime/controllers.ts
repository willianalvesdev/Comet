import cookies from '../controllers/cookies';
import theme from '../controllers/theme';
import sidebar from '../controllers/sidebar';
import profileMenu from '../controllers/profile-menu';
import chatSearch from '../controllers/chat-search';
import sessions from '../controllers/sessions';
import chatPreview from '../controllers/chat-preview';
import settings from '../controllers/settings';
import notifications from '../controllers/notifications';
import tooltips from '../controllers/tooltips';
import header from '../controllers/header';
import typewriter from '../controllers/typewriter';
import auth from '../controllers/auth';
import computerService from '../controllers/computer-service';
import modelMenu from '../controllers/model-menu';
import responseDetails from '../controllers/response-details';
import attachments from '../controllers/attachments';
import computer from '../controllers/computer';
import chatGreeting from '../controllers/chat-greeting';
import messageNavigator from '../controllers/message-navigator';
import dictation from '../controllers/dictation';
import aprender from '../controllers/aprender';
import news from '../controllers/news';
import weather from '../controllers/weather';
import recentChats from '../controllers/recent-chats';
import graficos from '../controllers/graficos';
import financeData from '../controllers/finance-data';
import graphComposer from '../controllers/graph-composer';
import discoveryPanel from '../controllers/discovery-panel';
import type { PageName } from '../types';
export const sharedControllers = [cookies, theme, tooltips];
export const workspaceControllers = [sidebar, profileMenu, chatSearch, sessions, chatPreview, settings, notifications];
export const pageControllers: Record<PageName, PageFactory[]> = {
    index: [header, typewriter, auth],
    computer: [computerService, modelMenu, responseDetails, attachments, computer, chatGreeting, messageNavigator, dictation],
    recentes: [recentChats],
    aprender: [computerService, modelMenu, attachments, aprender, dictation],
    descobrir: [news, weather],
    graficos: [computerService, modelMenu, graficos, financeData, graphComposer, dictation, discoveryPanel],
};
