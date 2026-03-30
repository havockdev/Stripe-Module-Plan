'use strict';

/**
 * NopechaService — resolve Cloudflare Turnstile via API NopeCHA.
 *
 * Interface idêntica ao módulo 2captcha do usuário:
 *   { status: true, token: "..." }   → sucesso
 *   { status: false, msg: "..." }    → falha / timeout
 *
 * Uso simples (usa as constantes fixas abaixo):
 *   const NopechaService = require('./nopecha-turnstile');
 *   const resultado = await NopechaService.resolverTurnstile();
 *
 * Ou sobrescrevendo individualmente:
 *   const resultado = await NopechaService.resolverTurnstile({
 *     sitekey: "outro-sitekey",
 *     pageurl: "https://outra-pagina.com",
 *     action:  "outra_acao",
 *   });
 *
 * Referência: https://nopecha.com/api-reference/#postTurnstileToken
 *
 * Requisito de runtime: Node.js >= 18 (usa `fetch` nativo).
 * Para versões mais antigas, instale `node-fetch` e adicione no topo:
 *   const fetch = require('node-fetch');
 */

// ─── Configuração fixa ────────────────────────────────────────────────────────
const API_KEY  = "bdef81d97b09d61aaefb79f8794bcd11";
const SITE_KEY = "0x4AAAAAAChnKAZBY0iFpFHC";
const PAGE_URL = "https://lovable.dev/signup";
// ─────────────────────────────────────────────────────────────────────────────

const ENDPOINT_TURNSTILE = 'https://api.nopecha.com/v1/token/turnstile';

const NopechaService = {
  /**
   * Resolve um Cloudflare Turnstile usando a API NopeCHA.
   *
   * @param {object} opcoes
   * @param {string}  opcoes.sitekey   - Sitekey do Turnstile (ex: "0x4AAAAAAA...")
   * @param {string}  opcoes.pageurl   - URL completa da página onde o captcha aparece
   * @param {string}  [opcoes.action]  - Ação do Turnstile (ex: "signup_email_password")
   * @param {string}  [opcoes.chaveApi] - Chave da API NopeCHA (padrão: NOPECHA_API_KEY do env)
   * @returns {Promise<{ status: true, token: string } | { status: false, msg: string }>}
   */
  resolverTurnstile: async ({ sitekey, pageurl, action, chaveApi } = {}) => {
    const chave   = chaveApi  || process.env.NOPECHA_API_KEY || API_KEY;
    const _sitekey = sitekey  || SITE_KEY;
    const _pageurl = pageurl  || PAGE_URL;

    if (!chave) {
      const msg = 'API_KEY não configurada';
      console.error(`[NOPECHA-TURNSTILE] ${msg}`);
      return { status: false, msg };
    }

    try {
      // ── Passo 1: Submete o job de Turnstile ───────────────────────────────
      console.log(`[NOPECHA-TURNSTILE] Submetendo job... sitekey=${_sitekey.substring(0, 20)} | pageurl=${_pageurl}`);

      const corpo = {
        key: chave,
        type: 'turnstile',
        sitekey: _sitekey,
        url: _pageurl,
      };
      if (action) corpo.action = action;

      const respostaSubmit = await fetch(ENDPOINT_TURNSTILE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${chave}`,
        },
        body: JSON.stringify(corpo),
      });

      const dadosSubmit = await respostaSubmit.json();

      if (dadosSubmit?.error_id || !dadosSubmit?.data) {
        const msg = `Falha ao submeter job: ${JSON.stringify(dadosSubmit)}`;
        console.error(`[NOPECHA-TURNSTILE] ${msg}`);
        return { status: false, msg };
      }

      const jobId = dadosSubmit.data;
      console.log(`[NOPECHA-TURNSTILE] Job criado: ${jobId}. Aguardando solução (até 90s)...`);

      // ── Passo 2: Polling a cada 3s por até 90s (30 tentativas) ───────────
      for (let tentativa = 1; tentativa <= 30; tentativa++) {
        await new Promise((r) => setTimeout(r, 3000));

        const respostaPoll = await fetch(
          `${ENDPOINT_TURNSTILE}?key=${encodeURIComponent(chave)}&id=${encodeURIComponent(jobId)}`,
        );
        const dadosPoll = await respostaPoll.json();

        // error_id 9  = "Incomplete Job"    — ainda processando
        // error_id 14 = "Job Still Running" — ainda processando
        if (dadosPoll?.error_id === 9 || dadosPoll?.error_id === 14) {
          process.stdout.write('.');
          continue;
        }

        if (dadosPoll?.error_id) {
          const msg = `Erro no polling: error_id=${dadosPoll.error_id} | ${JSON.stringify(dadosPoll)}`;
          console.error(`\n[NOPECHA-TURNSTILE] ${msg}`);
          return { status: false, msg };
        }

        const token = dadosPoll?.data;
        if (token && typeof token === 'string' && token.length > 20) {
          console.log(`\n[NOPECHA-TURNSTILE] Captcha resolvido com sucesso! (token: ${token.length} chars)`);
          return { status: true, token };
        }

        console.log(`\n[NOPECHA-TURNSTILE] Resposta inesperada (tentativa ${tentativa}/30): ${JSON.stringify(dadosPoll).substring(0, 120)}`);
      }

      const msg = 'Timeout de 90s atingido — token não recebido';
      console.error(`[NOPECHA-TURNSTILE] ${msg}`);
      return { status: false, msg };

    } catch (erro) {
      const msg = erro.message || String(erro);
      console.error(`\n[NOPECHA-TURNSTILE] Erro inesperado: ${msg}`);
      return { status: false, msg };
    }
  },
};

module.exports = NopechaService;
