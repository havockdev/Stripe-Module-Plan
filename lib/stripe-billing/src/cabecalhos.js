/**
 * cabecalhos.js
 *
 * Cabeçalhos HTTP padrão de navegador usados na Etapa 1.
 * Simulam uma requisição real do Chrome no Windows para o portal do Stripe.
 * Esses valores foram capturados via Burp Suite e devem ser mantidos fiéis ao original.
 */

/**
 * Cabeçalhos de navegador para a requisição GET inicial do portal do Stripe.
 * Usados na Etapa 1 ao acessar o link de sessão.
 *
 * @type {Object.<string, string>}
 */
export const CABECALHOS_NAVEGADOR_ETAPA1 = {
  "Sec-Ch-Ua": '"Chromium";v="145", "Not:A-Brand";v="99"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Accept-Language": "pt-BR,pt;q=0.9",
  "Upgrade-Insecure-Requests": "1",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-User": "?1",
  "Sec-Fetch-Dest": "document",
  "Accept-Encoding": "gzip, deflate, br",
  Priority: "u=0, i",
  Connection: "keep-alive",
};
