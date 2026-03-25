/**
 * etapa1.js
 *
 * Etapa 1 do bot Stripe Billing.
 *
 * Acessa o link do portal de cobrança do Stripe como um navegador,
 * analisa o HTML da página e extrai todos os tokens e identificadores
 * necessários para as etapas seguintes (autenticação, CSRF, ID de sessão, etc).
 */

import { parse as analisarHtml } from "node-html-parser";
import { CABECALHOS_NAVEGADOR_ETAPA1 } from "./cabecalhos.js";

/**
 * Decodifica entidades HTML simples presentes nos blocos de JSON embutidos no HTML.
 *
 * @param {string} texto - Texto com possíveis entidades HTML
 * @returns {string} Texto decodificado
 */
function decodificarEntidadesHtml(texto) {
  return texto
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
}

/**
 * Extrai e parseia o conteúdo JSON de um elemento <script> no HTML pelo seu ID.
 *
 * @param {import("node-html-parser").HTMLElement} html - Árvore HTML já parseada
 * @param {string} id - ID do elemento script a ser buscado
 * @returns {Object|null} Objeto JSON parseado, ou null se não encontrado/inválido
 */
function extrairJsonDoScript(html, id) {
  const elemento = html.querySelector(`#${id}`);
  if (!elemento) return null;
  try {
    const textoBruto = decodificarEntidadesHtml(elemento.rawText);
    return JSON.parse(textoBruto);
  } catch {
    return null;
  }
}

/**
 * Tenta extrair o ID de sessão do Stripe (bps_... ou live_/test_...) a partir de uma URL.
 *
 * @param {string} url - URL a ser analisada
 * @returns {string|null} ID da sessão, ou null se não encontrado
 */
function extrairIdSessaoDaUrl(url) {
  const correspondenciaPortal =
    /\/p\/session\/((?:live|test)_[A-Za-z0-9_-]+)/.exec(url);
  if (correspondenciaPortal) return correspondenciaPortal[1];

  const correspondenciaBps =
    /\/billing_portal\/sessions\/(bps_[A-Za-z0-9]+)/.exec(url);
  if (correspondenciaBps) return correspondenciaBps[1];

  return null;
}

/**
 * Varre o HTML em texto puro buscando um ID no formato bps_....
 * Usado como fallback caso o ID de sessão não seja encontrado no JSON embutido.
 *
 * @param {string} htmlTexto - HTML bruto em formato string
 * @returns {string|null} ID bps_ encontrado, ou null
 */
function buscarIdBpsNoHtml(htmlTexto) {
  const correspondencia = /bps_[A-Za-z0-9]+/.exec(htmlTexto);
  return correspondencia ? correspondencia[0] : null;
}

/**
 * Executa a Etapa 1: acessa o link do portal do Stripe e extrai todos os tokens.
 *
 * Faz uma requisição GET simulando um navegador real, analisa o HTML retornado
 * e extrai os dados necessários para autenticar as chamadas às APIs internas do Stripe:
 * - Token de autorização (Bearer)
 * - ID da conta Stripe
 * - Token CSRF
 * - Versão do cliente e da API
 * - ID e URL da sessão
 * - Modo de produção (livemode)
 *
 * @param {string} link - URL completa do portal de cobrança do Stripe
 *   Exemplo: https://billing.stripe.com/p/session/live_xxx/flow
 * @returns {Promise<{
 *   autorizacao: string|null,
 *   contaStripe: string|null,
 *   revisaoCliente: string|null,
 *   versaoStripe: string|null,
 *   tokenCsrf: string|null,
 *   idSessao: string|null,
 *   urlSessao: string|null,
 *   modoProducao: boolean|null,
 *   bruto: { preCarregadoMinimo: Object|null, preCarregado: Object|null }
 * }>} Resultado da Etapa 1 com todos os tokens extraídos
 * @throws {Error} Se a requisição HTTP falhar (status não-2xx)
 */
export async function executarEtapa1(link) {
  const resposta = await fetch(link, {
    method: "GET",
    headers: CABECALHOS_NAVEGADOR_ETAPA1,
    redirect: "follow",
  });

  if (!resposta.ok) {
    throw new Error(
      `Etapa 1 falhou: ${resposta.status} ${resposta.statusText}`,
    );
  }

  const htmlTexto = await resposta.text();
  const html = analisarHtml(htmlTexto);

  // Os dados do portal ficam em dois blocos JSON embutidos no HTML:
  // - tiny_preloaded_json: dados mínimos (CSRF, versão do cliente)
  // - preloaded_json: dados completos (chave da sessão, conta, livemode)
  const preCarregadoMinimo = extrairJsonDoScript(html, "tiny_preloaded_json");
  const preCarregado = extrairJsonDoScript(html, "preloaded_json");

  // Token CSRF para proteger requisições POST
  const tokenCsrf = preCarregadoMinimo?.csrf_token ?? null;

  // Revisão do cliente (hash do bundle JS) — obrigatório no cabeçalho X-Stripe-Manage-Client-Revision
  const revisaoCliente = preCarregadoMinimo?.current_head ?? null;

  // Versão da API do Stripe
  const versaoStripe =
    preCarregadoMinimo?.current_version ??
    preCarregado?.current_version ??
    null;

  // ID da conta Stripe do merchant (acct_...)
  const comerciante = preCarregado?.merchant ?? null;
  const contaStripe =
    comerciante?.id ?? preCarregado?.account_id ?? null;

  // Chave de API da sessão (usada como Bearer token em todas as chamadas seguintes)
  const chaveApi = preCarregado?.session_api_key ?? null;

  // Indica se é ambiente de produção (true) ou teste (false)
  const modoProducao =
    typeof preCarregado?.livemode === "boolean"
      ? preCarregado.livemode
      : null;

  // URL final após redirecionamentos (pode ser diferente do link original)
  const urlFinal = resposta.url || link;

  // ID da sessão do billing portal (bps_...)
  const idSessaoBps =
    preCarregado?.portal_session_id ?? buscarIdBpsNoHtml(htmlTexto);
  const idSessao =
    idSessaoBps ??
    extrairIdSessaoDaUrl(urlFinal) ??
    extrairIdSessaoDaUrl(link);

  return {
    autorizacao: chaveApi ? `Bearer ${chaveApi}` : null,
    contaStripe,
    revisaoCliente,
    versaoStripe,
    tokenCsrf,
    idSessao,
    urlSessao: urlFinal,
    modoProducao,
    bruto: {
      preCarregadoMinimo,
      preCarregado,
    },
  };
}
