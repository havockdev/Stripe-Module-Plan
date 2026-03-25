/**
 * utilitarios.js
 *
 * Funções auxiliares usadas em todo o módulo @workspace/stripe-checkout.
 */

import { randomUUID } from 'crypto';

/**
 * Registra uma mensagem no console com timestamp, prefixo e nível de log.
 * Equivalente à função `log()` do módulo original.
 *
 * @param {string} mensagem - Texto da mensagem a registrar
 * @param {'info'|'warning'|'error'|'success'} [tipo='info'] - Nível do log
 */
export function registrar(mensagem, tipo = 'info') {
  const marcaTemporal = new Date().toISOString();
  const tipoNormalizado = ['info', 'warning', 'error', 'success'].includes(tipo)
    ? tipo
    : 'info';
  console.log(`    [${marcaTemporal}] [stripe-checkout] [${tipoNormalizado}] ${mensagem}`);
}

/**
 * Gera um UUID v4 aleatório.
 * Usado para criar os identificadores de rastreamento (guid, muid, sid)
 * quando não capturados diretamente das requisições do Stripe.
 *
 * @returns {string} UUID no formato xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 */
export function gerarUuid() {
  return randomUUID();
}
