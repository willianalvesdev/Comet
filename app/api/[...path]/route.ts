import { requestEmailCode, verifyEmailCode } from '../../../server/email-auth';
import { startOAuth, finishOAuth } from '../../../server/oauth';
import { bootstrap, requireUser, verifyCSRF } from '../../../server/auth';
import { boundedRequest, ApiError, errorResponse } from '../../../server/http';
import { rateLimit } from '../../../server/rate-limit';
import { handleAI } from '../../../server/ai';
import { handleFinance } from '../../../server/finance';
import { handleNews } from '../../../server/news';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(original: Request): Promise<Response> {
    try {
        const path = new URL(original.url).pathname.slice('/api/'.length).split('/');
        const request = ['POST','PUT','PATCH','DELETE'].includes(original.method)
            ? await boundedRequest(original, path.join('/') === 'ai/attachments' ? 9*1024*1024 : path.join('/') === 'ai/chat' ? 256*1024 : 64*1024) : original;
        if (['POST','PUT','PATCH','DELETE'].includes(request.method)) await verifyCSRF(request);
        if (path.join('/') === 'bootstrap' && request.method === 'GET') return await bootstrap(request);
        if (path[0] === 'auth') {
            const route = path.slice(1).join('/');
            if (request.method === 'POST' && route === 'email/request') return await requestEmailCode(request);
            if (request.method === 'POST' && route === 'email/verify') return await verifyEmailCode(request);
            if (path.length === 3 && ['google','github'].includes(path[1])) {
                if (request.method === 'POST' && path[2] === 'start') return await startOAuth(request,path[1]);
                if (request.method === 'GET' && path[2] === 'callback') return await finishOAuth(request,path[1]);
            }
            throw new ApiError(404,'Rota de autenticação não encontrada.');
        }
        const user = await requireUser(request);
        let response: Response | null = null;
        if (path[0] === 'ai') {
            if (request.method === 'GET') await rateLimit(request,'ai-read',120,user.id);
            else if (path[1] === 'chat' || path.at(-1) === 'regenerate') await rateLimit(request,'ai-chat',10,user.id);
            else if (path[1] === 'attachments') await rateLimit(request,'ai-attachments',20,user.id);
            else await rateLimit(request,'ai-write',30,user.id);
            response = await handleAI(request,user,path.slice(1));
        } else if (path[0] === 'finance') {
            await rateLimit(request,path[1] === 'interpret' ? 'finance-interpret' : 'finance',path[1] === 'interpret' ? 30 : 120,user.id);
            response = await handleFinance(request,user,path.slice(1));
        } else if (path.join('/') === 'news' && request.method === 'GET') {
            await rateLimit(request,'news',30,user.id); response = await handleNews(request);
        }
        if (!response) throw new ApiError(404,'Rota não encontrada.');
        return response;
    } catch (error) { return errorResponse(error); }
}
export {handle as GET,handle as POST,handle as PUT,handle as PATCH,handle as DELETE};
