/**
 * index.js
 *
 * Ponto de entrada do módulo @workspace/stripe-billing.
 *
 * Exporta a API de alto nível (objeto `apiStripe` e funções individuais)
 * e as funções internas de cada etapa para uso avançado.
 *
 * ────────────────────────────────────────────────
 * USO BÁSICO (ESM)
 * ────────────────────────────────────────────────
 * import { apiStripe } from '@workspace/stripe-billing'
 *
 * // Troca o plano da assinatura (executa as 3 etapas automaticamente)
 * const resultado = await apiStripe.mudarPlano(link)
 * console.log(resultado.etapa3.status)       // 'active'
 * console.log(resultado.precoAlvo)            // 'price_1SQSE8KvR4zlUMOUgIcRNEh1'
 * console.log(resultado.autoDetectado)        // true
 *
 * // Lê a sessão sem modificar nada (etapas 1+2 apenas)
 * const sessao = await apiStripe.lerSessao(link)
 * console.log(sessao.etapa2.fluxo.idAssinatura)
 *
 * ────────────────────────────────────────────────
 * USO AVANÇADO (etapas individuais)
 * ────────────────────────────────────────────────
 * import { executarEtapa1, executarEtapa2, executarEtapa3 } from '@workspace/stripe-billing'
 *
 * const etapa1 = await executarEtapa1(link)
 * const etapa2 = await executarEtapa2(etapa1)
 * const etapa3 = await executarEtapa3(etapa1, etapa2, 'price_xxx')
 *
 * ────────────────────────────────────────────────
 * IDs DE PREÇO CONHECIDOS (ambiente de produção)
 * ────────────────────────────────────────────────
 * Lite mensal:  price_1SQSE8KvR4zlUMOUgIcRNEh1
 * Pro 0 mensal: price_1SfJHYKvR4zlUMOUN4ABuaB4
 */

export { mudarPlano, lerSessao } from "./api.js";
export { executarEtapa1 } from "./etapa1.js";
export { executarEtapa2 } from "./etapa2.js";
export { executarEtapa3 } from "./etapa3.js";

/**
 * Objeto principal do módulo — agrupa todos os métodos da API em uma interface única.
 *
 * Ideal para uso em bots externos que querem importar tudo de uma vez:
 *   const { apiStripe } = await import('@workspace/stripe-billing')
 *
 * @type {{
 *   mudarPlano: (link: string, idPrecoAlvo?: string) => Promise<Object>,
 *   lerSessao:  (link: string) => Promise<Object>,
 *   etapa1:     (link: string) => Promise<Object>,
 *   etapa2:     (resultadoEtapa1: Object) => Promise<Object>,
 *   etapa3:     (resultadoEtapa1: Object, resultadoEtapa2: Object, idPrecoAlvo: string) => Promise<Object>
 * }}
 */
export { apiStripe } from "./objeto.js";
