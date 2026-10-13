import nodemailer from 'nodemailer';
import validator from 'validator';
import { ApiError } from './http';

export function emailTransport() {
    const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM } = process.env;
    const port = Number(process.env.SMTP_PORT || 587);
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !EMAIL_FROM ||
        !validator.isEmail(EMAIL_FROM) || !Number.isInteger(port) || port < 1 || port > 65535)
        throw new ApiError(503,'O acesso por e-mail ainda não foi configurado.');
    return nodemailer.createTransport({
        host:SMTP_HOST, port, secure:port === 465, requireTLS:true,
        auth:{user:SMTP_USER,pass:SMTP_PASSWORD},
        tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},
        connectionTimeout:10000, greetingTimeout:10000, socketTimeout:15000,
        disableFileAccess:true, disableUrlAccess:true, logger:false, debug:false,
    });
}
export async function sendLoginCode(email: string, code: string) {
    const transport = emailTransport();
    try {
        const result = await transport.sendMail({
            from:{name:'Comet',address:process.env.EMAIL_FROM!}, to:email,
            subject:'Seu código de acesso ao Comet',
            text:`Seu código de acesso ao Comet é: ${code}\n\nEle expira em 10 minutos e só pode ser usado uma vez. Não compartilhe este código.\nSe você não solicitou o acesso, ignore esta mensagem.`,
        });
        if (!result.accepted?.length) throw new Error('not_accepted');
    } catch {
        throw new ApiError(503,'Não foi possível enviar o código. Tente novamente em instantes.');
    } finally { transport.close(); }
}
