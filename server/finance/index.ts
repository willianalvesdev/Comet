import { availableProviders, structuredFinancial } from '../ai';
import { ApiError, json, readJson } from '../http';
import { chartOverview, executeActions, history, receive } from './repository';
import { prepareInterpretation, requestData, SCHEMA, SYSTEM, validateInterpretation } from './interpretation';

export async function handleFinance(request: Request, user: { id: number; nome: string; email: string }, segments: string[]): Promise<Response | null> {
  if (segments.length !== 1) return null;
  const [route] = segments, method = request.method;
  if (!['chart', 'transactions', 'interpret', 'actions'].includes(route)) return null;
  if (method === 'GET' && route === 'chart') return json(await chartOverview(user.id, new URL(request.url).searchParams));
  if (method === 'GET' && route === 'transactions') {
    const args = new URL(request.url).searchParams, rawLimit = args.get('limit') ?? '30';
    const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
    return json(await history(user.id, limit, args.get('before'), args.get('state') ?? 'active'));
  }
  if (method === 'POST' && route === 'transactions') {
    const result = await receive(user.id, await readJson(request));
    return json(result, result.created ? 201 : 200);
  }
  if (method === 'POST' && route === 'actions') return json(await executeActions(user.id, await readJson(request)));
  if (method === 'POST' && route === 'interpret') {
    const payload = await readJson(request);
    requestData(payload, typeof payload.provider === 'string' ? [payload.provider] : []);
    const providers = await availableProviders();
    const { provider, data, context } = await prepareInterpretation(user.id, payload, providers);
    const interpretation = validateInterpretation(await structuredFinancial(user.id, provider, SYSTEM, data, SCHEMA));
    return json({ interpretation, context });
  }
  throw new ApiError(405, 'Método não permitido.');
}
