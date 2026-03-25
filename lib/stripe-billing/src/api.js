/**
 * api.js
 *
 * API de alto nível do módulo @workspace/stripe-billing.
 *
 * Oferece as funções principais de uso externo:
 * - mudarPlano(): executa as 3 etapas e troca o plano da assinatura
 * - lerSessao(): executa apenas as etapas 1 e 2 (somente leitura, sem modificações)
 *
 * Uso típico:
 *   import { mudarPlano, lerSessao } from '@workspace/stripe-billing'
 *   const resultado = await mudarPlano(link)
 */

import { executarEtapa1 } from "./etapa1.js";
import { executarEtapa2 } from "./etapa2.js";
import { executarEtapa3 } from "./etapa3.js";

/**
 * Executa a troca completa de plano de assinatura no Stripe Billing Portal.
 *
 * Encadeia automaticamente as 3 etapas:
 *   1. Acessa o link e extrai tokens de sessão
 *   2. Lê o estado atual da assinatura
 *   3. Confirma a troca de plano via POST
 *
 * Se `idPrecoAlvo` não for informado, o price ID é detectado automaticamente
 * a partir dos itens recorrentes retornados na Etapa 2 (campo `fluxo.itensRecorrentes[0].preco`).
 * Isso funciona porque o link do portal de confirmação já embute o plano destino.
 *
 * Exemplos de IDs de preço conhecidos:
 *   - Lite (mensal):   price_1SQSE8KvR4zlUMOUgIcRNEh1
 *   - Pro 0 (mensal):  price_1SfJHYKvR4zlUMOUN4ABuaB4
 *
 * @param {string} link - URL completa de sessão do Stripe Billing Portal
 *   Deve ser um link do tipo subscription_update_confirm com os itens recorrentes já definidos
 * @param {string} [idPrecoAlvo] - ID do preço alvo (price_...) — opcional
 *   Se não informado, será extraído automaticamente da resposta da Etapa 2
 * @returns {Promise<{
 *   etapa1: Object,
 *   etapa2: Object,
 *   etapa3: Object,
 *   precoAlvo: string,
 *   autoDetectado: boolean
 * }>} Resultados completos das 3 etapas, o price ID usado e se foi auto-detectado
 * @throws {Error} Se nenhum price ID puder ser determinado (link inválido ou não é de confirmação)
 * @throws {Error} Se qualquer uma das etapas HTTP falhar
 */
export async function mudarPlano(link, idPrecoAlvo) {
  // Etapa 1: acessar o link e extrair tokens
  const resultadoEtapa1 = await executarEtapa1(link);

  // Etapa 2: ler o estado atual da sessão (sem modificar nada)
  const resultadoEtapa2 = await executarEtapa2(resultadoEtapa1);

  // Determinar o preço alvo
  const autoDetectado = idPrecoAlvo == null || idPrecoAlvo === "";

  // Se não informado, extrai do primeiro item recorrente do fluxo
  const precoAlvo = autoDetectado
    ? resultadoEtapa2.fluxo.itensRecorrentes[0]?.preco ?? null
    : idPrecoAlvo;

  if (!precoAlvo) {
    throw new Error(
      "Não foi possível determinar o preço alvo automaticamente. " +
        "O link pode não ser de confirmação de mudança de plano. " +
        "Informe o idPrecoAlvo manualmente como segundo parâmetro.",
    );
  }

  // Etapa 3: confirmar a troca de plano
  const resultadoEtapa3 = await executarEtapa3(
    resultadoEtapa1,
    resultadoEtapa2,
    precoAlvo,
  );

  return {
    etapa1: resultadoEtapa1,
    etapa2: resultadoEtapa2,
    etapa3: resultadoEtapa3,
    precoAlvo,
    autoDetectado,
  };
}

/**
 * Lê o estado atual de uma sessão do Stripe Billing Portal sem fazer alterações.
 *
 * Executa apenas as Etapas 1 e 2 (leitura), sem chamar a Etapa 3 (POST).
 * Útil para inspecionar o plano atual, plano alvo, produtos disponíveis e
 * configurações do portal antes de decidir se deseja confirmar a troca.
 *
 * @param {string} link - URL completa de sessão do Stripe Billing Portal
 * @returns {Promise<{
 *   etapa1: Object,
 *   etapa2: Object
 * }>} Resultados das Etapas 1 e 2
 * @throws {Error} Se qualquer uma das etapas HTTP falhar
 */
export async function lerSessao(link) {
  const resultadoEtapa1 = await executarEtapa1(link);
  const resultadoEtapa2 = await executarEtapa2(resultadoEtapa1);

  return {
    etapa1: resultadoEtapa1,
    etapa2: resultadoEtapa2,
  };
}
