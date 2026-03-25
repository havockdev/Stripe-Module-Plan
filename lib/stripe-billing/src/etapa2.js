/**
 * etapa2.js
 *
 * Etapa 2 do bot Stripe Billing.
 *
 * Consulta o estado atual da sessão do portal de cobrança via API interna do Stripe.
 * Retorna informações sobre o plano atual, produtos disponíveis, itens recorrentes
 * da assinatura e configurações do portal. Não realiza nenhuma modificação.
 */

import { randomUUID } from "crypto";

/**
 * URL base da API de sessões do portal de cobrança do Stripe.
 * @type {string}
 */
const URL_BASE_ETAPA2 =
  "https://billing.stripe.com/v1/billing_portal/sessions";

/**
 * Campos a expandir na resposta do Stripe (traz dados de preços e tiers completos).
 * @type {string[]}
 */
const CAMPOS_EXPAND = [
  "configuration.features.subscription_update.portal_client_products.prices2.currency_options_list",
  "configuration.features.subscription_update.portal_client_products.prices2.tiers",
];

/**
 * Campos específicos a incluir na resposta (reduz o payload retornado pelo Stripe).
 * @type {string[]}
 */
const CAMPOS_INCLUIR = [
  "id",
  "object",
  "customer",
  "created_from",
  "livemode",
  "return_url",
  "url",
  "accent_color",
  "branding_color",
  "business_name",
  "icon",
  "logo",
  "use_logo_instead_of_icon",
  "site_key",
  "on_behalf_of",
  "application",
  "is_merchant_default_tax_behavior_set",
  "as_of",
  "country_code",
  "has_active_rate_card_subscription",
  "retention_flows_enabled",
  "refund_flows_enabled",
  "legacy_retention_features_active",
  "merchant_timezone",
  "flow.id",
  "flow.type",
  "configuration.active",
  "configuration.object",
  "configuration.id",
  "configuration.is_default",
  "configuration.livemode",
  "flow.subscription_update_confirm.subscription",
  "flow.subscription_update.subscription",
  "flow.subscription_cancel.subscription",
  "flow.cancellation_reason.subscription",
  "flow.after_completion.id",
  "flow.after_completion.type",
  "configuration.login_page.id",
  "configuration.login_page.enabled",
  "configuration.login_page.url",
  "configuration.business_profile.headline",
  "configuration.business_profile.privacy_policy_url",
  "configuration.business_profile.terms_of_service_url",
  "configuration.custom_text.id",
  "configuration.custom_text.subscription_renewal_acknowledgment",
  "configuration.custom_text.subscription_update_acknowledgment",
  "configuration.custom_text.back_link",
  "flow.after_completion.hosted_confirmation.custom_message",
  "flow.after_completion.redirect.return_url",
  "configuration.features.subscription_pause.enabled",
  "configuration.features.payment_method_update.enabled",
  "configuration.features.invoice_history.enabled",
  "configuration.features.customer_update.allowed_updates",
  "configuration.features.customer_update.enabled",
  "configuration.features.subscription_update.default_allowed_updates",
  "configuration.features.subscription_update.enabled",
  "configuration.features.subscription_update.proration_behavior",
  "configuration.features.subscription_cancel.enabled",
  "configuration.features.subscription_cancel.mode",
  "configuration.features.subscription_cancel.proration_behavior",
  "flow.subscription_update_confirm.recurring_items.id",
  "flow.subscription_update_confirm.recurring_items.price",
  "flow.subscription_update_confirm.recurring_items.quantity",
  "flow.subscription_update_confirm.recurring_items.deleted",
  "configuration.features.subscription_update.packaging.packaging_configuration",
  "flow.subscription_update_confirm.discounts.promotion_code.id",
  "flow.subscription_update_confirm.discounts.promotion_code.code",
  "configuration.features.subscription_cancel.cancellation_redirect.enabled",
  "configuration.features.subscription_cancel.cancellation_redirect.url",
  "configuration.features.subscription_cancel.cancellation_reason.enabled",
  "configuration.features.subscription_cancel.cancellation_reason.options",
  "configuration.features.subscription_update.portal_client_products.add_on",
  "configuration.features.subscription_update.portal_client_products.disable_quantities",
  "configuration.features.subscription_update.portal_client_products.min_quantity",
  "configuration.features.subscription_update.portal_client_products.max_quantity",
  "configuration.features.subscription_update.portal_client_products.product",
  "configuration.features.subscription_update.portal_client_products.managed_payments_eligible",
  "flow.subscription_update_confirm.discounts.coupon.id",
  "flow.subscription_update_confirm.discounts.coupon.name",
  "flow.subscription_update_confirm.discounts.coupon.duration",
  "flow.subscription_update_confirm.discounts.coupon.duration_in_months",
  "flow.subscription_update_confirm.discounts.coupon.amount_off",
  "flow.subscription_update_confirm.discounts.coupon.currency",
  "flow.subscription_update_confirm.discounts.coupon.currency_options",
  "flow.subscription_update_confirm.discounts.coupon.percent_off",
  "configuration.features.subscription_update.portal_client_products.prices2",
];

/**
 * Monta a URL completa da requisição da Etapa 2 com todos os query params.
 *
 * @param {string} idSessao - ID da sessão do portal (bps_...)
 * @returns {string} URL completa com expand[] e include_only[] como query string
 */
function montarUrlEtapa2(idSessao) {
  const parametros = new URLSearchParams();
  for (const campo of CAMPOS_EXPAND) {
    parametros.append("expand[]", campo);
  }
  for (const campo of CAMPOS_INCLUIR) {
    parametros.append("include_only[]", campo);
  }
  return `${URL_BASE_ETAPA2}/${idSessao}?${parametros.toString()}`;
}

/**
 * Monta os cabeçalhos HTTP para a requisição da Etapa 2.
 *
 * @param {Object} resultadoEtapa1 - Resultado retornado por executarEtapa1()
 * @param {string} idCarregamento - UUID único gerado para esta requisição
 * @returns {Object.<string, string>} Cabeçalhos prontos para o fetch
 */
function montarCabecalhosEtapa2(resultadoEtapa1, idCarregamento) {
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
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "Accept-Encoding": "gzip, deflate, br",
    Priority: "u=1, i",
    // O token CSRF é obrigatório mesmo que o Stripe informe que está "deprecated"
    "X-Stripe-Csrf-Token":
      resultadoEtapa1.tokenCsrf ?? "fake-deprecated-token",
    "X-Request-Source": `service="customer_portal"; project="customer_portal"; operation="CustomerPortalContainerRetrieveSessionStateQuery"; component="CustomerPortalContainer"; load_id="${idCarregamento}"`,
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
  if (resultadoEtapa1.urlSessao) {
    cabecalhos["Referer"] = resultadoEtapa1.urlSessao;
  }

  return cabecalhos;
}

/**
 * Extrai a lista de produtos disponíveis para mudança de plano a partir dos dados brutos.
 * Cada produto contém seus preços com valores, moeda e intervalo de cobrança.
 *
 * @param {Object} bruto - Resposta JSON bruta da API do Stripe
 * @returns {Array<{
 *   idProduto: string,
 *   desativarQuantidades: boolean,
 *   quantidadeMinima: number|null,
 *   quantidadeMaxima: number|null,
 *   precos: Array<{
 *     id: string, valor: number, valorDecimal: string, moeda: string,
 *     intervalo: string, contadorIntervalo: number,
 *     idProduto: string, nomeProduto: string, descricaoProduto: string|null
 *   }>
 * }>} Lista de produtos disponíveis
 */
function extrairProdutos(bruto) {
  const configuracao = bruto["configuration"] ?? null;
  const funcionalidades = configuracao?.["features"] ?? null;
  const atualizacaoAssinatura =
    funcionalidades?.["subscription_update"] ?? null;
  const produtosPortal =
    atualizacaoAssinatura?.["portal_client_products"] ?? null;

  if (!Array.isArray(produtosPortal)) return [];

  return produtosPortal.map((produto) => {
    const listaPrecosRaw = Array.isArray(produto["prices2"])
      ? produto["prices2"]
      : [];

    const precos = listaPrecosRaw.map((preco) => {
      const recorrente = preco["recurring"] ?? null;
      const dadosProduto = preco["product"] ?? null;
      return {
        id: preco["id"],
        valor: preco["unit_amount"] ?? 0,
        valorDecimal: preco["unit_amount_decimal"] ?? "0",
        moeda: preco["currency"] ?? "usd",
        intervalo: recorrente?.["interval"] ?? "month",
        contadorIntervalo: recorrente?.["interval_count"] ?? 1,
        idProduto: dadosProduto?.["id"] ?? String(produto["product"]),
        nomeProduto: dadosProduto?.["name"] ?? "",
        descricaoProduto: dadosProduto?.["description"] ?? null,
      };
    });

    return {
      idProduto: produto["product"],
      desativarQuantidades: Boolean(produto["disable_quantities"]),
      quantidadeMinima: produto["min_quantity"] ?? null,
      quantidadeMaxima: produto["max_quantity"] ?? null,
      precos,
    };
  });
}

/**
 * Extrai as configurações do portal (funcionalidades habilitadas) dos dados brutos.
 *
 * @param {Object} bruto - Resposta JSON bruta da API do Stripe
 * @returns {Object|null} Configurações do portal, ou null se não disponível
 */
function extrairConfiguracao(bruto) {
  const config = bruto["configuration"] ?? null;
  if (!config) return null;

  const func = config["features"] ?? null;
  if (!func) return null;

  const cancelamento = func["subscription_cancel"] ?? null;
  const motivoCancelamento = cancelamento?.["cancellation_reason"] ?? null;
  const pausa = func["subscription_pause"] ?? null;
  const atualizacao = func["subscription_update"] ?? null;
  const historicoFaturas = func["invoice_history"] ?? null;
  const atualizacaoMetodoPagamento = func["payment_method_update"] ?? null;
  const atualizacaoCliente = func["customer_update"] ?? null;

  return {
    id: config["id"],
    padrao: Boolean(config["is_default"]),
    modoProducao: Boolean(config["livemode"]),
    funcionalidades: {
      cancelamentoAssinatura: {
        habilitado: Boolean(cancelamento?.["enabled"]),
        modo: cancelamento?.["mode"] ?? null,
        comportamentoProrata: cancelamento?.["proration_behavior"] ?? null,
        motivoCancelamento: {
          habilitado: Boolean(motivoCancelamento?.["enabled"]),
          opcoes: motivoCancelamento?.["options"] ?? [],
        },
      },
      pausaAssinatura: {
        habilitado: Boolean(pausa?.["enabled"]),
      },
      atualizacaoAssinatura: {
        habilitado: Boolean(atualizacao?.["enabled"]),
        atualizacoesPermitidasPadrao:
          atualizacao?.["default_allowed_updates"] ?? [],
        comportamentoProrata:
          atualizacao?.["proration_behavior"] ?? null,
      },
      historicoFaturas: { habilitado: Boolean(historicoFaturas?.["enabled"]) },
      atualizacaoMetodoPagamento: {
        habilitado: Boolean(atualizacaoMetodoPagamento?.["enabled"]),
      },
      atualizacaoCliente: {
        habilitado: Boolean(atualizacaoCliente?.["enabled"]),
        atualizacoesPermitidas:
          atualizacaoCliente?.["allowed_updates"] ?? [],
      },
    },
  };
}

/**
 * Extrai os dados do fluxo ativo da sessão (subscription_update_confirm, etc).
 * O fluxo indica o tipo de operação em curso e a assinatura alvo.
 *
 * @param {Object} bruto - Resposta JSON bruta da API do Stripe
 * @returns {{
 *   tipo: string|null,
 *   idAssinatura: string|null,
 *   idPrecoAtual: string|null,
 *   itensRecorrentes: Array<{id:string, preco:string, quantidade:number|null, deletado:boolean|null}>,
 *   descontos: Array|null,
 *   urlRetornoRedirecionamento: string|null
 * }}
 */
function extrairFluxo(bruto) {
  const fluxo = bruto["flow"] ?? null;

  if (!fluxo) {
    return {
      tipo: null,
      idAssinatura: null,
      idPrecoAtual: null,
      itensRecorrentes: [],
      descontos: null,
      urlRetornoRedirecionamento: null,
    };
  }

  const tipoFluxo = fluxo["type"] ?? null;

  // Tenta extrair o ID da assinatura a partir de diferentes tipos de fluxo
  const confirmacaoAtualizacao =
    fluxo["subscription_update_confirm"] ?? null;
  const atualizacaoSimples = fluxo["subscription_update"] ?? null;
  const cancelamento = fluxo["subscription_cancel"] ?? null;

  const idAssinatura =
    confirmacaoAtualizacao?.["subscription"] ??
    atualizacaoSimples?.["subscription"] ??
    cancelamento?.["subscription"] ??
    null;

  // Itens recorrentes: contém o price ID alvo (plano para o qual vai mudar)
  const itensRecorrentesRaw = confirmacaoAtualizacao?.["recurring_items"];
  const itensRecorrentes = Array.isArray(itensRecorrentesRaw)
    ? itensRecorrentesRaw.map((item) => ({
        id: item["id"],
        preco: item["price"],
        quantidade: item["quantity"] ?? null,
        deletado: item["deleted"] ?? null,
      }))
    : [];

  // O preço atual é o primeiro item recorrente (= plano alvo na tela de confirmação)
  const idPrecoAtual =
    itensRecorrentes.length > 0 ? itensRecorrentes[0].preco : null;

  const descontos = confirmacaoAtualizacao?.["discounts"] ?? null;

  // URL de retorno após conclusão do fluxo
  const aposCompletar = fluxo["after_completion"] ?? null;
  const redirecionamento = aposCompletar?.["redirect"] ?? null;
  const urlRetornoRedirecionamento =
    redirecionamento?.["return_url"] ?? null;

  return {
    tipo: tipoFluxo,
    idAssinatura,
    idPrecoAtual,
    itensRecorrentes,
    descontos: Array.isArray(descontos) ? descontos : null,
    urlRetornoRedirecionamento,
  };
}

/**
 * Executa a Etapa 2: lê o estado atual da sessão do portal de cobrança do Stripe.
 *
 * Faz uma requisição GET autenticada à API interna do Stripe e retorna o estado
 * completo da sessão: plano atual, produtos disponíveis, configurações do portal,
 * dados de identidade visual e informações do fluxo ativo.
 *
 * Não realiza nenhuma modificação na assinatura.
 *
 * @param {Object} resultadoEtapa1 - Resultado retornado por executarEtapa1()
 * @returns {Promise<{
 *   idSessao: string|null,
 *   idCliente: string|null,
 *   modoProducao: boolean|null,
 *   codigoPais: string|null,
 *   urlRetorno: string|null,
 *   urlSessao: string|null,
 *   fluxo: Object,
 *   produtosDisponiveis: Array,
 *   configuracao: Object|null,
 *   identidadeVisual: Object,
 *   bruto: Object
 * }>} Estado completo da sessão
 * @throws {Error} Se idSessao ou autorizacao estiverem ausentes no resultado da Etapa 1
 * @throws {Error} Se a requisição HTTP falhar
 */
export async function executarEtapa2(resultadoEtapa1) {
  if (!resultadoEtapa1.idSessao) {
    throw new Error(
      "Resultado da Etapa 1 não contém idSessao. Verifique o link fornecido.",
    );
  }
  if (!resultadoEtapa1.autorizacao) {
    throw new Error(
      "Resultado da Etapa 1 não contém token de autorização. Verifique o link fornecido.",
    );
  }

  const idCarregamento = randomUUID();
  const url = montarUrlEtapa2(resultadoEtapa1.idSessao);
  const cabecalhos = montarCabecalhosEtapa2(resultadoEtapa1, idCarregamento);

  const resposta = await fetch(url, {
    method: "GET",
    headers: cabecalhos,
  });

  if (!resposta.ok) {
    const corpoErro = await resposta.text().catch(() => "");
    throw new Error(
      `Etapa 2 falhou: ${resposta.status} ${resposta.statusText} — ${corpoErro.slice(0, 300)}`,
    );
  }

  const bruto = await resposta.json();

  // Dados de identidade visual do portal (cores, logo, nome da empresa)
  const identidadeVisual = {
    corDestaque: bruto["accent_color"] ?? null,
    corMarca: bruto["branding_color"] ?? null,
    nomeEmpresa: bruto["business_name"] ?? null,
    icone: bruto["icon"] ?? null,
    logo: bruto["logo"] ?? null,
    usarLogoEmVezDeIcone: Boolean(bruto["use_logo_instead_of_icon"]),
  };

  return {
    idSessao: bruto["id"] ?? null,
    idCliente: bruto["customer"] ?? null,
    modoProducao:
      typeof bruto["livemode"] === "boolean" ? bruto["livemode"] : null,
    codigoPais: bruto["country_code"] ?? null,
    urlRetorno: bruto["return_url"] ?? null,
    urlSessao: bruto["url"] ?? null,
    fluxo: extrairFluxo(bruto),
    produtosDisponiveis: extrairProdutos(bruto),
    configuracao: extrairConfiguracao(bruto),
    identidadeVisual,
    bruto,
  };
}
