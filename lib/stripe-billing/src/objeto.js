/**
 * objeto.js
 *
 * Exporta o objeto `apiStripe` que reúne toda a API do módulo em uma interface única.
 * Facilita o uso em bots e scripts externos que preferem importar apenas um objeto.
 *
 * Exemplo:
 *   import { apiStripe } from '@workspace/stripe-billing'
 *   const resultado = await apiStripe.mudarPlano(link)
 */

import { mudarPlano, lerSessao } from "./api.js";
import { executarEtapa1 } from "./etapa1.js";
import { executarEtapa2 } from "./etapa2.js";
import { executarEtapa3 } from "./etapa3.js";

/**
 * Interface principal do módulo stripe-billing.
 *
 * @namespace apiStripe
 */
export const apiStripe = {
  /**
   * Executa a troca completa de plano (Etapas 1 + 2 + 3).
   * Auto-detecta o price ID alvo se não informado.
   *
   * @param {string} link - URL de sessão do Stripe Billing Portal
   * @param {string} [idPrecoAlvo] - Price ID do plano destino (opcional)
   * @returns {Promise<{ etapa1, etapa2, etapa3, precoAlvo, autoDetectado }>}
   */
  mudarPlano,

  /**
   * Lê o estado da sessão sem modificar nada (Etapas 1 + 2).
   *
   * @param {string} link - URL de sessão do Stripe Billing Portal
   * @returns {Promise<{ etapa1, etapa2 }>}
   */
  lerSessao,

  /**
   * Acessa o link do portal e extrai os tokens de autenticação (Etapa 1).
   *
   * @param {string} link - URL de sessão do Stripe Billing Portal
   * @returns {Promise<Object>} Resultado da Etapa 1
   */
  etapa1: executarEtapa1,

  /**
   * Lê o estado da sessão via GET na API interna do Stripe (Etapa 2).
   *
   * @param {Object} resultadoEtapa1 - Resultado de apiStripe.etapa1()
   * @returns {Promise<Object>} Resultado da Etapa 2
   */
  etapa2: executarEtapa2,

  /**
   * Confirma a troca de plano via POST na API interna do Stripe (Etapa 3).
   *
   * @param {Object} resultadoEtapa1 - Resultado de apiStripe.etapa1()
   * @param {Object} resultadoEtapa2 - Resultado de apiStripe.etapa2()
   * @param {string} idPrecoAlvo - Price ID do plano destino
   * @returns {Promise<Object>} Resultado da Etapa 3
   */
  etapa3: executarEtapa3,
};
