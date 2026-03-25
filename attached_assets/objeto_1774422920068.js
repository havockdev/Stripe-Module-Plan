/**
 * objeto.js
 *
 * Exporta o objeto `apiCheckout` que reúne toda a API do módulo em uma interface única.
 * Facilita o uso em bots e scripts externos que preferem importar apenas um objeto.
 *
 * Exemplo:
 *   import { apiCheckout } from '@workspace/stripe-checkout'
 *   const resultado = await apiCheckout.processarPagamento(link, opcoes)
 */

import { processarPagamento } from './api.js';
import { AutomacaoCheckout } from './automacao.js';

/**
 * Interface principal do módulo stripe-checkout.
 *
 * @namespace apiCheckout
 */
export const apiCheckout = {
  /**
   * Executa o fluxo completo de assinatura (init + extrair + cupom + pagamento + confirmar).
   * Equivalente à função `processStripePayment()` do módulo original.
   *
   * @param {string} link - URL de sessão do Stripe Checkout
   * @param {Object} opcoes - Opções do processamento (codigos, cartao, endereco)
   * @returns {Promise<{sucesso: boolean, status: string, mensagem: string}>}
   *
   * @example
   * const resultado = await apiCheckout.processarPagamento(link, {
   *   codigos: ['COMM-MARC-8314'],
   *   cartao: { numero: '5226 2612 0029 3012', cvv: '237', mesVencimento: '03', anoVencimento: '34' },
   *   endereco: { nome: 'NOME', email: 'email@x.com', pais: 'BR', rua: 'Rua', cidade: 'Cidade', estado: 'MS', cep: '00000-000' }
   * })
   */
  processarPagamento,

  /**
   * A classe de automação para uso avançado com controle manual de cada etapa.
   *
   * @example
   * const automacao = new apiCheckout.AutomacaoCheckout(link)
   * await automacao.inicializar()
   * await automacao.extrairDadosSessao()
   * await automacao.aplicarCupons(['COMM-MARC-8314'])
   * const idMetodo = await automacao.criarMetodoPagamento(dadosCartao, dadosEndereco)
   * const resultado = await automacao.confirmarPagamento(idMetodo)
   * await automacao.fechar()
   */
  AutomacaoCheckout,
};
