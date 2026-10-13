import { logout, verifyCSRF } from '../../server/auth';
import { boundedRequest, errorResponse } from '../../server/http';
export const runtime = 'nodejs';
export async function POST(original: Request) {
    try { const request = await boundedRequest(original,16384); await verifyCSRF(request); return await logout(request); }
    catch (error) { return errorResponse(error); }
}
