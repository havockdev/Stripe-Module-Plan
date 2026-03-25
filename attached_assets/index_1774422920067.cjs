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
 * // Uso principal — fluxo completo em uma chamada
 * const resultado = await apiCheckout.processarPagamento(link, {
 *   codigos: ['COMM-MARC-8314'],
 *   cartao: { numero: '5226 2612 0029 3012', cvv: '237', mesVencimento: '03', anoVencimento: '34' },
 *   endereco: { nome: 'NOME', email: 'email@x.com', pais: 'BR', rua: 'Rua', cidade: 'Cidade', estado: 'MS', cep: '00000-000' }
 * })
 *
 * // Uso avançado — classe direta via require()
 * const { AutomacaoCheckout } = require('@workspace/stripe-checkout')
 * const automacao = new AutomacaoCheckout(link)
 * await automacao.inicializar()
 * await automacao.extrairDadosSessao()
 * await automacao.aplicarCupons(['COMM-MARC-8314'])
 * const idMetodo = await automacao.criarMetodoPagamento(dadosCartao, dadosEndereco)
 * const resultado = await automacao.confirmarPagamento(idMetodo)
 * await automacao.fechar()
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
 * Proxy síncrono da classe AutomacaoCheckout para uso via require().
 *
 * Permite instanciar com `new AutomacaoCheckout(link)` de forma síncrona.
 * A instância real da classe ESM é criada no primeiro método chamado e
 * mantida em cache para preservar o estado entre chamadas (navegador, cookies, etc).
 *
 * Todos os métodos retornam Promise, pois a classe ESM subjacente é assíncrona.
 */
class AutomacaoCheckout {
  /**
   * @param {string} urlCheckout - URL completa da sessão de checkout do Stripe
   */
  constructor(urlCheckout) {
    this.urlCheckout = urlCheckout;
    /** @type {Promise<Object>|null} Instância real da classe ESM (carregada sob demanda) */
    this._instanciaReal = null;
  }

  /**
   * Carrega e instancia a classe real ESM, armazenando em cache para reutilização.
   * O cache preserva todo o estado interno (navegador, cookies, dadosStripe).
   *
   * @returns {Promise<Object>} Instância real da AutomacaoCheckout ESM
   */
  async _obterInstancia() {
    if (!this._instanciaReal) {
      const modulo = await _importarModulo();
      this._instanciaReal = new modulo.AutomacaoCheckout(this.urlCheckout);
    }
    return this._instanciaReal;
  }

  /** @returns {Promise<void>} */
  async inicializar() {
    return (await this._obterInstancia()).inicializar();
  }

  /** @returns {Promise<void>} */
  async extrairDadosSessao() {
    return (await this._obterInstancia()).extrairDadosSessao();
  }

  /**
   * @param {string[]} [codigos=[]]
   * @returns {Promise<boolean>}
   */
  async aplicarCupons(codigos = []) {
    return (await this._obterInstancia()).aplicarCupons(codigos);
  }

  /**
   * @param {Object} dadosCartao
   * @param {Object} dadosEndereco
   * @returns {Promise<string>}
   */
  async criarMetodoPagamento(dadosCartao, dadosEndereco) {
    return (await this._obterInstancia()).criarMetodoPagamento(dadosCartao, dadosEndereco);
  }

  /**
   * @param {string} idMetodoPagamento
   * @returns {Promise<{sucesso: boolean, status: string, mensagem: string}>}
   */
  async confirmarPagamento(idMetodoPagamento) {
    return (await this._obterInstancia()).confirmarPagamento(idMetodoPagamento);
  }

  /** @returns {Promise<void>} */
  async fechar() {
    return (await this._obterInstancia()).fechar();
  }

  /**
   * Executa o fluxo completo (init + extrair + cupons + pagamento + confirmar).
   *
   * @param {Object} opcoes
   * @returns {Promise<{sucesso: boolean, status: string, mensagem: string}>}
   */
  async executar(opcoes = {}) {
    return (await this._obterInstancia()).executar(opcoes);
  }
}

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
   * Referência à classe proxy — use com `new`.
   */
  AutomacaoCheckout,
};

// Exportação da função de alto nível como named export
const processarPagamento = (...args) =>
  _importarModulo().then((m) => m.processarPagamento(...args));

// Exportação padrão do módulo CommonJS
module.exports = {
  apiCheckout,
  processarPagamento,
  AutomacaoCheckout,
};
