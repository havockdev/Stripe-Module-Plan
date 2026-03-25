/**
 * index.js
 *
 * Ponto de entrada ESM do módulo @workspace/stripe-checkout.
 *
 * Exporta a API de alto nível (objeto `apiCheckout` e funções/classes individuais)
 * para uso em projetos que usam ES Modules (import/export).
 *
 * ────────────────────────────────────────────────
 * USO BÁSICO (ESM)
 * ────────────────────────────────────────────────
 * import { apiCheckout } from '@workspace/stripe-checkout'
 *
 * const resultado = await apiCheckout.processarPagamento(link, {
 *   codigos: ['COMM-MARC-8314'],
 *   cartao: {
 *     numero: '5226 2612 0029 3012',
 *     cvv: '237',
 *     mesVencimento: '03',
 *     anoVencimento: '34'
 *   },
 *   endereco: {
 *     nome: 'NOME COMPLETO',
 *     email: 'email@example.com',
 *     pais: 'BR',
 *     rua: 'Rua Exemplo',
 *     cidade: 'Campo Grande',
 *     estado: 'MS',
 *     cep: '79042-470'
 *   }
 * })
 * console.log(resultado.status)   // 'paid' | 'cartao_recusado' | 'erro'
 * console.log(resultado.sucesso)  // true | false
 *
 * ────────────────────────────────────────────────
 * USO AVANÇADO (classe direta)
 * ────────────────────────────────────────────────
 * import { AutomacaoCheckout } from '@workspace/stripe-checkout'
 *
 * const automacao = new AutomacaoCheckout(link)
 * await automacao.inicializar()
 * await automacao.extrairDadosSessao()
 * await automacao.aplicarCupons(['COMM-MARC-8314'])
 * const idMetodo = await automacao.criarMetodoPagamento(dadosCartao, dadosEndereco)
 * const resultado = await automacao.confirmarPagamento(idMetodo)
 * await automacao.fechar()
 */

export { apiCheckout } from './objeto.js';
export { processarPagamento } from './api.js';
export { AutomacaoCheckout } from './automacao.js';
