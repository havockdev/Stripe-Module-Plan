/**
 * api.js
 *
 * API de alto nível do módulo @workspace/stripe-checkout.
 *
 * Expõe a função principal `processarPagamento()` que encapsula todo o fluxo
 * de assinatura de um novo plano no Stripe Checkout em uma única chamada.
 * O navegador é sempre fechado no bloco `finally`, mesmo em caso de erro.
 *
 * Uso:
 *   import { processarPagamento } from '@workspace/stripe-checkout'
 *   const resultado = await processarPagamento(link, opcoes)
 */

import { AutomacaoCheckout } from './automacao.js';
import { registrar } from './utilitarios.js';

/**
 * Executa o fluxo completo de checkout do Stripe.
 *
 * Abre o link de checkout em um Firefox headless, extrai os tokens de sessão,
 * aplica o cupom (se fornecido), cria o método de pagamento e confirma a assinatura.
 * O navegador é fechado no bloco `finally` — garantindo o fechamento mesmo em erros.
 *
 * Equivalente à função `processStripePayment()` do módulo original.
 *
 * @param {string} link - URL completa da sessão de checkout do Stripe
 *   Formato: https://checkout.stripe.com/c/pay/cs_live_xxx#...
 * @param {Object} opcoes - Opções do processamento
 * @param {string[]} [opcoes.codigos=[]] - Códigos de cupom a tentar (opcional)
 * @param {Object} opcoes.cartao - Dados do cartão de crédito/débito (obrigatório)
 * @param {string} opcoes.cartao.numero - Número do cartão (com ou sem espaços)
 * @param {string} opcoes.cartao.cvv - Código de segurança (CVV/CVC)
 * @param {string} opcoes.cartao.mesVencimento - Mês de vencimento ('01' a '12')
 * @param {string} opcoes.cartao.anoVencimento - Ano de vencimento (2 dígitos, ex: '34')
 * @param {Object} opcoes.endereco - Dados do endereço e titular do cartão (obrigatório)
 * @param {string} opcoes.endereco.nome - Nome completo do titular
 * @param {string} opcoes.endereco.email - E-mail para envio do recibo
 * @param {string} opcoes.endereco.pais - Código do país (ex: 'BR')
 * @param {string} opcoes.endereco.rua - Logradouro completo
 * @param {string} opcoes.endereco.cidade - Cidade
 * @param {string} opcoes.endereco.estado - UF ou sigla do estado (ex: 'MS')
 * @param {string} opcoes.endereco.cep - CEP ou código postal (ex: '79042-470')
 * @returns {Promise<{sucesso: boolean, status: string, mensagem: string}>} Resultado do processamento
 *   - sucesso: true se o pagamento foi processado (mesmo que cartão recusado)
 *   - status: 'paid' | 'card_declined' | 'error'
 *   - mensagem: descrição textual do resultado
 *
 * @example
 * const resultado = await processarPagamento(link, {
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
 *     rua: 'Rua Exemplo, 123',
 *     cidade: 'Campo Grande',
 *     estado: 'MS',
 *     cep: '79042-470'
 *   }
 * })
 * console.log(resultado.status) // 'paid' ou 'card_declined'
 */
export async function processarPagamento(link, opcoes = {}) {
  const { codigos = [], cartao, endereco } = opcoes;

  console.log(`\n${'='.repeat(100)}`);
  console.log(` INICIANDO AUTOMAÇÃO DE PAGAMENTO STRIPE`);
  console.log(`${'='.repeat(100)}`);
  console.log(` URL: ${link}`);

  const automacao = new AutomacaoCheckout(link);
  let resultado;

  try {
    await automacao.inicializar();
    await automacao.extrairDadosSessao();
    await automacao.aplicarCupons(codigos);

    resultado = await automacao.preencherCartaoEConfirmar(cartao, endereco);
  } catch (erro) {
    registrar(`Erro fatal na execução: ${erro.message}`, 'error');
    resultado = { sucesso: false, status: 'error', mensagem: erro.message };
  } finally {
    // O navegador é sempre fechado aqui, mesmo em caso de erro
    await automacao.fechar();
  }

  console.log(`${'='.repeat(100)}`);
  if (resultado.sucesso) {
    console.log(` AUTOMACAO STRIPE CONCLUIDA COM SUCESSO`);
  } else {
    console.log(` FALHA NA AUTOMACAO STRIPE`);
  }
  console.log(`${'='.repeat(100)}\n`);

  return resultado;
}
