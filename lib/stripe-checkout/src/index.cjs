'use strict';

/**
 * index.cjs
 *
 * Ponto de entrada CommonJS do módulo @workspace/stripe-checkout.
 * Permite uso via require() em projetos Node.js que não usam ESM.
 *
 * Como as funções são assíncronas (retornam Promise),
 * o comportamento é idêntico ao uso ESM — os métodos ainda precisam de await.
 * A diferença é apenas na forma de importar o módulo.
 *
 * ────────────────────────────────────────────────
 * USO VIA require() (CommonJS)
 * ────────────────────────────────────────────────
 * const { apiCheckout } = require('@workspace/stripe-checkout')
 *
 * const resultado = await apiCheckout.processarPagamento(link, {
 *   codigos: ['COMM-MARC-8314'],
 *   cartao: { numero: '5226 2612 0029 3012', cvv: '237', mesVencimento: '03', anoVencimento: '34' },
 *   endereco: { nome: 'NOME', email: 'email@x.com', pais: 'BR', rua: 'Rua', cidade: 'Cidade', estado: 'MS', cep: '00000-000' }
 * })
 *
 * OU com desestruturação das exportações individuais:
 * const { processarPagamento, AutomacaoCheckout } = require('@workspace/stripe-checkout')
 */

// Cache do módulo ESM para evitar re-importação a cada chamada
let _moduloCacheado;

/**
 * Importa o módulo ESM principal e armazena em cache.
 * Garante que a importação dinâmica ocorra apenas uma vez.
 *
 * @returns {Promise<Object>} Módulo ESM carregado
 */
const _importarModulo = () => {
  if (!_moduloCacheado) {
    _moduloCacheado = import('./index.js');
  }
  return _moduloCacheado;
};

/**
 * Objeto principal com todos os métodos do stripe-checkout.
 * Idêntico ao `apiCheckout` exportado via ESM.
 */
const apiCheckout = {
  /**
   * Executa o fluxo completo de assinatura (init + extrair + cupom + pagamento + confirmar).
   *
   * @param {string} link - URL de sessão do Stripe Checkout
   * @param {Object} opcoes - Opções do processamento (codigos, cartao, endereco)
   * @returns {Promise<{sucesso: boolean, status: string, mensagem: string}>}
   */
  processarPagamento: (...args) =>
    _importarModulo().then((m) => m.processarPagamento(...args)),

  /**
   * Classe de automação para uso avançado com controle manual de cada etapa.
   * Retorna a classe construtora — use com `new`.
   *
   * Como `require()` é síncrono, a classe é acessada via Promise:
   *   const { AutomacaoCheckout } = await apiCheckout.obterClasse()
   *
   * Ou diretamente:
   *   const { AutomacaoCheckout } = require('@workspace/stripe-checkout')
   */
  obterClasse: () => _importarModulo().then((m) => m.AutomacaoCheckout),
};

// Exportação da função de alto nível como named export
const processarPagamento = (...args) =>
  _importarModulo().then((m) => m.processarPagamento(...args));

// Exportação da classe construtora (retorna a classe via Promise)
const obterAutomacaoCheckout = () =>
  _importarModulo().then((m) => m.AutomacaoCheckout);

// Exportação padrão do módulo CommonJS
module.exports = {
  apiCheckout,
  processarPagamento,
  AutomacaoCheckout: obterAutomacaoCheckout,
};
