'use strict';

/**
 * index.cjs
 *
 * Ponto de entrada CommonJS do módulo @workspace/stripe-billing.
 * Permite uso via require() em projetos Node.js que não usam ESM.
 *
 * Como as funções de cada etapa são assíncronas (retornam Promise),
 * o comportamento é idêntico ao uso ESM — os métodos ainda precisam de await.
 * A diferença é apenas na forma de importar o módulo.
 *
 * ────────────────────────────────────────────────
 * USO VIA require() (CommonJS)
 * ────────────────────────────────────────────────
 * const { apiStripe } = require('@workspace/stripe-billing')
 *
 * const resultado = await apiStripe.mudarPlano(link)
 * const sessao = await apiStripe.lerSessao(link)
 *
 * OU com desestruturação das funções individuais:
 * const { mudarPlano, executarEtapa1 } = require('@workspace/stripe-billing')
 * const resultado = await mudarPlano(link)
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
 * Objeto principal com todos os métodos do stripe-billing.
 * Idêntico ao `apiStripe` exportado via ESM.
 */
const apiStripe = {
  /**
   * Executa a troca completa de plano (Etapas 1 + 2 + 3).
   * Auto-detecta o price ID alvo se não informado.
   *
   * @param {string} link - URL de sessão do Stripe Billing Portal
   * @param {string} [idPrecoAlvo] - Price ID do plano destino (opcional)
   * @returns {Promise<{ etapa1, etapa2, etapa3, precoAlvo, autoDetectado }>}
   */
  mudarPlano: (...args) =>
    _importarModulo().then((m) => m.mudarPlano(...args)),

  /**
   * Lê o estado da sessão sem modificar nada (Etapas 1 + 2).
   *
   * @param {string} link - URL de sessão do Stripe Billing Portal
   * @returns {Promise<{ etapa1, etapa2 }>}
   */
  lerSessao: (...args) =>
    _importarModulo().then((m) => m.lerSessao(...args)),

  /**
   * Acessa o link do portal e extrai tokens de autenticação (Etapa 1).
   *
   * @param {string} link - URL de sessão do Stripe Billing Portal
   * @returns {Promise<Object>}
   */
  etapa1: (...args) =>
    _importarModulo().then((m) => m.executarEtapa1(...args)),

  /**
   * Lê o estado da sessão via GET na API interna do Stripe (Etapa 2).
   *
   * @param {Object} resultadoEtapa1 - Resultado de etapa1()
   * @returns {Promise<Object>}
   */
  etapa2: (...args) =>
    _importarModulo().then((m) => m.executarEtapa2(...args)),

  /**
   * Confirma a troca de plano via POST na API interna do Stripe (Etapa 3).
   *
   * @param {Object} resultadoEtapa1 - Resultado de etapa1()
   * @param {Object} resultadoEtapa2 - Resultado de etapa2()
   * @param {string} idPrecoAlvo - Price ID do plano destino
   * @returns {Promise<Object>}
   */
  etapa3: (...args) =>
    _importarModulo().then((m) => m.executarEtapa3(...args)),
};

// Exportações nomeadas individuais (permite desestruturação via require)
const mudarPlano = (...args) =>
  _importarModulo().then((m) => m.mudarPlano(...args));

const lerSessao = (...args) =>
  _importarModulo().then((m) => m.lerSessao(...args));

const executarEtapa1 = (...args) =>
  _importarModulo().then((m) => m.executarEtapa1(...args));

const executarEtapa2 = (...args) =>
  _importarModulo().then((m) => m.executarEtapa2(...args));

const executarEtapa3 = (...args) =>
  _importarModulo().then((m) => m.executarEtapa3(...args));

// Exportação padrão do objeto principal
module.exports = {
  apiStripe,
  mudarPlano,
  lerSessao,
  executarEtapa1,
  executarEtapa2,
  executarEtapa3,
};
