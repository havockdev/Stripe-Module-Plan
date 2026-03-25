/**
 * etapa3.js
 *
 * Etapa 3 do bot Stripe Billing.
 *
 * Confirma a troca de plano via POST na API interna do Stripe.
 * Usa os dados da Etapa 1 (tokens de autenticação) e da Etapa 2
 * (ID da sessão, ID da assinatura, item recorrente) para montar
 * a requisição de atualização.
 *
 * Esta é a etapa que efetivamente muda o plano do cliente.
 */

import { randomUUID } from "crypto";

/**
 * URL base da API de sessões do portal de cobrança do Stripe.
 * @type {string}
 */
const URL_BASE_ETAPA3 =
  "https://billing.stripe.com/v1/billing_portal/sessions";

/**
 * Campos a expandir na resposta do Stripe para a Etapa 3.
 * Traz dados completos do método de pagamento padrão.
 * @type {string[]}
 */
const CAMPOS_EXPAND = ["default_payment_method", "default_source"];

/**
 * Campos específicos a incluir na resposta da Etapa 3.
 * Limitamos ao necessário para reduzir o payload.
 * @type {string[]}
 */
const CAMPOS_INCLUIR = [
  "id",
  "status",
  "latest_invoice.id",
  "latest_invoice.status",
  "latest_invoice.payment_intent.id",
  "latest_invoice.payment_intent.status",
  "latest_invoice.payment_intent.client_secret",
  "latest_invoice.payment_intent.next_action.boleto_display_details.expires_at",
  "latest_invoice.payment_intent.next_action.boleto_display_details.hosted_voucher_url",
  "latest_invoice.payment_intent.next_action.boleto_display_details.number",
  "latest_invoice.payment_intent.next_action.boleto_display_details.pdf",
  "latest_invoice.payment_intent.next_action.type",
  "pending_update.subscription_items.id",
  "default_payment_method.id",
  "default_payment_method.card.exp_month",
  "default_payment_method.card.exp_year",
  "default_payment_method.card.funding",
  "default_payment_method.card.wallet.type",
  "default_source.id",
  "default_source.exp_year",
  "default_source.exp_month",
  "default_source.funding",
  "default_source.wallet.type",
  "default_source.object",
  "default_source.card.exp_year",
  "default_source.card.exp_month",
  "default_source.type",
  "default_payment_method.acss_debit.bank_name",
  "default_payment_method.acss_debit.last4",
  "default_payment_method.au_becs_debit.last4",
  "default_payment_method.bacs_debit.last4",
  "default_payment_method.boleto.tax_id",
  "default_payment_method.crypto.last4",
  "default_payment_method.crypto.network",
  "default_payment_method.crypto.token_currency",
  "default_payment_method.crypto.wallet_address",
  "default_payment_method.card.brand",
  "default_payment_method.card.last4",
  "default_payment_method.card.networks.available",
  "default_payment_method.nz_bank_account.bank_name",
  "default_payment_method.nz_bank_account.last4",
  "default_payment_method.object",
  "default_payment_method.sepa_debit.last4",
  "default_payment_method.type",
  "default_payment_method.us_bank_account.bank_name",
  "default_payment_method.us_bank_account.last4",
  "default_payment_method.custom.type",
  "default_payment_method.custom.display_name",
  "default_payment_method.custom.logo_url",
  "default_source.status",
  "default_source.ach_credit_transfer.bank_name",
  "default_source.ach_credit_transfer.account_number",
  "default_source.ach_debit.bank_name",
  "default_source.ach_debit.last4",
  "default_source.acss_debit.bank_name",
  "default_source.acss_debit.last4",
  "default_source.bacs_debit.last4",
  "default_source.au_becs_debit.last4",
  "default_source.bitcoin.address",
  "default_source.card.brand",
  "default_source.card.dynamic_last4",
  "default_source.card.last4",
  "default_source.card_present.brand",
  "default_source.card_present.last4",
  "default_source.ideal.iban_last4",
  "default_source.interac_present.last4",
  "default_source.sepa_debit.last4",
  "default_source.sofort.iban_last4",
  "default_source.brand",
  "default_source.last4",
  "default_source.bank_name",
];

/**
 * Monta a URL do POST da Etapa 3.
 *
 * @param {string} idSessao - ID da sessão do portal (bps_...)
 * @param {string} idAssinatura - ID da assinatura (sub_...)
 * @returns {string} URL completa com query params
 */
function montarUrlEtapa3(idSessao, idAssinatura) {
  const parametros = new URLSearchParams();
  for (const campo of CAMPOS_EXPAND) {
    parametros.append("expand[]", campo);
  }
  for (const campo of CAMPOS_INCLUIR) {
    parametros.append("include_only[]", campo);
  }
  return `${URL_BASE_ETAPA3}/${idSessao}/subscriptions/${idAssinatura}?${parametros.toString()}`;
}

/**
 * Monta a URL de Referer para o cabeçalho da Etapa 3.
 * Simula o navegador vindo da tela de preview de preço.
 *
 * @param {string|null} urlSessao - URL da sessão obtida na Etapa 1
 * @param {string} idAssinatura - ID da assinatura
 * @param {string} idPrecoAlvo - ID do preço alvo da troca
 * @returns {string} URL de Referer
 */
function montarReferer(urlSessao, idAssinatura, idPrecoAlvo) {
  if (!urlSessao) {
    return `https://billing.stripe.com/subscriptions/${idAssinatura}/preview/${idPrecoAlvo}?in_flow=true&quantity=1`;
  }
  // Remove sufixos como /flow e barras finais
  const urlBase = urlSessao.replace(/\/flow$/, "").replace(/\/+$/, "");
  return `${urlBase}/subscriptions/${idAssinatura}/preview/${idPrecoAlvo}?in_flow=true&quantity=1`;
}

/**
 * Monta o corpo (body) da requisição POST da Etapa 3 em formato URL-encoded.
 * Informa qual item recorrente (assinatura) deve ser atualizado para qual preço.
 *
 * @param {string} idItemRecorrente - ID do item recorrente atual (si_...)
 * @param {number} quantidade - Quantidade do item (geralmente 1)
 * @param {string} idPrecoAlvo - Price ID do novo plano
 * @returns {string} Corpo da requisição em formato application/x-www-form-urlencoded
 */
function montarCorpoDaRequisicao(idItemRecorrente, quantidade, idPrecoAlvo) {
  const parametros = new URLSearchParams();
  parametros.append("recurring_items[0][id]", idItemRecorrente);
  parametros.append("recurring_items[0][quantity]", String(quantidade));
  parametros.append("recurring_items[0][price]", idPrecoAlvo);
  return parametros.toString();
}

/**
 * Monta os cabeçalhos HTTP para o POST da Etapa 3.
 *
 * @param {Object} resultadoEtapa1 - Resultado da Etapa 1 (tokens de autenticação)
 * @param {string} idCarregamento - UUID único para esta requisição
 * @param {string} referer - URL de Referer construída por montarReferer()
 * @returns {Object.<string, string>} Cabeçalhos prontos para o fetch
 */
function montarCabecalhosEtapa3(resultadoEtapa1, idCarregamento, referer) {
  const cabecalhos = {
    Host: "billing.stripe.com",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Ch-Ua": '"Chromium";v="145", "Not:A-Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "X-Requested-With": "XMLHttpRequest",
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
    "Accept-Language": "pt-BR",
    "Browser-Language": "pt-BR",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    Origin: "https://billing.stripe.com",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "Accept-Encoding": "gzip, deflate, br",
    Priority: "u=1, i",
    Referer: referer,
    // O CSRF vem sempre da Etapa 1 — a Etapa 2 não expõe este token
    "X-Stripe-Csrf-Token":
      resultadoEtapa1.tokenCsrf ?? "fake-deprecated-token",
    "X-Request-Source": `service="customer_portal"; project="customer_portal"; operation="PreviewPageBodyUpdateSubscriptionStateMutation"; component="PreviewPageBody"; load_id="${idCarregamento}"`,
  };

  if (resultadoEtapa1.autorizacao) {
    cabecalhos["Authorization"] = resultadoEtapa1.autorizacao;
  }
  if (resultadoEtapa1.contaStripe) {
    cabecalhos["Stripe-Account"] = resultadoEtapa1.contaStripe;
  }
  if (resultadoEtapa1.revisaoCliente) {
    cabecalhos["X-Stripe-Manage-Client-Revision"] =
      resultadoEtapa1.revisaoCliente;
  }
  if (resultadoEtapa1.versaoStripe) {
    cabecalhos["Stripe-Version"] = resultadoEtapa1.versaoStripe;
  }
  if (resultadoEtapa1.modoProducao !== null) {
    cabecalhos["Stripe-Livemode"] = String(resultadoEtapa1.modoProducao);
  }

  return cabecalhos;
}

/**
 * Extrai e estrutura os dados do método de pagamento padrão da resposta bruta.
 *
 * @param {Object} bruto - Resposta JSON bruta do Stripe
 * @returns {Object|null} Dados do método de pagamento, ou null se ausente
 */
function extrairMetodoPagamento(bruto) {
  const metodoPagamento = bruto["default_payment_method"] ?? null;
  if (!metodoPagamento) return null;

  const cartao = metodoPagamento["card"] ?? null;
  const redes = cartao?.["networks"] ?? null;

  return {
    id: metodoPagamento["id"] ?? null,
    tipo: metodoPagamento["type"] ?? null,
    bandeira: cartao?.["brand"] ?? null,
    ultimos4: cartao?.["last4"] ?? null,
    mesVencimento: cartao?.["exp_month"] ?? null,
    anoVencimento: cartao?.["exp_year"] ?? null,
    financiamento: cartao?.["funding"] ?? null,
    carteira: cartao?.["wallet"]?.["type"] ?? null,
    redes: Array.isArray(redes?.["available"])
      ? redes["available"]
      : null,
  };
}

/**
 * Extrai e estrutura os dados da última fatura da resposta bruta.
 *
 * @param {Object} bruto - Resposta JSON bruta do Stripe
 * @returns {Object|null} Dados da fatura, ou null se ausente
 */
function extrairFatura(bruto) {
  const fatura = bruto["latest_invoice"] ?? null;
  if (!fatura) return null;

  const intencaoPagamento = fatura["payment_intent"] ?? null;

  return {
    id: fatura["id"] ?? null,
    status: fatura["status"] ?? null,
    idIntencaoPagamento: intencaoPagamento?.["id"] ?? null,
    statusIntencaoPagamento: intencaoPagamento?.["status"] ?? null,
    segredoClienteIntencaoPagamento:
      intencaoPagamento?.["client_secret"] ?? null,
  };
}

/**
 * Executa a Etapa 3: confirma a troca de plano via POST na API interna do Stripe.
 *
 * Esta é a etapa que efetivamente muda a assinatura do cliente.
 * Usa os dados das Etapas 1 e 2 para autenticar e identificar a assinatura,
 * e envia o ID do novo preço como o plano alvo.
 *
 * @param {Object} resultadoEtapa1 - Resultado de executarEtapa1()
 * @param {Object} resultadoEtapa2 - Resultado de executarEtapa2()
 * @param {string} idPrecoAlvo - ID do preço (price_...) do plano destino
 *   Exemplo de downgrade: 'price_1SQSE8KvR4zlUMOUgIcRNEh1' (Lite)
 *   Exemplo de upgrade:   'price_1SfJHYKvR4zlUMOUN4ABuaB4' (Pro 0 mensal)
 * @returns {Promise<{
 *   idAssinatura: string|null,
 *   status: string|null,
 *   atualizacaoPendente: any,
 *   ultimaFatura: Object|null,
 *   metodoPagamentoPadrao: Object|null,
 *   bruto: Object
 * }>} Resultado da troca de plano
 * @throws {Error} Se campos obrigatórios estiverem faltando nos resultados anteriores
 * @throws {Error} Se a requisição HTTP falhar
 */
export async function executarEtapa3(
  resultadoEtapa1,
  resultadoEtapa2,
  idPrecoAlvo,
) {
  const idSessao = resultadoEtapa2.idSessao;
  const idAssinatura = resultadoEtapa2.fluxo.idAssinatura;

  if (!idSessao) {
    throw new Error(
      "Resultado da Etapa 2 não contém idSessao.",
    );
  }
  if (!idAssinatura) {
    throw new Error(
      "Resultado da Etapa 2 não contém idAssinatura no fluxo.",
    );
  }
  if (!resultadoEtapa1.autorizacao) {
    throw new Error(
      "Resultado da Etapa 1 não contém token de autorização.",
    );
  }
  if (resultadoEtapa2.fluxo.itensRecorrentes.length === 0) {
    throw new Error(
      "Resultado da Etapa 2 não possui itens recorrentes no fluxo. Verifique se o link é de confirmação de mudança de plano.",
    );
  }

  const itemRecorrente = resultadoEtapa2.fluxo.itensRecorrentes[0];
  const quantidade = itemRecorrente.quantidade ?? 1;

  const idCarregamento = randomUUID();
  const referer = montarReferer(
    resultadoEtapa1.urlSessao,
    idAssinatura,
    idPrecoAlvo,
  );
  const url = montarUrlEtapa3(idSessao, idAssinatura);
  const corpo = montarCorpoDaRequisicao(itemRecorrente.id, quantidade, idPrecoAlvo);
  const cabecalhos = montarCabecalhosEtapa3(
    resultadoEtapa1,
    idCarregamento,
    referer,
  );

  const resposta = await fetch(url, {
    method: "POST",
    headers: cabecalhos,
    body: corpo,
  });

  if (!resposta.ok) {
    const textoErro = await resposta.text().catch(() => "");
    throw new Error(
      `Etapa 3 falhou: ${resposta.status} ${resposta.statusText} — ${textoErro.slice(0, 300)}`,
    );
  }

  const bruto = await resposta.json();

  return {
    idAssinatura: bruto["id"] ?? null,
    status: bruto["status"] ?? null,
    atualizacaoPendente: bruto["pending_update"] ?? null,
    ultimaFatura: extrairFatura(bruto),
    metodoPagamentoPadrao: extrairMetodoPagamento(bruto),
    bruto,
  };
}
